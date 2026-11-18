// judgeTake の単体テスト（手で作ったフレーム列）（参照実装 reference/test から移植）
import { makeConfig } from "../src/audio/config.ts";
import type { Frame } from "../src/audio/dsp.ts";
import { judgeTake, foldDev, hzToCents, prepareTrace, estimateClickLatency } from "../src/judge/judge.ts";
import type { TargetNote } from "../src/judge/judge.ts";
import { test } from "vitest";
import { check, info } from "./helpers/check.ts";

const cfg = makeConfig();
const HOP = 256 * 2 / 48000, FRAME_DUR = 1024 * 2 / 48000;
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** 音列 → 理想のフレーム（各音の on〜off に音程 + cents、Δ だけずらす） */
function framesFor(notes: TargetNote[], o: { cents?: number[] | number; shift?: number; octave?: number; silent?: number[]; end?: number } = {}): Frame[] {
  const end = o.end ?? notes[notes.length - 1].offSec + 1;
  const out: Frame[] = [];
  for (let t = -0.5; t < end; t += HOP) {
    const tt = t - (o.shift ?? 0);
    const k = notes.findIndex((n) => tt >= n.onSec && tt < n.offSec);
    if (k < 0 || (o.silent ?? []).includes(k)) { out.push({ t, f0: null, clarity: 0.2, rmsDb: -80 }); continue; }
    const c = Array.isArray(o.cents) ? o.cents[k] : (o.cents ?? 0);
    out.push({ t, f0: midiHz(notes[k].midi + (o.octave ?? 0) * 12 + c / 100), clarity: 0.95, rmsDb: -20 });
  }
  return out;
}
const N = (midi: number, solfa: number, on: number, off: number): TargetNote => ({ midi, solfa, onSec: on, offSec: off });
// ラ ド ミ レ ド シ ラ（C のド、ラ主音）: A4 C5 E5 D5 C5 B4 A4
const MEL: TargetNote[] = [N(69, 9, 0, 0.5), N(72, 0, 0.5, 1), N(76, 4, 1, 1.25), N(74, 2, 1.25, 1.5), N(72, 0, 1.5, 2), N(71, 11, 2, 2.5), N(69, 9, 2.5, 3.5)];
const J = (frames: Frame[], extra: object = {}) => judgeTake(MEL, frames, { config: cfg, frameDurSec: FRAME_DUR, ...extra });

test("foldDev: オクターブを畳む", () => {
  check(Math.abs(foldDev(hzToCents(220), 69)) < 1e-9, "A3 vs A4");
  check(Math.abs(foldDev(hzToCents(880) + 30, 69) - 30) < 1e-9, "+30");
  check(Math.abs(foldDev(6900 - 650, 69) - 550) < 1e-9, "−650 → +550");
});

test("ぴったり: 全音 good、Δ = 0、ずれ 0", () => {
  const r = J(framesFor(MEL));
  check(r.passed && r.notes.every((n) => n.status === "good"), "all good");
  check(r.offsetMs === 0, "offset " + r.offsetMs);
  check(Math.abs(r.meanDevCents as number) < 1e-6 && Math.abs(r.driftCents as number) < 1e-6, "zero");
});

test("全体 +30 セント → 全音 ok、平均 +30", () => {
  const r = J(framesFor(MEL, { cents: 30 }));
  check(r.notes.every((n) => n.status === "ok"), r.notes.map((n) => n.status).join());
  check(Math.abs((r.meanDevCents as number) - 30) < 0.5 && Math.abs((r.meanAbsDevCents as number) - 30) < 0.5, "mean");
});

test("1 音だけ半音 2 つ上に歌う（レ → ミ）: その音だけ wrong、取り違え レ>ミ", () => {
  const c = MEL.map(() => 0); c[3] = 200;
  const r = J(framesFor(MEL, { cents: c }));
  check(r.notes.filter((n) => n.status === "wrong").length === 1 && r.notes[3].status === "wrong", "only #3 wrong");
  check(r.notes[3].sungSolfa === 4 && r.confusions.join() === "レ>ミ", r.confusions.join());
  check(r.correct === 6 && !r.passed, "6/7");
});

test("全体 +200ms 遅れ → Δ = +200、合格", () => {
  const r = J(framesFor(MEL, { shift: 0.2 }));
  check(r.passed, "passed");
  check(Math.abs(r.offsetMs - 200) <= 10, "offset " + r.offsetMs);
});

test("−120ms（早い）→ Δ = −120", () => {
  const r = J(framesFor(MEL, { shift: -0.12 }));
  check(r.passed && Math.abs(r.offsetMs + 120) <= 10, "offset " + r.offsetMs);
});

test("1 オクターブ下・2 オクターブ下でも合格", () => {
  check(J(framesFor(MEL, { octave: -1 })).passed, "−1");
  check(J(framesFor(MEL, { octave: -2 })).passed, "−2");
});

test("無音 → 全音 silent、Δ = 0、平均は null", () => {
  const r = J(framesFor(MEL, { silent: MEL.map((_, i) => i) }));
  check(r.notes.every((n) => n.status === "silent"), "silent");
  check(r.offsetMs === 0 && r.offsetScore === 0 && r.meanDevCents === null && r.driftCents === null, "nulls");
});

test("1 音だけ歌わない → その音だけ silent", () => {
  const r = J(framesFor(MEL, { silent: [4] }));
  check(r.notes.filter((n) => n.status === "silent").length === 1 && r.notes[4].status === "silent", r.notes.map((n) => n.status).join());
});

test("ドリフト: 0 → −30 セントへ直線的に下がる → drift ≈ −30", () => {
  const c = MEL.map((_, i) => -30 * i / (MEL.length - 1));
  const r = J(framesFor(MEL, { cents: c }));
  check(Math.abs((r.driftCents as number) + 30) < 1, "drift " + r.driftCents);
});

test("直前の音からの音程（符号つき半音）", () => {
  const r = J(framesFor(MEL));
  check(JSON.stringify(r.notes.map((n) => n.intervalFromPrevious)) === JSON.stringify([null, 3, 4, -2, -2, -1, -2]), "intervals");
});

test("短い音（窓に有効フレームが 2 未満）は窓全体を使う", () => {
  const short = [N(69, 9, 0, 0.5), N(71, 11, 0.5, 0.56), N(72, 0, 0.56, 1)];
  const r = judgeTake(short, framesFor(short), { config: cfg, frameDurSec: FRAME_DUR });
  const w = r.notes[1];
  check(Math.abs(w.windowStart - 0.5) < 1e-9 && Math.abs(w.windowEnd - 0.56) < 1e-9, `window ${w.windowStart}-${w.windowEnd}`);
  check(w.status === "good", w.status);
});

test("クリックのマスク: マスク区間のフレームは被覆率の分母からも除く", () => {
  const fr = framesFor(MEL);
  const clicks = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  // マスクされるフレームを無声にしても結果は変わらない
  const tr = prepareTrace(fr, { config: cfg, frameDurSec: FRAME_DUR, clickTimes: clicks });
  const fr2 = fr.map((f, i) => (tr[i].masked ? { ...f, f0: 1000, clarity: 0.99 } : f)); // マスク区間にでたらめな音
  const r = J(fr2, { clickTimes: clicks });
  check(r.passed && r.notes.every((n) => n.status === "good" && n.coverage === 1), "masked frames ignored");
  const masked = tr.filter((f) => f.masked).length;
  info("マスクされたフレーム（7 クリック）", `${masked}/${tr.length}`);
});

test("中央値フィルタ: 1 フレームだけの外れ値は消える", () => {
  const fr = framesFor(MEL);
  const i = fr.findIndex((f) => f.t > 0.25);
  fr[i] = { ...fr[i], f0: 1000 };
  const tr = prepareTrace(fr, { config: cfg, frameDurSec: FRAME_DUR });
  check(Math.abs((tr[i].cents as number) - 6900) < 1e-6, "outlier removed");
});

test("有声の条件: clarity < 0.80 や rmsDb < gate は無声", () => {
  const fr: Frame[] = [
    { t: 0, f0: 440, clarity: 0.79, rmsDb: -20 },
    { t: 0.01, f0: 440, clarity: 0.9, rmsDb: -51 },
    { t: 0.02, f0: 440, clarity: 0.9, rmsDb: -49 },
  ];
  const tr = prepareTrace(fr, { config: cfg, frameDurSec: FRAME_DUR });
  check(tr[0].cents === null && tr[1].cents === null && tr[2].cents !== null, "voicing");
});

test("Δ は得点の山の頂上（平らな範囲）の中点", () => {
  // 長い音だけの課題は頂上が平らになる。+100ms 遅れに対して ±20ms 以内
  const long = [N(69, 9, 0, 1), N(72, 0, 1, 2), N(76, 4, 2, 3)];
  const r = judgeTake(long, framesFor(long, { shift: 0.1 }), { config: cfg, frameDurSec: FRAME_DUR });
  check(Math.abs(r.offsetMs - 100) <= 20, "offset " + r.offsetMs);
});

test("estimateClickLatency: カウントのクリックの遅れを RMS の山から推定", () => {
  const counts = [-2, -1.5, -1, -0.5];
  const lat = 0.085;
  const fr: Frame[] = [];
  for (let t = -2.5; t < 0; t += HOP) {
    // クリック（30ms）とフレーム（42.7ms）の重なりに比例した RMS
    let e = 1e-6;
    for (const c of counts) {
      const a = c + lat, b = a + 0.03, lo = t - FRAME_DUR / 2, hi = t + FRAME_DUR / 2;
      e += Math.max(0, Math.min(b, hi) - Math.max(a, lo)) / FRAME_DUR;
    }
    fr.push({ t, f0: null, clarity: 0.1, rmsDb: 10 * Math.log10(e) - 20 });
  }
  const est = estimateClickLatency(fr, counts, cfg);
  check(est !== null && Math.abs(est - lat) <= 0.006, "est " + est);
  const quiet = fr.map((f) => ({ ...f, rmsDb: -80 }));
  check(estimateClickLatency(quiet, counts, cfg) === null, "no clicks -> null");
});

