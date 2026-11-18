// テイクの時刻（§7.2）と、集めたフレームからの判定（§7.3）。純関数。
import type { Sing2CheckConfig } from "../audio/config.ts";
import type { Frame } from "../audio/dsp.ts";
import Core from "../core/solfege-core.js";
import type { Melody } from "../core/solfege-core.js";
import { countBeatsFor, totalSeconds } from "../core/exercise.ts";
import type { Exercise } from "../core/exercise.ts";
import type { Settings, TakeRecord } from "../storage.ts";
import { localDateString } from "../storage.ts";
import { beatTimes, estimateClickLatency, judgeTake, targetNotes } from "./judge.ts";
import type { TakeResult } from "./judge.ts";
import { timingReliable } from "./stats.ts";

/** 主和音の長さ: 分散 0.35 × 3 → 和音 0.9 → 主音 0.7 */
export const CHORD_SEC = 2.65;
/** 予約の余裕 */
export const SCHEDULE_LEAD_SEC = 0.15;
/** 解析に使うフレームの範囲の前側（課題開始より前） */
const ANALYZE_PRE_SEC = 0.5;
/** 往復の遅れを測ってあるのに、クリックがこれ以上ずれて届いたら「測り直して」と出す */
const LATENCY_CHANGED_SEC = 0.03;

export interface Beat { t: number; accent: boolean }

/** テイクの時刻。t で始まる名前は AudioContext の秒、それ以外は課題時間（課題の 1 拍目 = 0 秒） */
export interface TakeSchedule {
  /** 予約の起点 */
  tStart: number;
  /** 主和音を鳴らす時刻（鳴らさないときは null） */
  tChord: number | null;
  /** カウントの 1 拍目 */
  tCount: number;
  /** 課題の 1 拍目 = 課題時間の 0 秒 */
  t0: number;
  /** 課題の長さ + 1 拍の余韻 */
  tEnd: number;
  /** 1 拍の長さ（秒）。6/8 は付点四分 */
  beat: number;
  countBeats: number;
  /** 1 小節の拍数 */
  beatsPerBar: number;
  totalSec: number;
  /** カウントのクリック（課題時間、負の値） */
  countClicks: Beat[];
  /** 課題中の拍頭（課題時間） */
  beats: Beat[];
}

export function scheduleTake(now: number, melody: Melody, bpm: number, opts: { chord: boolean }): TakeSchedule {
  const meter = melody.rhythm.meter;
  const beat = 60 / bpm;
  const countBeats = countBeatsFor(meter);
  const tStart = now + SCHEDULE_LEAD_SEC;
  const tCount = opts.chord ? tStart + CHORD_SEC + beat : tStart;
  const t0 = tCount + countBeats * beat;
  const totalSec = totalSeconds(melody, bpm);
  return {
    tStart,
    tChord: opts.chord ? tStart : null,
    tCount,
    t0,
    tEnd: t0 + totalSec + beat,
    beat,
    countBeats,
    beatsPerBar: meter.beats,
    totalSec,
    countClicks: Array.from({ length: countBeats }, (_, k) => ({ t: -(countBeats - k) * beat, accent: k % meter.beats === 0 })),
    beats: beatTimes(melody, bpm),
  };
}

/** いま鳴っている（表示する）拍。録音中の拍の表示に使う */
export type BeatPosition =
  | { phase: "chord" }
  | { phase: "count"; index: number }
  | { phase: "exercise"; bar: number; beatInBar: number; index: number }
  | { phase: "tail" };

export function beatPosition(s: TakeSchedule, tCtx: number): BeatPosition {
  if (tCtx < s.tCount) return { phase: "chord" };
  if (tCtx < s.t0) return { phase: "count", index: Math.min(s.countBeats - 1, Math.floor((tCtx - s.tCount) / s.beat + 1e-6)) };
  const index = Math.floor((tCtx - s.t0) / s.beat + 1e-6);
  if (index >= s.beats.length) return { phase: "tail" };
  return { phase: "exercise", bar: Math.floor(index / s.beatsPerBar), beatInBar: index % s.beatsPerBar, index };
}

export interface AnalyzeInput {
  /** ワークレットから届いたフレーム（t は AudioContext の秒） */
  frames: Frame[];
  schedule: TakeSchedule;
  melody: Melody;
  bpm: number;
  config: Sing2CheckConfig;
  /** 解析フレーム 1 つの長さ（秒） */
  frameDurSec: number;
  /** ループバック試験で測った往復の遅れ（秒）。測っていなければ null */
  roundTripSec: number | null;
  /** 課題中にクリックを鳴らしたか */
  clicksDuringTake: boolean;
}

export interface TakeAnalysis {
  result: TakeResult;
  /** クリックのマスクの位置に使った遅れ（秒） */
  clickLatencySec: number;
  /** カウントのクリックから推定した遅れ（秒）。クリックがマイクに届いていなければ null（イヤホンなど） */
  estimatedClickLatencySec: number | null;
  /** 往復の遅れを測ってあるのに、クリックが 30ms 以上ずれて届いた */
  latencyChanged: boolean;
  /** 解析に使ったフレームの数（0 ならマイクから何も届いていない） */
  frameCount: number;
}

/** 推定の探索を前にずらす幅（測定済みのとき、クリックが「早く」届いた場合も見つけるため） */
const SIGNED_SEARCH_BACK_SEC = 0.2;

/**
 * フレームの時間軸を課題時間に直し（t_ex = t_ctx − T0 − 往復の遅れ）、クリックのマスクの位置を決めて判定する。
 * - 往復の遅れを測ってある: マスクは拍の時刻のまま。推定値が 30ms 以上ずれていたら latencyChanged
 * - 測っていない: カウントのクリックから遅れを推定してマスクに使う（届いていなければ 0）
 */
export function analyzeTake(inp: AnalyzeInput): TakeAnalysis {
  const s = inp.schedule;
  const measured = inp.roundTripSec !== null;
  const shift = s.t0 + (inp.roundTripSec ?? 0);
  const all = inp.frames.map((f) => ({ ...f, t: f.t - shift }));
  const countTimes = s.countClicks.map((c) => c.t);

  let estimated: number | null;
  if (measured) {
    // 時間軸は補正済みなので、クリックは拍の時刻の近くに来るはず。前後どちらへのずれも見る
    const e = estimateClickLatency(all, countTimes.map((c) => c - SIGNED_SEARCH_BACK_SEC), inp.config, { maxSec: 0.4 + SIGNED_SEARCH_BACK_SEC });
    estimated = e === null ? null : e - SIGNED_SEARCH_BACK_SEC;
  } else {
    estimated = estimateClickLatency(all, countTimes, inp.config);
  }
  const clickLatencySec = measured ? 0 : estimated ?? 0;

  const frames = all.filter((f) => f.t >= -ANALYZE_PRE_SEC && f.t <= s.totalSec + s.beat);
  const clickTimes = [...countTimes, ...(inp.clicksDuringTake ? s.beats.map((b) => b.t) : [])];
  const result = judgeTake(targetNotes(inp.melody, inp.bpm), frames, {
    config: inp.config,
    frameDurSec: inp.frameDurSec,
    clickTimes,
    clickLatencySec,
  });
  return {
    result,
    clickLatencySec,
    estimatedClickLatencySec: estimated,
    latencyChanged: measured && estimated !== null && Math.abs(estimated) > LATENCY_CHANGED_SEC,
    frameCount: frames.length,
  };
}

/** 結果を記録の形にする（§14.1） */
export function toTakeRecord(
  exercise: Exercise, bpm: number, result: TakeResult, settings: Settings,
  hintsUsed: { tonicChord: boolean; firstNote: boolean }, now: Date,
): TakeRecord {
  const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
  return {
    date: now.toISOString(),
    localDate: localDateString(now),
    level: exercise.level,
    exerciseId: exercise.id,
    seed: exercise.seed,
    meter: exercise.melody.rhythm.meter.str,
    tempo: bpm,
    noteCount: result.count,
    correctCount: result.correct,
    passed: result.passed,
    meanDeviationCents: round1(result.meanDevCents),
    meanAbsoluteDeviationCents: round1(result.meanAbsDevCents),
    driftCents: round1(result.driftCents),
    timingOffsetMs: result.offsetMs,
    timingReliable: timingReliable(result),
    roundTripMsUsed: settings.roundTripMs,
    hintsUsed: { ...hintsUsed },
    chordBeforeTake: settings.chordBeforeTake,
    clicksDuringTake: settings.clicksDuringTake,
    notes: result.notes.map((n) => ({
      solfa: n.solfa,
      name: Core.NAMES[n.solfa],
      intervalFromPrevious: n.intervalFromPrevious,
      status: n.status,
      deviationCents: n.devCents === null ? null : Math.round(n.devCents),
      sungSolfa: n.sungSolfa,
    })),
  };
}
