// 通し試験: solfege-core の課題 → 合成の歌 → 前処理・YIN → judgeTake。
// 参照実装 reference/test/pipeline.test.ts を Vitest に移したもの。条件・seed・合否の基準は同じ。
//   npm test                          各レベル 3 課題（PER=3）
//   npm run test:full                 各レベル 30 課題・追加条件 10 課題（ハンドオフ文書 §18.3 と同じ量。数分かかる）
//   LEVELS=5-8 npx vitest run test/pipeline.test.ts   レベルを絞る
//   INFO=1 を付けると測定値（文書に載せた数字）も出す
import { test, expect } from "vitest";
import Core from "../src/core/solfege-core.js";
import type { Melody } from "../src/core/solfege-core.js";
import { makeConfig } from "../src/audio/config.ts";
import { analyzeBuffer } from "../src/audio/dsp.ts";
import { targetNotes, beatTimes, estimateClickLatency } from "../src/judge/judge.ts";
import type { TakeResult } from "../src/judge/judge.ts";
import { countBeatsFor } from "../src/core/exercise.ts";
import { renderTake } from "./helpers/synth.ts";
import type { SingerOptions } from "./helpers/synth.ts";
import { runPipeline } from "./helpers/pipeline.ts";
import { info } from "./helpers/check.ts";

const PER = +(process.env.PER ?? 3);
const EXTRA_PER = Math.min(PER, +(process.env.EXTRA_PER ?? 10));
const EXTRA = process.env.EXTRA !== "0";
const [L0, L1] = (process.env.LEVELS ?? "1-8").split("-").map(Number);
const cfg = makeConfig();
const RT = 0.085; // スピーカー → マイクの往復遅延（合成上の値）

interface Ctx { m: Melody; bpm: number; seed: number; n: number; rng: () => number }
interface Scenario {
  id: string;
  label: string;
  per: number;
  /** 合成の条件 */
  synth: (c: Ctx) => Partial<SingerOptions>;
  sampleRate?: number;
  tempoScale?: number;
  /** 判定側が知っている往復遅延（未補正の試験では 0） */
  assumedRoundTrip?: number;
  /** 実際の往復遅延（既定 RT） */
  actualRoundTrip?: number;
  /** カウントのクリックも録音に入れ、そこから推定したクリックの遅れでマスクする（往復遅延を測っていない場合のアプリの動き） */
  countIn?: boolean;
  /** 合否。失敗理由の文字列を返す（null = 合格） */
  check: (r: TakeResult, c: Ctx, extra: Record<string, number>) => string | null;
  /** 集計する測定値 */
  measure?: (r: TakeResult, c: Ctx, acc: Record<string, number[]>) => void;
  /** 測定値の要約 */
  report?: (acc: Record<string, number[]>) => string;
  /** 参考の条件（失敗しても合否に数えない） */
  informational?: boolean;
  /**
   * 全量の試験で失敗することが分かっている課題（ハンドオフ文書 §18）。これ以外が失敗したらテストは落ちる。
   * どちらも原因が分かっていて、そのまま残すと決めたもの。
   */
  knownFailures?: string[];
}

const allHit = (r: TakeResult) => r.notes.every((n) => n.status === "good" || n.status === "ok");
const desc = (r: TakeResult) => r.notes.map((n) => n.status[0] + (n.devCents == null ? "" : Math.round(n.devCents))).join(" ") + ` Δ=${r.offsetMs}`;
const range = (a: number[] | undefined, d = 1) => (a && a.length ? `${Math.min(...a).toFixed(d)}〜${Math.max(...a).toFixed(d)}` : "-");
const q = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const push = (acc: Record<string, number[]>, k: string, v: number) => { (acc[k] ??= []).push(v); };

const SUBST = [1, 2, 3, 4, 5, -1, -2, -3, -4, -5];
// 歌った音が検出範囲（〜900Hz）を超えないよう、MIDI 81（A5 = 880Hz）を超えるときは向きを逆にする
const subst = (c: Ctx) => {
  const index = Math.floor(c.rng() * c.n);
  let semitones = SUBST[Math.floor(c.rng() * SUBST.length)];
  if (c.m.notes[index].midi + semitones > 81) semitones = -semitones;
  return { index, semitones };
};
const checkSubst = (r: TakeResult, c: Ctx, e: Record<string, number>) => {
  const idx = e.index, semis = e.semitones;
  const want = ((c.m.notes[idx].solfa + semis) % 12 + 12) % 12;
  const conf = Core.NAMES[c.m.notes[idx].solfa] + ">" + Core.NAMES[want];
  const ok = r.notes.every((n, k) => (k === idx ? n.status === "wrong" && n.sungSolfa === want : n.status === "good" || n.status === "ok"));
  return ok && r.confusions.length === 1 && r.confusions[0] === conf ? null : `#${idx} ${semis > 0 ? "+" : ""}${semis} 期待 ${conf} 実際 [${r.confusions}] ${desc(r)}`;
};
const unsungIdx = (c: Ctx) => Math.floor(c.rng() * c.n);
const checkUnsung = (r: TakeResult, _c: Ctx, e: Record<string, number>) =>
  r.notes.every((n, k) => (k === e.index ? n.status === "silent" : n.status === "good" || n.status === "ok")) ? null : `#${e.index} ${desc(r)}`;
const measPerfect = (r: TakeResult, _c: Ctx, acc: Record<string, number[]>) => {
  r.notes.forEach((n) => { if (n.devCents != null) push(acc, "absdev", Math.abs(n.devCents)); push(acc, n.status === "good" ? "good" : "notgood", 1); });
  push(acc, "offset", r.offsetMs);
};
const repPerfect = (acc: Record<string, number[]>) =>
  `音ごとの |ずれ| 中央値 ${q(acc.absdev, 0.5).toFixed(1)}・95% ${q(acc.absdev, 0.95).toFixed(1)}・最大 ${Math.max(...acc.absdev).toFixed(1)} セント／good ${(acc.good ?? []).length}・それ以外 ${(acc.notgood ?? []).length}／Δ ${range(acc.offset, 0)}ms`;

const MAIN: Scenario[] = [
  { id: "perfect", label: "正確に歌う", per: PER, synth: () => ({}), check: (r) => (r.passed ? null : desc(r)), measure: measPerfect, report: repPerfect },
  {
    id: "plus30vib", label: "全音 +30 セント（ビブラートあり）", per: PER, synth: () => ({ centsOffset: 30 }),
    check: (r) => (allHit(r) && Math.abs((r.meanDevCents as number) - 30) <= 5 ? null : `mean ${r.meanDevCents?.toFixed(1)} ${desc(r)}`),
    measure: (r, _c, acc) => { push(acc, "mean", r.meanDevCents as number); push(acc, "allok", r.notes.every((n) => n.status === "ok") ? 1 : 0); r.notes.forEach((n) => push(acc, "noteok", n.status === "ok" ? 1 : 0)); },
    report: (acc) => `平均ずれ ${range(acc.mean)} セント／全音 ok の課題 ${acc.allok.filter((x) => x).length}/${acc.allok.length}／ok と判定された音 ${acc.noteok.filter((x) => x).length}/${acc.noteok.length}（残りは good）`,
  },
  {
    id: "plus30flat", label: "全音 +30 セント（ビブラートなし）→ 全音 ok", per: PER, synth: () => ({ centsOffset: 30, vibratoCents: 0 }),
    check: (r) => (r.notes.every((n) => n.status === "ok") && Math.abs((r.meanDevCents as number) - 30) <= 5 ? null : `mean ${r.meanDevCents?.toFixed(1)} ${desc(r)}`),
    measure: (r, _c, acc) => { push(acc, "mean", r.meanDevCents as number); r.notes.forEach((n) => push(acc, "dev", n.devCents ?? NaN)); },
    report: (acc) => `平均ずれ ${range(acc.mean)} セント／音ごとのずれ ${range(acc.dev)} セント`,
    // §18.4: 6/8 の 16 分音符 1 音が +24.2 セント（good）になる。判定の境目の問題としてそのまま残す
    knownFailures: ["Lv7-70003"],
  },
  { id: "subst", label: "1 音を別の音（±1〜5 半音）で歌う", per: PER, synth: () => ({}), check: checkSubst },
  {
    id: "lag200", label: "全体に +200ms 遅れて歌う", per: PER, synth: () => ({ lagMs: 200 }),
    check: (r) => (r.passed && Math.abs(r.offsetMs - 200) <= 40 ? null : desc(r)),
    measure: (r, _c, acc) => push(acc, "offset", r.offsetMs),
    report: (acc) => `報告された Δ ${range(acc.offset, 0)}ms（中央値 ${q(acc.offset, 0.5)}ms）`,
  },
  { id: "octave", label: "1 オクターブ下で歌う", per: PER, synth: () => ({ transpose: -12 }), check: (r) => (r.passed ? null : desc(r)) },
  {
    id: "silence", label: "歌わない（雑音 −60dBFS とクリックだけ）", per: PER, synth: () => ({ voice: false, noiseDbfs: -60 }),
    check: (r) => (r.notes.every((n) => n.status === "silent") ? null : desc(r)),
  },
  { id: "unsung", label: "1 音だけ歌わない", per: PER, synth: () => ({}), check: checkUnsung },
];

const EXTRAS: Scenario[] = [
  { id: "perfect441", label: "44.1kHz・正確に歌う", per: EXTRA_PER, sampleRate: 44100, synth: () => ({}), check: (r) => (r.passed ? null : desc(r)) },
  { id: "subst441", label: "44.1kHz・1 音を別の音で", per: EXTRA_PER, sampleRate: 44100, synth: () => ({}), check: checkSubst },
  { id: "perfectSnr20", label: "SN 比 20dB・正確に歌う", per: EXTRA_PER, synth: () => ({ noiseSnrDb: 20 }), check: (r) => (r.passed ? null : desc(r)) },
  { id: "substSnr20", label: "SN 比 20dB・1 音を別の音で", per: EXTRA_PER, synth: () => ({ noiseSnrDb: 20 }), check: checkSubst },
  {
    id: "uncalPerfect", label: "往復遅延を測っていない（実 85ms、判定側 0、カウントから推定してマスク）・正確に歌う", per: EXTRA_PER, assumedRoundTrip: 0, countIn: true, synth: () => ({}),
    check: (r) => (r.passed ? null : desc(r)), measure: (r, _c, acc) => push(acc, "offset", r.offsetMs), report: (acc) => `Δ ${range(acc.offset, 0)}ms／推定したクリックの遅れ ${range(acc.clickLatency, 1)}ms`,
  },
  { id: "uncalSubst", label: "往復遅延を測っていない（実 85ms）・1 音を別の音で", per: EXTRA_PER, assumedRoundTrip: 0, countIn: true, synth: () => ({}), check: checkSubst },
  {
    id: "uncal200Perfect", label: "往復遅延を測っていない（実 200ms）・正確に歌う", per: EXTRA_PER, assumedRoundTrip: 0, actualRoundTrip: 0.2, countIn: true, synth: () => ({}),
    check: (r) => (r.passed ? null : desc(r)), measure: (r, _c, acc) => push(acc, "offset", r.offsetMs), report: (acc) => `Δ ${range(acc.offset, 0)}ms／推定したクリックの遅れ ${range(acc.clickLatency, 1)}ms`,
  },
  {
    id: "uncalNoMask", label: "（参考）往復遅延を測っておらず、推定もしない（実 85ms、マスクは拍の時刻のまま）・正確に歌う", per: EXTRA_PER, assumedRoundTrip: 0, synth: () => ({}),
    check: (r) => (r.passed ? null : desc(r)), informational: true,
  },
  { id: "fastPerfect", label: "テンポ 1.4 倍・正確に歌う", per: EXTRA_PER, tempoScale: 1.4, synth: () => ({}), check: (r) => (r.passed ? null : desc(r)), measure: measPerfect, report: repPerfect },
  { id: "fastSubst", label: "テンポ 1.4 倍・1 音を別の音で", per: EXTRA_PER, tempoScale: 1.4, synth: () => ({}), check: checkSubst },
  {
    id: "fastUnsung", label: "テンポ 1.4 倍・1 音だけ歌わない", per: EXTRA_PER, tempoScale: 1.4, synth: () => ({}), check: checkUnsung,
    // §18.3: 歌わなかった短い音が隣の音に引きずられて wrong になる。アプリのテンポの上限を 1.2 倍にして対処した（範囲外の条件）
    knownFailures: ["Lv8-80007"],
  },
  // アプリのテンポの上限（既定 × 1.2）。reference/test/tempo-check.ts と同じ条件を通常の試験にも入れた
  { id: "limitUnsung", label: "テンポ 1.2 倍（アプリの上限）・1 音だけ歌わない", per: EXTRA_PER, tempoScale: 1.2, synth: () => ({}), check: checkUnsung },
];

function runScenario(sc: Scenario): { pass: number; total: number; fails: { id: string; why: string }[]; acc: Record<string, number[]> } {
  const out = { pass: 0, total: 0, fails: [] as { id: string; why: string }[], acc: {} as Record<string, number[]> };
  for (let lv = L0; lv <= (L1 ?? L0); lv++) {
    for (let i = 0; i < sc.per; i++) {
      const seed = 10000 * lv + i; // 課題番号に相当（同じ seed なら同じ課題）
      const m = Core.genMelody(lv, { exercise: "sight" }, Core.makeRng(seed));
      const bpm = Core.levelTempo(lv, m.rhythm.meter) * (sc.tempoScale ?? 1);
      const notes = targetNotes(m, bpm);
      const beats = beatTimes(m, bpm);
      const c: Ctx = { m, bpm, seed, n: notes.length, rng: Core.makeRng(seed * 7 + sc.id.length) };
      const extra: Record<string, number> = {};
      let synth = sc.synth(c);
      if (sc.id.startsWith("subst") || sc.id.endsWith("Subst")) { const s = subst(c); extra.index = s.index; extra.semitones = s.semitones; synth = { ...synth, substitute: s }; }
      if (sc.id === "unsung" || sc.id.endsWith("Unsung")) { extra.index = unsungIdx(c); synth = { ...synth, unsung: [extra.index] }; }
      const sr = sc.sampleRate ?? 48000;
      const rt = sc.actualRoundTrip ?? RT;
      const beat = 60 / bpm, m0 = m.rhythm.meter;
      const countBeats = countBeatsFor(m0); // 2/4・6/8 は 2 小節、3/4・4/4 は 1 小節
      const countTimes = sc.countIn ? Array.from({ length: countBeats }, (_, k) => -(countBeats - k) * beat) : [];
      const clickList = [...countTimes.map((t, k) => ({ t, accent: k % m0.beats === 0 })), ...beats];
      const audio = renderTake(m, {
        sampleRate: sr, bpm, seed, noiseSnrDb: 30, roundTripSec: rt, clicks: { times: clickList, level: 0.5 },
        prerollSec: sc.countIn ? countBeats * beat + 0.3 : 0.5, ...synth,
      });
      const assumed = sc.assumedRoundTrip ?? rt;
      let clickLatencySec = 0;
      if (sc.countIn) {
        // アプリの動き: 往復遅延を測っていなければ、カウントのクリックから遅れを推定してマスクに使う
        const fr = analyzeBuffer(audio.samples, sr, audio.startTime, cfg).map((f) => ({ ...f, t: f.t - assumed }));
        const est = estimateClickLatency(fr, countTimes, cfg);
        clickLatencySec = est ?? 0;
        push(out.acc, "clickLatency", (est ?? NaN) * 1000);
      }
      const { result } = runPipeline({
        samples: audio.samples, sampleRate: sr, startTime: audio.startTime, notes,
        clickTimes: clickList.map((b) => b.t), roundTripSec: assumed,
        clickLatencySec,
      }, cfg);
      out.total++;
      const why = sc.check(result, c, extra);
      if (why === null) out.pass++; else out.fails.push({ id: `Lv${lv}-${seed}`, why });
      sc.measure?.(result, c, out.acc);
    }
  }
  return out;
}

for (const sc of EXTRA ? [...MAIN, ...EXTRAS] : MAIN) {
  test(`通し試験 Lv${L0}〜${L1 ?? L0} × ${sc.per} 課題: ${sc.label}`, () => {
    const r = runScenario(sc);
    info(sc.label, `${r.pass}/${r.total}` + (sc.report ? `　${sc.report(r.acc)}` : "") + (r.fails.length ? `　失敗 ${r.fails.map((f) => `${f.id}: ${f.why}`).join(" / ")}` : ""));
    if (sc.informational) return;
    const unexpected = r.fails.filter((f) => !(sc.knownFailures ?? []).includes(f.id));
    expect(unexpected.map((f) => `${f.id}: ${f.why}`), `${sc.label} ${r.pass}/${r.total}`).toEqual([]);
  });
}
