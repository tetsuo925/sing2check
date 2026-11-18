// テイク 1 回の進行（§7.1）と、ループバック試験の実行（§12.1）。
import Core from "../core/solfege-core.js";
import type { Exercise } from "../core/exercise.ts";
import { analyzeTake, scheduleTake } from "../judge/take.ts";
import type { TakeAnalysis, TakeSchedule } from "../judge/take.ts";
import type { Settings } from "../storage.ts";
import { makeConfig } from "./config.ts";
import type { Frame } from "./dsp.ts";
import type { AudioEngine, PlayGroup, RateCheck } from "./engine.ts";
import { measureLoopback } from "./loopback.ts";
import type { LoopbackResult } from "./loopback.ts";
import { assemblePcm, unpackFrames } from "./messages.ts";
import type { FromWorklet } from "./messages.ts";
import { keepAwake } from "./session.ts";

export interface Recording { pcm: Float32Array; rate: number }

export interface TakeOutcome {
  analysis: TakeAnalysis;
  schedule: TakeSchedule;
  /** カウントの 1 拍目から余韻の終わりまでの録音。PCM が届かなかったら null */
  recording: Recording | null;
  /** 録音中にサンプルの連続が途切れた回数 */
  gaps: number;
  /** 実効サンプルレートの自己点検（判定できていなければ null） */
  rateCheck: RateCheck | null;
}

export interface TakeHandle {
  /** マイクの準備ができて時刻が決まったら解決する。やめたときは null */
  scheduled: Promise<TakeSchedule | null>;
  /** 解析が終わったら解決する。やめたときは null。マイクを開けなかった・途中で切れたら reject（DOMException） */
  done: Promise<TakeOutcome | null>;
  /** これまでに届いたフレーム（歌っている間の軌跡の表示用。t は AudioContext の秒） */
  frames: Frame[];
  /** テイクを捨てる */
  cancel(): void;
}

const STOP_TIMEOUT_MS = 600;
/** T_end を過ぎてもフレームが届かないとき、これだけ待って打ち切る */
const END_GRACE_SEC = 1.0;

function playSchedule(engine: AudioEngine, group: PlayGroup, s: TakeSchedule, chordNotes: readonly number[], clicksDuringTake: boolean): void {
  if (s.tChord !== null) engine.chord(group, chordNotes, s.tChord);
  for (const c of s.countClicks) engine.click(group, s.t0 + c.t, c.accent); // カウントのクリックは常に鳴らす
  if (clicksDuringTake) for (const b of s.beats) engine.click(group, s.t0 + b.t, b.accent);
}

/** 主和音の MIDI 3 音（設定「1 オクターブ下」なら −12） */
export function chordNotes(exercise: Exercise, octaveDown: boolean): number[] {
  const shift = octaveDown ? -12 : 0;
  return Core.contextNotes(exercise.melody.mode, exercise.melody.tonicMidi).map((m) => m + shift);
}

/**
 * テイクを始める。ユーザー操作（タップ）のハンドラの中で、await より前に呼ぶこと
 * （AudioContext の resume と getUserMedia を同期的に呼ぶため）。
 */
export function startTake(engine: AudioEngine, exercise: Exercise, bpm: number, settings: Settings): TakeHandle {
  const ctx = engine.ensureContext();
  const micReady = engine.openMic();
  void keepAwake(true);

  const frames: Frame[] = [];
  const pcmChunks: { startTime: number; data: Float32Array }[] = [];
  let pcmRate = 0;
  let gaps = 0;
  let cancelled = false;
  /** テイクの途中でマイクが切れた（通話の割り込み・イヤホンの抜き差しなど） */
  let micLost = false;
  let group: PlayGroup | null = null;
  let unsubscribe: (() => void) | null = null;
  let unwatchMic: (() => void) | null = null;
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  let takeId = -1;
  let finish: (() => void) | null = null;
  let resolveScheduled: (s: TakeSchedule | null) => void = () => { /* 下で差し替える */ };
  const scheduled = new Promise<TakeSchedule | null>((resolve) => { resolveScheduled = resolve; });

  const cleanup = () => {
    unsubscribe?.();
    unsubscribe = null;
    unwatchMic?.();
    unwatchMic = null;
    if (endTimer !== null) clearTimeout(endTimer);
    endTimer = null;
    void keepAwake(false);
  };

  const done = (async (): Promise<TakeOutcome | null> => {
    try {
      await micReady;
    } catch (e) {
      cleanup();
      resolveScheduled(null);
      if (cancelled) return null;
      throw e;
    }
    if (cancelled) { cleanup(); resolveScheduled(null); return null; }

    takeId = engine.nextTakeId();
    const stopped = new Promise<void>((resolve) => {
      let ended = false;
      finish = () => {
        if (ended) return;
        ended = true;
        engine.post({ type: "stop", takeId });
        setTimeout(resolve, STOP_TIMEOUT_MS); // "stopped" が来なくても先へ進む
      };
      unsubscribe = engine.subscribe((msg: FromWorklet) => {
        // マイクを開いた直後の途切れ（カウントより前）は判定に関係しないので数えない
        if (msg.type === "gap") { if (msg.currentFrame / engine.sampleRate >= schedule.tCount) gaps++; return; }
        if (msg.type !== "frames" && msg.type !== "pcm" && msg.type !== "stopped") return;
        if (msg.takeId !== takeId) return; // 古いテイクのメッセージは捨てる
        if (msg.type === "frames") {
          for (const f of unpackFrames(msg.data)) frames.push(f);
          if (frames.length && frames[frames.length - 1].t > schedule.tEnd) finish?.();
        } else if (msg.type === "pcm") {
          pcmRate = msg.rate;
          pcmChunks.push({ startTime: msg.startTime, data: msg.data });
        } else if (ended) {
          resolve();
        }
      });
    });
    engine.post({ type: "start", takeId });
    unwatchMic = engine.onChange(() => {
      if (engine.micState === "open" || cancelled) return;
      micLost = true;
      group?.stop();
      finish?.();
    });

    const schedule = scheduleTake(ctx.currentTime, exercise.melody, bpm, { chord: settings.chordBeforeTake });
    group = engine.newGroup();
    playSchedule(engine, group, schedule, chordNotes(exercise, settings.playbackOctaveDown), settings.clicksDuringTake);
    endTimer = setTimeout(() => finish?.(), (schedule.tEnd - ctx.currentTime + END_GRACE_SEC) * 1000);
    resolveScheduled(schedule);

    await stopped;
    cleanup();
    if (cancelled) return null;
    if (micLost) throw new DOMException("microphone was interrupted during the take", "NotReadableError");

    const analysis = analyzeTake({
      frames,
      schedule,
      melody: exercise.melody,
      bpm,
      config: { ...engine.config, gateDb: settings.gateDb },
      frameDurSec: engine.frameDurSec,
      roundTripSec: settings.roundTripMs === null ? null : settings.roundTripMs / 1000,
      clicksDuringTake: settings.clicksDuringTake,
    });
    const recording = pcmChunks.length
      ? { pcm: assemblePcm(pcmChunks, pcmRate, schedule.tCount, schedule.tEnd), rate: pcmRate }
      : null;
    return { analysis, schedule, recording, gaps, rateCheck: engine.rateCheck };
  })();

  return {
    scheduled,
    done,
    frames,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      group?.stop();
      if (takeId >= 0) engine.post({ type: "stop", takeId });
      finish?.();
      cleanup();
      resolveScheduled(null);
    },
  };
}

/* ---------- ループバック試験 ---------- */
const LOOPBACK_TONE_HZ = 440;
const LOOPBACK_TONE_SEC = 0.3;
const LOOPBACK_INTERVAL_SEC = 0.8;
const LOOPBACK_COUNT = 4;
const LOOPBACK_LEAD_SEC = 0.3;
const LOOPBACK_TAIL_SEC = 0.6;

/**
 * 440Hz・300ms の音を 0.8 秒おきに 4 回鳴らしてマイクで拾い、検出した高さと往復の遅れを求める。
 * マイクが開いている状態で呼ぶ。
 */
export async function runLoopbackTest(engine: AudioEngine): Promise<LoopbackResult> {
  const ctx = engine.ensureContext();
  const takeId = engine.nextTakeId();
  const chunks: { startTime: number; data: Float32Array }[] = [];
  let rate = 0;
  let onStopped: () => void = () => { /* 下で差し替える */ };
  const stopped = new Promise<void>((resolve) => { onStopped = resolve; });
  const unsubscribe = engine.subscribe((msg) => {
    if ((msg.type !== "pcm" && msg.type !== "stopped") || msg.takeId !== takeId) return;
    if (msg.type === "pcm") { rate = msg.rate; chunks.push({ startTime: msg.startTime, data: msg.data }); }
    else onStopped();
  });
  const group = engine.newGroup();
  try {
    engine.post({ type: "start", takeId });
    const first = ctx.currentTime + LOOPBACK_LEAD_SEC;
    const times = Array.from({ length: LOOPBACK_COUNT }, (_, k) => first + k * LOOPBACK_INTERVAL_SEC);
    for (const t of times) engine.testTone(group, t, LOOPBACK_TONE_HZ, LOOPBACK_TONE_SEC);
    const end = times[times.length - 1] + LOOPBACK_TONE_SEC + LOOPBACK_TAIL_SEC;
    await new Promise((resolve) => setTimeout(resolve, (end - ctx.currentTime) * 1000 + 150));
    engine.post({ type: "stop", takeId });
    await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS))]);
    if (!chunks.length) {
      return { roundTripMs: null, perBeepMs: times.map(() => null), detectedHz: null, centsError: null, pitchAbnormal: false, unstable: false };
    }
    const start = chunks[0].startTime;
    const pcm = assemblePcm(chunks, rate, start, end);
    return measureLoopback(pcm, rate, start, times, makeConfig(), { toneHz: LOOPBACK_TONE_HZ, toneSec: LOOPBACK_TONE_SEC });
  } finally {
    group.stop();
    unsubscribe();
  }
}
