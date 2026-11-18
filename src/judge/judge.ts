// 判定（純関数）。judgeTake(notes, frames, opts)
import type { Sing2CheckConfig } from "../audio/config.ts";
import type { Frame } from "../audio/dsp.ts";
import Core from "../core/solfege-core.js";
import type { Melody } from "../core/solfege-core.js";

const NAMES = Core.NAMES;
function mod(a: number, n: number): number { return ((a % n) + n) % n; }

/** 正解の音。時間は課題開始（最初の拍）= 0 秒 */
export interface TargetNote {
  midi: number;
  /** 階名（ドからの半音数） */
  solfa: number;
  onSec: number;
  offSec: number;
}

export interface JudgeOptions {
  config: Sing2CheckConfig;
  /** 解析フレーム 1 つの長さ（秒）= frameSize × decimation / 入力サンプルレート。PitchAnalyzer.frameDurSec */
  frameDurSec: number;
  /**
   * クリックが鳴った時刻（秒、フレームと同じ時間軸）。クリックを鳴らさなかったときは空配列。
   * フレームの時間軸を往復遅延で補正していないときは、補正していない分を clickLatencySec に入れる。
   */
  clickTimes?: number[];
  clickLatencySec?: number;
}

export type NoteStatus = "good" | "ok" | "wrong" | "silent";

export interface NoteResult {
  index: number;
  midi: number;
  solfa: number;
  status: NoteStatus;
  /** 窓内の中央値のずれ（セント、オクターブを畳んだ値 −600〜+600）。silent は null */
  devCents: number | null;
  /** 被覆率 0〜1 */
  coverage: number;
  /** 判定に使った窓（秒、Δ を含む） */
  windowStart: number;
  windowEnd: number;
  /** wrong のとき: 歌った音に最も近い半音の階名 */
  sungSolfa: number | null;
  /** 直前の音からの音程（半音、符号つき）。最初の音は null */
  intervalFromPrevious: number | null;
}

export interface TraceFrame {
  t: number;
  /** 有声ならセント値（6900 + 1200·log2(f0/440)、中央値フィルタ後）、無声は null */
  cents: number | null;
  /** クリックのマスクで除いたフレーム */
  masked: boolean;
}

export interface TakeResult {
  notes: NoteResult[];
  count: number;
  /** good + ok の数 */
  correct: number;
  passed: boolean;
  /** good/ok の音の平均ずれ（符号つき、セント）。該当なしは null */
  meanDevCents: number | null;
  /** good/ok の音の |ずれ| の平均 */
  meanAbsDevCents: number | null;
  /** 音の順番に対する回帰直線で、最初の音から最後の音までに動いたセント。good/ok が 3 音未満なら null */
  driftCents: number | null;
  /** 採用した全体の時間ずれ（ms）。正 = 遅れ */
  offsetMs: number;
  /** Δ 合わせの得点（各音の「音程が合っている有声フレームの割合」の合計、0〜音数）。0 なら offsetMs は意味を持たない */
  offsetScore: number;
  /** 取り違え "出題>回答"（階名の表示名） */
  confusions: string[];
  trace: TraceFrame[];
}

export function hzToCents(f0: number): number { return 6900 + 1200 * Math.log2(f0 / 440); }
/** オクターブを畳んだずれ −600〜+600 */
export function foldDev(cents: number, targetMidi: number): number {
  return mod(cents - targetMidi * 100 + 600, 1200) - 600;
}

function median(a: number[]): number {
  const s = a.slice().sort((x, y) => x - y), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** 有声判定 → クリックのマスク → セント値 → 中央値フィルタ */
export function prepareTrace(frames: Frame[], opts: JudgeOptions): TraceFrame[] {
  const cfg = opts.config;
  const lat = opts.clickLatencySec ?? 0;
  const clicks = (opts.clickTimes ?? []).slice().sort((a, b) => a - b);
  const half = opts.frameDurSec / 2;
  const pre = cfg.clickMaskPreMs / 1000, post = (cfg.clickDurMs + cfg.clickMaskPostMs) / 1000;
  let ci = 0;
  const raw: TraceFrame[] = frames.map((f) => {
    // フレーム [t−half, t+half] がクリック区間 [c+lat−pre, c+lat+post] と重なればマスク
    while (ci < clicks.length && clicks[ci] + lat + post < f.t - half) ci++;
    const masked = ci < clicks.length && clicks[ci] + lat - pre <= f.t + half;
    const voiced = !masked && f.f0 !== null && f.clarity >= cfg.minClarity && f.rmsDb >= cfg.gateDb;
    return { t: f.t, cents: voiced ? hzToCents(f.f0 as number) : null, masked };
  });
  // 中央値フィルタ（有声フレームだけ、前後 medianFrames/2 の範囲の有声フレームで）
  const h = Math.floor(cfg.medianFrames / 2);
  return raw.map((f, i) => {
    if (f.cents === null) return f;
    const vals: number[] = [];
    for (let k = i - h; k <= i + h; k++) if (k >= 0 && k < raw.length && raw[k].cents !== null) vals.push(raw[k].cents as number);
    return { t: f.t, cents: median(vals), masked: f.masked };
  });
}

interface WindowStat { coverage: number; dev: number | null; start: number; end: number; }

function windowStat(note: TargetNote, trace: TraceFrame[], times: Float64Array, delta: number, cfg: Sing2CheckConfig): WindowStat {
  const dur = note.offSec - note.onSec;
  let start = note.onSec + delta + Math.max(cfg.windowHeadMinMs / 1000, dur * cfg.windowHeadRatio);
  let end = note.offSec + delta - dur * cfg.windowTailRatio;
  let st = collect(trace, times, start, end, note.midi);
  if (st.total < cfg.minWindowFrames) {
    start = note.onSec + delta; end = note.offSec + delta;
    st = collect(trace, times, start, end, note.midi);
  }
  const coverage = st.total ? st.devs.length / st.total : 0;
  return { coverage, dev: st.devs.length ? median(st.devs) : null, start, end };
}

function collect(trace: TraceFrame[], times: Float64Array, start: number, end: number, midi: number): { total: number; devs: number[] } {
  // 二分探索で start 以上の最初のフレーム
  let lo = 0, hi = times.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] < start) lo = m + 1; else hi = m; }
  let total = 0;
  const devs: number[] = [];
  for (let i = lo; i < trace.length && times[i] <= end; i++) {
    const f = trace[i];
    if (f.masked) continue;
    total++;
    if (f.cents !== null) devs.push(foldDev(f.cents, midi));
  }
  return { total, devs };
}

export function judgeTake(notes: TargetNote[], frames: Frame[], opts: JudgeOptions): TakeResult {
  const cfg = opts.config;
  const trace = prepareTrace(frames, opts);
  const times = Float64Array.from(trace, (f) => f.t);

  // 全体の時間ずれ Δ
  // 設計メモ §5-3 は「条件を満たす音の数」が最大の Δ（同点は |Δ| が小さい方）。
  // 合成信号の検証で、音の数は Δ に対して平らすぎて Δ が定まらず（+200ms の遅れを 0〜170ms と報告）、
  // 取り違えのある課題で別の Δ に引き寄せられることがあった。そこで各音の「窓全体 [on+Δ, off+Δ] のうち
  // |ずれ| ≤ deltaMatchCents の有声フレームの割合」の合計（= 音の数のなめらかな版）を得点にする。
  // 得点の山は頂上が平らなので、最大値の (1 − deltaPlateauRatio) 倍以上が続く範囲（最大点を含む連続した範囲）の中点を採る。
  const deltas: number[] = [], scores: number[] = [];
  for (let ms = cfg.deltaMinMs; ms <= cfg.deltaMaxMs + 1e-9; ms += cfg.deltaStepMs) {
    const delta = ms / 1000;
    let score = 0;
    for (const n of notes) {
      const full = collect(trace, times, n.onSec + delta, n.offSec + delta, n.midi);
      if (full.total) {
        let inTune = 0;
        for (const d of full.devs) if (Math.abs(d) <= cfg.deltaMatchCents) inTune++;
        score += inTune / full.total;
      }
    }
    deltas.push(ms); scores.push(score);
  }
  let best = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[best] + 1e-9 || (Math.abs(scores[i] - scores[best]) <= 1e-9 && Math.abs(deltas[i]) < Math.abs(deltas[best]))) best = i;
  }
  const bestScore = scores[best];
  let bestDelta = 0;
  if (bestScore > 0) {
    const floor = bestScore * (1 - cfg.deltaPlateauRatio);
    let lo = best, hi = best;
    while (lo > 0 && scores[lo - 1] >= floor) lo--;
    while (hi < scores.length - 1 && scores[hi + 1] >= floor) hi++;
    bestDelta = (deltas[lo] + deltas[hi]) / 2 / 1000;
  }

  const results: NoteResult[] = notes.map((n, i) => {
    const w = windowStat(n, trace, times, bestDelta, cfg);
    let status: NoteStatus, sung: number | null = null;
    if (w.coverage < cfg.minCoverage || w.dev === null) status = "silent";
    else if (Math.abs(w.dev) <= cfg.goodCents) status = "good";
    else if (Math.abs(w.dev) <= cfg.okCents) status = "ok";
    else { status = "wrong"; sung = mod(n.solfa + Math.round(w.dev / 100), 12); }
    return {
      index: i, midi: n.midi, solfa: n.solfa, status,
      devCents: status === "silent" ? null : w.dev,
      coverage: w.coverage, windowStart: w.start, windowEnd: w.end, sungSolfa: sung,
      intervalFromPrevious: i > 0 ? n.midi - notes[i - 1].midi : null,
    };
  });

  const hit = results.filter((r) => r.status === "good" || r.status === "ok");
  const devs = hit.map((r) => r.devCents as number);
  const meanDev = devs.length ? devs.reduce((s, x) => s + x, 0) / devs.length : null;
  const meanAbs = devs.length ? devs.reduce((s, x) => s + Math.abs(x), 0) / devs.length : null;
  let drift: number | null = null;
  if (hit.length >= 3) {
    const xs = hit.map((r) => r.index);
    const mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = meanDev as number;
    let sxy = 0, sxx = 0;
    for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (devs[k] - my); sxx += (xs[k] - mx) ** 2; }
    drift = sxx > 0 ? (sxy / sxx) * (xs[xs.length - 1] - xs[0]) : 0;
  }
  const confusions = results.filter((r) => r.status === "wrong").map((r) => NAMES[mod(r.solfa, 12)] + ">" + NAMES[r.sungSolfa as number]);

  return {
    notes: results,
    count: notes.length,
    correct: hit.length,
    passed: notes.length > 0 && hit.length === notes.length,
    meanDevCents: meanDev,
    meanAbsDevCents: meanAbs,
    driftCents: drift,
    offsetMs: Math.round(bestDelta * 1000),
    offsetScore: Math.max(0, bestScore),
    confusions,
    trace,
  };
}

/**
 * solfege-core の旋律から正解の音列を作る（課題開始 = 最初の小節の頭 = 0 秒）。
 * bpm は 1 拍あたり（6/8 は付点四分）。
 */
export function targetNotes(melody: Melody, bpm: number): TargetNote[] {
  const bt = melody.rhythm.meter.beatTicks;
  return melody.notes.map((n) => ({
    midi: n.midi, solfa: n.solfa,
    onSec: Core.ticksToSec(n.startTick, bpm, bt),
    offSec: Core.ticksToSec(n.startTick + n.dur, bpm, bt),
  }));
}

/** 課題中のクリック（拍頭）の時刻（秒）。count-in は含まない。accent = 小節の頭 */
export function beatTimes(melody: Melody, bpm: number): { t: number; accent: boolean }[] {
  const m = melody.rhythm.meter, out: { t: number; accent: boolean }[] = [];
  const nBeats = Math.round(melody.rhythm.totalTicks / m.beatTicks);
  for (let b = 0; b < nBeats; b++) out.push({ t: b * 60 / bpm, accent: b % m.beats === 0 });
  return out;
}

/**
 * カウントのクリックがマイクに届いた遅れを、フレームの RMS から推定する（往復の遅れを測っていないとき用）。
 * countClickTimes: カウントのクリックの時刻（フレームと同じ時間軸。課題開始より前なので負）。
 * 各クリックについて、直前 [c−150ms, c−20ms] の RMS の中央値を基準に、[c, c+maxSec] で RMS が最大のフレームを探す。
 * 基準より minRiseDb 以上大きければ「届いた」とし、遅れ = そのフレームの時刻 − c − クリック長/2（フレーム中心とクリック中心が重なる所が最大になるため）。
 * 2 個以上届いていれば中央値（秒）を返す。届いていなければ null（イヤホンなど。マスクは 0 のままでよい）。
 */
export function estimateClickLatency(frames: Frame[], countClickTimes: number[], cfg: Sing2CheckConfig,
  opts: { maxSec?: number; minRiseDb?: number } = {}): number | null {
  const maxSec = opts.maxSec ?? 0.4, rise = opts.minRiseDb ?? 15;
  const est: number[] = [];
  for (const c of countClickTimes) {
    const base = frames.filter((f) => f.t >= c - 0.15 && f.t <= c - 0.02).map((f) => f.rmsDb).filter((x) => Number.isFinite(x));
    const b = base.length ? median(base) : -120;
    let peak: Frame | null = null;
    for (const f of frames) if (f.t >= c && f.t <= c + maxSec && (peak === null || f.rmsDb > peak.rmsDb)) peak = f;
    if (peak && peak.rmsDb - b >= rise) est.push(peak.t - c - cfg.clickDurMs / 2000);
  }
  return est.length >= 2 ? Math.max(0, median(est)) : null;
}
