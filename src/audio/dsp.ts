// 前処理（ハイパス → ローパス → 間引き）と YIN。依存なしの純粋な TypeScript。
// ワークレットはこの PitchAnalyzer を薄く包むだけにする（sing2check-handoff.md §音声グラフ）。
import type { Sing2CheckConfig } from "./config.ts";

/** 解析フレーム 1 つ。t は秒（呼び出し側が渡した時間軸。フレームの中心時刻） */
export interface Frame {
  t: number;
  f0: number | null;
  clarity: number;
  rmsDb: number;
}

/* ---------------- 双 2 次フィルタ（直接形 II 転置） ---------------- */
export class Biquad {
  private b0: number; private b1: number; private b2: number; private a1: number; private a2: number;
  private z1 = 0; private z2 = 0;
  constructor(b0: number, b1: number, b2: number, a1: number, a2: number) {
    this.b0 = b0; this.b1 = b1; this.b2 = b2; this.a1 = a1; this.a2 = a2;
  }
  /** RBJ Audio EQ Cookbook のローパス / ハイパス */
  static make(kind: "lowpass" | "highpass", fs: number, f0: number, q: number): Biquad {
    const w0 = 2 * Math.PI * f0 / fs, cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    if (kind === "lowpass") {
      const b = (1 - cw) / 2;
      return new Biquad(b / a0, (1 - cw) / a0, b / a0, (-2 * cw) / a0, (1 - alpha) / a0);
    }
    const b = (1 + cw) / 2;
    return new Biquad(b / a0, -(1 + cw) / a0, b / a0, (-2 * cw) / a0, (1 - alpha) / a0);
  }
  step(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** n 次（n = 2·sections）バターワースの各段の Q */
export function butterworthQs(sections: number): number[] {
  const n = 2 * sections, qs: number[] = [];
  for (let k = 0; k < sections; k++) qs.push(1 / (2 * Math.cos(Math.PI * (2 * k + 1) / (2 * n))));
  return qs;
}

/* ---------------- 前処理（ストリーム） ---------------- */
export class Preprocessor {
  readonly inputRate: number;
  readonly outputRate: number;
  private filters: Biquad[];
  private dec: number;
  private phase = 0;
  constructor(inputRate: number, cfg: Sing2CheckConfig) {
    this.inputRate = inputRate;
    this.dec = cfg.decimation;
    this.outputRate = inputRate / cfg.decimation;
    this.filters = [Biquad.make("highpass", inputRate, cfg.hpfHz, Math.SQRT1_2)];
    for (const q of butterworthQs(cfg.lpfSections)) this.filters.push(Biquad.make("lowpass", inputRate, cfg.lpfHz, q));
  }
  /** 入力（モノラル、入力のサンプルレート）→ 間引き後のサンプル */
  process(input: Float32Array): Float32Array {
    const out = new Float32Array(Math.ceil((input.length + this.dec) / this.dec));
    let n = 0;
    const fl = this.filters, nf = fl.length;
    for (let i = 0; i < input.length; i++) {
      let x = input[i];
      for (let k = 0; k < nf; k++) x = fl[k].step(x);
      if (this.phase === 0) out[n++] = x;
      this.phase = (this.phase + 1) % this.dec;
    }
    return out.subarray(0, n);
  }
}

/* ---------------- YIN ---------------- */
export interface YinScratch { d: Float64Array; dp: Float64Array; }
export function makeYinScratch(tauMax: number): YinScratch {
  return { d: new Float64Array(tauMax + 2), dp: new Float64Array(tauMax + 2) };
}

/**
 * YIN（de Cheveigné & Kawahara 2002）の手順 1〜4 + 放物線補間。
 * x: 長さ frameSize のフレーム。積分窓 W = frameSize − tauMax。
 * しきい値を下回る谷が無ければ f0 = null（clarity は全体の最小値から出す）。
 */
export function yin(x: Float32Array, fs: number, cfg: Sing2CheckConfig, s?: YinScratch): { f0: number | null; clarity: number } {
  const tauMin = Math.max(2, Math.floor(fs / cfg.maxHz));
  const tauMax = Math.ceil(fs / cfg.minHz);
  const W = x.length - tauMax;
  if (W < 32) throw new Error("frame too short for minHz");
  const sc = s ?? makeYinScratch(tauMax);
  const d = sc.d, dp = sc.dp;
  // 1. 差分関数
  let energy = 0;
  for (let j = 0; j < W; j++) energy += x[j] * x[j];
  if (energy < 1e-12) return { f0: null, clarity: 0 };
  for (let tau = 1; tau <= tauMax + 1 && tau + W <= x.length; tau++) {
    let sum = 0;
    for (let j = 0; j < W; j++) { const v = x[j] - x[j + tau]; sum += v * v; }
    d[tau] = sum;
  }
  const last = Math.min(tauMax + 1, x.length - W);
  // 2. 累積平均正規化差分
  dp[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= last; tau++) {
    run += d[tau];
    dp[tau] = run > 0 ? d[tau] * tau / run : 1;
  }
  // 3. 絶対しきい値: 探索範囲で最初に下回った点から谷底まで進む
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (dp[t] < cfg.yinThreshold) {
      while (t + 1 <= tauMax && dp[t + 1] < dp[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    let mn = Infinity;
    for (let t = tauMin; t <= tauMax; t++) if (dp[t] < mn) mn = dp[t];
    return { f0: null, clarity: clamp01(1 - mn) };
  }
  // 4. 放物線補間
  let better = tau, val = dp[tau];
  if (tau > 1 && tau < last) {
    const a = dp[tau - 1], b = dp[tau], c = dp[tau + 1];
    const den = a - 2 * b + c;
    if (den > 0) {
      const shift = 0.5 * (a - c) / den;
      if (Math.abs(shift) < 1) { better = tau + shift; val = b - 0.25 * (a - c) * shift; }
    }
  }
  return { f0: fs / better, clarity: clamp01(1 - val) };
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

export function rmsDb(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  const r = Math.sqrt(s / Math.max(1, x.length));
  return r > 0 ? 20 * Math.log10(r) : -Infinity;
}

/* ---------------- ストリーム解析（ワークレットの中身） ---------------- */
/**
 * 入力サンプルを任意の長さで push すると、出来たフレームを返す。
 * 時刻: 最初に push したサンプルの時刻を startTime（秒）とし、以後のサンプルは連続とみなす。
 *   ワークレットでは startTime = currentFrame / sampleRate（AudioContext の時間軸）。
 */
export class PitchAnalyzer {
  readonly cfg: Sing2CheckConfig;
  readonly inputRate: number;
  readonly rate: number;
  private pre: Preprocessor;
  private buf: Float32Array;
  private fill = 0;
  /** buf[0] が間引き後の何番目のサンプルか */
  private bufStartIndex = 0;
  private nextFrameStart = 0;
  private startTime: number | null = null;
  private scratch: YinScratch;
  private frameBuf: Float32Array;
  /** 解析フレーム 1 つの長さ（秒）。judgeTake の frameDurSec に渡す */
  readonly frameDurSec: number;
  /** 受け取った入力サンプルの総数（自己点検用） */
  inputSamples = 0;

  constructor(inputRate: number, cfg: Sing2CheckConfig) {
    this.cfg = cfg;
    this.inputRate = inputRate;
    this.pre = new Preprocessor(inputRate, cfg);
    this.rate = this.pre.outputRate;
    this.buf = new Float32Array(cfg.frameSize * 4);
    this.scratch = makeYinScratch(Math.ceil(this.rate / cfg.minHz));
    this.frameBuf = new Float32Array(cfg.frameSize);
    this.frameDurSec = cfg.frameSize * cfg.decimation / inputRate;
  }

  push(input: Float32Array, startTime?: number): Frame[] {
    if (this.startTime === null) this.startTime = startTime ?? 0;
    this.inputSamples += input.length;
    const y = this.pre.process(input);
    const out: Frame[] = [];
    let off = 0;
    while (off < y.length) {
      const room = this.buf.length - this.fill;
      const n = Math.min(room, y.length - off);
      this.buf.set(y.subarray(off, off + n), this.fill);
      this.fill += n; off += n;
      this.drain(out);
      if (this.fill === this.buf.length) {
        // 次のフレームの先頭まで詰める
        const keep = this.bufStartIndex + this.fill - this.nextFrameStart;
        this.buf.copyWithin(0, this.fill - keep, this.fill);
        this.bufStartIndex = this.nextFrameStart;
        this.fill = keep;
      }
    }
    return out;
  }

  private drain(out: Frame[]): void {
    const N = this.cfg.frameSize, H = this.cfg.hopSize, dec = this.cfg.decimation;
    while (this.nextFrameStart + N <= this.bufStartIndex + this.fill) {
      const s = this.nextFrameStart - this.bufStartIndex;
      this.frameBuf.set(this.buf.subarray(s, s + N));
      const r = yin(this.frameBuf, this.rate, this.cfg, this.scratch);
      // 間引き後の k 番目 = 入力の k·dec 番目。フレーム中心 = 開始 + N/2
      const centerInput = (this.nextFrameStart + N / 2) * dec;
      out.push({ t: (this.startTime ?? 0) + centerInput / this.inputRate, f0: r.f0, clarity: r.clarity, rmsDb: rmsDb(this.frameBuf) });
      this.nextFrameStart += H;
    }
  }
}

/** 一括解析（テスト・オフライン用）。128 サンプルずつ push してワークレットと同じ経路を通す */
export function analyzeBuffer(samples: Float32Array, inputRate: number, startTime: number, cfg: Sing2CheckConfig, chunk = 128): Frame[] {
  const a = new PitchAnalyzer(inputRate, cfg);
  const frames: Frame[] = [];
  for (let i = 0; i < samples.length; i += chunk) {
    const part = samples.subarray(i, Math.min(samples.length, i + chunk));
    for (const f of a.push(part, startTime)) frames.push(f);
  }
  return frames;
}

/* ---------------- 実効サンプルレートの自己点検 ---------------- */
/**
 * 受けたサンプル数 / 経過時間 を sampleRate と比べる。
 * elapsedSec は AudioContext とは別の時計（performance.now() の差）で測る。最低 2 秒ぶん貯めてから判定する。
 */
export function checkSampleRate(receivedSamples: number, elapsedSec: number, sampleRate: number, tolerance: number):
  { measuredRate: number; ratio: number; ok: boolean } {
  const measuredRate = elapsedSec > 0 ? receivedSamples / elapsedSec : 0;
  const ratio = measuredRate / sampleRate;
  return { measuredRate, ratio, ok: Math.abs(ratio - 1) < tolerance };
}

/** フィルタ列の振幅特性（dB）。テストと文書用 */
export function preprocessGainDb(inputRate: number, cfg: Sing2CheckConfig, hz: number): number {
  const p = new Preprocessor(inputRate, { ...cfg, decimation: 1 });
  const n = Math.floor(inputRate * 0.5), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * hz * i / inputRate);
  const y = p.process(x).subarray(Math.floor(n / 2));
  let s = 0;
  for (let i = 0; i < y.length; i++) s += y[i] * y[i];
  return 20 * Math.log10(Math.sqrt(s / y.length) / Math.SQRT1_2);
}
