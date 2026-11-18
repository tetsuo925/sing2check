// テイクの時刻（§7.2）と、フレームの時間軸の補正・クリックの遅れの扱い（§7.3）
import { describe, test, expect } from "vitest";
import { makeConfig } from "../src/audio/config.ts";
import { analyzeBuffer } from "../src/audio/dsp.ts";
import { assemblePcm, decimationFor, packFrames, playbackLpfHz, unpackFrames } from "../src/audio/messages.ts";
import { makeExercise, tempoRange, stepTempo, resolveTempo, tempoKey, tempoLabel, parseExerciseHash, countBeatsFor } from "../src/core/exercise.ts";
import Core from "../src/core/solfege-core.js";
import { analyzeTake, beatPosition, scheduleTake, toTakeRecord, CHORD_SEC, SCHEDULE_LEAD_SEC } from "../src/judge/take.ts";
import { DEFAULT_SETTINGS } from "../src/storage.ts";
import { renderTake } from "./helpers/synth.ts";

const cfg = makeConfig();
const SR = 48000;
const NOW = 12.34; // AudioContext の時刻（テイクを始めた時点）

/** 課題を 1 つ、指定の拍子になるまで seed を進めて探す */
function exerciseWithMeter(level: number, meter: string) {
  for (let seed = 10000; seed < 10200; seed++) {
    const ex = makeExercise(level, seed);
    if (ex.melody.rhythm.meter.str === meter) return ex;
  }
  throw new Error(`no ${meter} exercise in Lv${level}`);
}

describe("テイクの時刻", () => {
  test("主和音あり: 主和音 2.65 秒 + 1 拍 → カウント → 課題 → 1 拍の余韻", () => {
    const ex = makeExercise(1, 48213); // 2/4、既定 63
    const s = scheduleTake(NOW, ex.melody, 63, { chord: true });
    const beat = 60 / 63;
    expect(s.tStart).toBeCloseTo(NOW + SCHEDULE_LEAD_SEC, 9);
    expect(s.tChord).toBe(s.tStart);
    expect(s.tCount).toBeCloseTo(s.tStart + CHORD_SEC + beat, 9);
    expect(s.countBeats).toBe(4); // 2/4 は 2 小節
    expect(s.t0).toBeCloseTo(s.tCount + 4 * beat, 9);
    expect(s.totalSec).toBeCloseTo(8 * beat, 9); // 4 小節
    expect(s.tEnd).toBeCloseTo(s.t0 + 9 * beat, 9);
    expect(s.countClicks.map((c) => c.accent)).toEqual([true, false, true, false]);
    expect(s.countClicks[0].t).toBeCloseTo(-4 * beat, 9);
    expect(s.countClicks[3].t).toBeCloseTo(-beat, 9);
    expect(s.beats).toHaveLength(8);
  });

  test("主和音なし: すぐカウント", () => {
    const ex = makeExercise(1, 48213);
    const s = scheduleTake(NOW, ex.melody, 63, { chord: false });
    expect(s.tChord).toBeNull();
    expect(s.tCount).toBeCloseTo(NOW + SCHEDULE_LEAD_SEC, 9);
  });

  test("カウントの拍数: 2/4・6/8 は 2 小節、3/4・4/4 は 1 小節", () => {
    expect(countBeatsFor(Core.meterInfo("2/4"))).toBe(4);
    expect(countBeatsFor(Core.meterInfo("6/8"))).toBe(4);
    expect(countBeatsFor(Core.meterInfo("3/4"))).toBe(3);
    expect(countBeatsFor(Core.meterInfo("4/4"))).toBe(4);
    const s34 = scheduleTake(0, exerciseWithMeter(4, "3/4").melody, 69, { chord: false });
    expect(s34.countClicks.map((c) => c.accent)).toEqual([true, false, false]);
    const s68 = scheduleTake(0, exerciseWithMeter(6, "6/8").melody, 54, { chord: false });
    expect(s68.beat).toBeCloseTo(60 / 54, 9); // 付点四分
    expect(s68.countClicks.map((c) => c.accent)).toEqual([true, false, true, false]);
    expect(s68.beats).toHaveLength(8); // 4 小節 × 2 拍
  });

  test("拍の表示: 主和音 → カウント → 小節と拍 → 余韻", () => {
    const ex = makeExercise(1, 48213);
    const s = scheduleTake(NOW, ex.melody, 60, { chord: true });
    expect(beatPosition(s, s.tStart + 1)).toEqual({ phase: "chord" });
    expect(beatPosition(s, s.tCount)).toEqual({ phase: "count", index: 0 });
    expect(beatPosition(s, s.tCount + 3.5)).toEqual({ phase: "count", index: 3 });
    expect(beatPosition(s, s.t0)).toEqual({ phase: "exercise", bar: 0, beatInBar: 0, index: 0 });
    expect(beatPosition(s, s.t0 + 3.2)).toEqual({ phase: "exercise", bar: 1, beatInBar: 1, index: 3 });
    expect(beatPosition(s, s.t0 + 8.1)).toEqual({ phase: "tail" });
  });
});

describe("テンポと課題番号", () => {
  test("範囲は既定の 0.6〜1.2 倍の内側の 4 の倍数", () => {
    expect(tempoRange(63)).toEqual({ min: 40, max: 72 });
    expect(tempoRange(72)).toEqual({ min: 44, max: 84 });
    expect(tempoRange(54)).toEqual({ min: 36, max: 64 });
    for (const d of [54, 56, 63, 66, 69, 72]) {
      const r = tempoRange(d);
      expect(r.max).toBeLessThanOrEqual(d * 1.2);
      expect(r.min).toBeGreaterThanOrEqual(d * 0.6);
      expect(d).toBeGreaterThan(r.min);
      expect(d).toBeLessThan(r.max);
    }
  });

  test("「−」「＋」は隣の 4 の倍数へ。範囲で止まる", () => {
    expect(stepTempo(63, 1, 63)).toBe(64);
    expect(stepTempo(63, -1, 63)).toBe(60);
    expect(stepTempo(64, 1, 63)).toBe(68);
    expect(stepTempo(72, 1, 63)).toBe(72);
    expect(stepTempo(40, -1, 63)).toBe(40);
  });

  test("保存したテンポは範囲の中なら使い、外なら既定に戻す。6/8 は別のキー", () => {
    expect(resolveTempo(60, 63)).toBe(60);
    expect(resolveTempo(undefined, 63)).toBe(63);
    expect(resolveTempo(84, 56)).toBe(56);
    expect(tempoKey(7, Core.meterInfo("3/4"))).toBe("7");
    expect(tempoKey(7, Core.meterInfo("6/8"))).toBe("7:6/8");
    expect(tempoLabel(Core.meterInfo("2/4"), 66)).toBe("2/4 ♩=66");
    expect(tempoLabel(Core.meterInfo("6/8"), 54)).toBe("6/8 ♩.=54");
  });

  test("同じ level と seed なら同じ課題。ハッシュで課題を指定できる", () => {
    expect(makeExercise(3, 48213).melody.abc()).toBe(makeExercise(3, 48213).melody.abc());
    expect(makeExercise(3, 48213).id).toBe("Lv3-48213");
    expect(parseExerciseHash("#e2e-Lv3-48213")).toEqual({ level: 3, seed: 48213 });
    expect(parseExerciseHash("#e2e-Lv9-48213")).toBeNull();
    expect(parseExerciseHash("")).toBeNull();
  });
});

describe("フレームの時間軸とクリックの遅れ", () => {
  const ex = makeExercise(3, 48213);
  const bpm = ex.defaultTempo;
  const schedule = scheduleTake(NOW, ex.melody, bpm, { chord: true });
  const RT = 0.085;

  /** 合成の歌（カウントのクリックつき）を、ワークレットと同じ形のフレーム（AudioContext の時刻）にする */
  function record(actualRoundTrip: number, clicks: boolean) {
    const audio = renderTake(ex.melody, {
      sampleRate: SR, bpm, seed: ex.seed, noiseSnrDb: 30, roundTripSec: actualRoundTrip,
      clicks: clicks ? { times: [...schedule.countClicks, ...schedule.beats], level: 0.5 } : null,
      prerollSec: schedule.countBeats * schedule.beat + 0.3,
    });
    return analyzeBuffer(audio.samples, SR, schedule.t0 + audio.startTime, cfg);
  }
  const analyze = (frames: ReturnType<typeof record>, roundTripSec: number | null) => analyzeTake({
    frames, schedule, melody: ex.melody, bpm, config: cfg, frameDurSec: cfg.frameSize * cfg.decimation / SR, roundTripSec, clicksDuringTake: true,
  });
  const speaker = record(RT, true);

  test("往復の遅れを測ってある: 時間軸を補正して合格。マスクは拍の時刻のまま", () => {
    const a = analyze(speaker, RT);
    expect(a.result.passed).toBe(true);
    expect(a.clickLatencySec).toBe(0);
    expect(Math.abs(a.estimatedClickLatencySec as number)).toBeLessThan(0.01);
    expect(a.latencyChanged).toBe(false);
    expect(Math.abs(a.result.offsetMs)).toBeLessThanOrEqual(40);
  });

  test("測っていない: カウントのクリックから遅れを推定してマスクに使う", () => {
    const a = analyze(speaker, null);
    expect(a.result.passed).toBe(true);
    expect(a.estimatedClickLatencySec as number).toBeGreaterThan(RT - 0.006);
    expect(a.estimatedClickLatencySec as number).toBeLessThan(RT + 0.006);
    expect(a.clickLatencySec).toBe(a.estimatedClickLatencySec);
    expect(a.latencyChanged).toBe(false);
    expect(Math.abs(a.result.offsetMs - 85)).toBeLessThanOrEqual(40); // Δ は機器の遅れを含む
  });

  test("測ったときより遅れが大きく／小さくなった → 測り直しを勧める", () => {
    const later = analyze(record(0.2, true), RT);
    expect(later.latencyChanged).toBe(true);
    expect(later.estimatedClickLatencySec as number).toBeCloseTo(0.115, 2);
    const earlier = analyze(speaker, 0.2);
    expect(earlier.latencyChanged).toBe(true);
    expect(earlier.estimatedClickLatencySec as number).toBeCloseTo(-0.115, 2);
    expect(earlier.clickLatencySec).toBe(0);
  });

  test("クリックがマイクに届かない（イヤホン）: 推定は null、マスクは 0 のまま合格", () => {
    const a = analyze(record(0.02, false), null);
    expect(a.estimatedClickLatencySec).toBeNull();
    expect(a.clickLatencySec).toBe(0);
    expect(a.result.passed).toBe(true);
  });

  test("フレームが 1 つも届かない → 全音 silent", () => {
    const a = analyze([], null);
    expect(a.frameCount).toBe(0);
    expect(a.result.notes.every((n) => n.status === "silent")).toBe(true);
    expect(a.result.passed).toBe(false);
  });

  test("記録の形", () => {
    const a = analyze(speaker, RT);
    const now = new Date(2026, 10, 20, 19, 12);
    const rec = toTakeRecord(ex, bpm, a.result, { ...DEFAULT_SETTINGS, roundTripMs: 85 }, { tonicChord: true, firstNote: false }, now);
    expect(rec).toMatchObject({
      localDate: "2026-11-20", level: 3, exerciseId: "Lv3-48213", seed: 48213, meter: "2/4", tempo: 66,
      noteCount: 17, correctCount: 17, passed: true, timingReliable: true, roundTripMsUsed: 85,
      hintsUsed: { tonicChord: true, firstNote: false }, chordBeforeTake: true, clicksDuringTake: true,
    });
    expect(rec.date).toBe(now.toISOString());
    expect(rec.notes).toHaveLength(17);
    expect(rec.notes[0]).toMatchObject({ solfa: 4, name: "ミ", intervalFromPrevious: null, status: "good", sungSolfa: null });
    expect(Number.isInteger(rec.notes[0].deviationCents)).toBe(true);
    expect(rec.notes[1].intervalFromPrevious).toBe(-7); // ミ → ラ（A4 → D4）
  });
});

describe("機器のサンプルレート", () => {
  test("間引き率: 解析のレートが 24kHz 前後になる", () => {
    expect(decimationFor(48000)).toBe(2);
    expect(decimationFor(44100)).toBe(2);
    expect(decimationFor(96000)).toBe(4);
    expect(decimationFor(88200)).toBe(4);
    expect(decimationFor(192000)).toBe(8);
    expect(decimationFor(32000)).toBe(1);
    expect(decimationFor(16000)).toBe(1);
    expect(playbackLpfHz(48000, 2)).toBe(10000);
    expect(playbackLpfHz(16000, 1)).toBeLessThan(8000);
  });

  test("96kHz の入力でも、1/4 に間引けば 48kHz と同じ精度で取れる（低い声 98Hz を含む）", () => {
    const c = makeConfig({ decimation: decimationFor(96000) });
    for (const hz of [98, 196, 440, 784]) {
      const n = Math.floor(0.5 * 96000), x = new Float32Array(n);
      for (let i = 0; i < n; i++) for (let k = 1; k <= 8; k++) x[i] += 0.3 * Math.sin(2 * Math.PI * k * hz * i / 96000 + k) / k;
      const frames = analyzeBuffer(x, 96000, 0, c).slice(4, -2);
      expect(frames.length).toBeGreaterThan(20);
      for (const f of frames) {
        expect(f.f0, `${hz}Hz`).not.toBeNull();
        expect(Math.abs(1200 * Math.log2((f.f0 as number) / hz)), `${hz}Hz`).toBeLessThan(3);
      }
      expect(frames[1].t - frames[0].t).toBeCloseTo(256 * 4 / 96000, 9); // ホップ 10.7ms のまま
    }
  });
});

describe("ワークレットのメッセージ", () => {
  test("フレームの詰め替え: f0 = null は NaN で送る", () => {
    const frames = [{ t: 100.123456789, f0: 440, clarity: 0.9, rmsDb: -20 }, { t: 100.134, f0: null, clarity: 0.1, rmsDb: -Infinity }];
    expect(unpackFrames(packFrames(frames))).toEqual(frames);
  });

  test("再生用 PCM をまとめる: 範囲の外は切り、届かなかった所は 0", () => {
    const a = Float32Array.from([1, 2, 3, 4]), b = Float32Array.from([5, 6, 7, 8]);
    // rate 10Hz。a は 0.8〜1.2 秒、b は 1.4〜1.8 秒（1.2〜1.4 秒は欠け）。1.0〜1.7 秒を取り出す
    const out = assemblePcm([{ startTime: 0.8, data: a }, { startTime: 1.4, data: b }], 10, 1.0, 1.7);
    expect(Array.from(out)).toEqual([3, 4, 0, 0, 5, 6, 7]);
  });
});
