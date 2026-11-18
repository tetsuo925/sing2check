// ループバック試験（マイクの確認シート）: 440Hz・300ms の音を 4 回鳴らしてマイクで拾い、
// 検出した高さと往復の遅れを求める。純関数。
import type { Sing2CheckConfig } from "./config.ts";
import { analyzeBuffer } from "./dsp.ts";

export interface LoopbackResult {
  /** 往復の遅れ（ms、4 回の中央値）。検出できなければ null */
  roundTripMs: number | null;
  /** 各回の遅れ（ms、検出できなかった回は null） */
  perBeepMs: (number | null)[];
  /** 検出した高さ（Hz、有声フレームの中央値） */
  detectedHz: number | null;
  /** 期待の高さからのずれ（セント） */
  centsError: number | null;
  /** |centsError| が許容を超えた（入力系の異常） */
  pitchAbnormal: boolean;
  /** 遅れが 4 回で 10ms 以上ばらついた（測り直しを勧める） */
  unstable: boolean;
}

function median(a: number[]): number {
  const s = a.slice().sort((x, y) => x - y), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * pcm: マイクの PCM（モノラル、rate Hz）。pcmStartTime: pcm[0] の時刻（AudioContext の秒）。
 * scheduled: 試験音を鳴らした予定時刻（AudioContext の秒）。
 * 遅れ = 予定時刻から「包絡がその回の最大値の 30% を初めて超えた時刻」まで（探索は予定時刻から +500ms まで）。
 */
export function measureLoopback(
  pcm: Float32Array, rate: number, pcmStartTime: number, scheduled: number[], cfg: Sing2CheckConfig,
  opts: { toneHz?: number; toneSec?: number; maxDelaySec?: number; centsTolerance?: number } = {},
): LoopbackResult {
  const toneHz = opts.toneHz ?? 440, toneSec = opts.toneSec ?? 0.3, maxDelay = opts.maxDelaySec ?? 0.5, tol = opts.centsTolerance ?? 30;
  // 1ms の窓の絶対値の最大で包絡を作る
  const win = Math.max(1, Math.round(rate * 0.001));
  const per: (number | null)[] = scheduled.map((s) => {
    const a = Math.max(0, Math.floor((s - pcmStartTime) * rate));
    const b = Math.min(pcm.length, Math.floor((s + maxDelay + toneSec - pcmStartTime) * rate));
    if (b - a < win * 10) return null;
    // 試験音の前 100ms の雑音レベル
    let noise = 0;
    const n0 = Math.max(0, a - Math.floor(0.1 * rate));
    for (let i = n0; i < a; i++) noise = Math.max(noise, Math.abs(pcm[i]));
    let peak = 0;
    for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    if (peak < Math.max(1e-4, noise * 4)) return null; // 聞こえていない
    const th = 0.3 * peak;
    for (let i = a; i < b; i++) if (Math.abs(pcm[i]) >= th) return ((i - a) / rate + (a / rate + pcmStartTime - s)) * 1000;
    return null;
  });
  const got = per.filter((x): x is number => x !== null);
  const roundTripMs = got.length >= 2 ? median(got) : null;
  // 高さ: 各回の [予定 + 遅れ + 50ms, 予定 + 遅れ + 300ms − 50ms] の有声フレーム
  let detectedHz: number | null = null;
  if (roundTripMs !== null) {
    const frames = analyzeBuffer(pcm, rate, pcmStartTime, { ...cfg, decimation: rate > 32000 ? 2 : 1 });
    const f0s: number[] = [];
    for (const s of scheduled) {
      const a = s + roundTripMs / 1000 + 0.05, b = s + roundTripMs / 1000 + toneSec - 0.05;
      for (const f of frames) if (f.t >= a && f.t <= b && f.f0 !== null && f.clarity >= cfg.minClarity) f0s.push(f.f0);
    }
    if (f0s.length) detectedHz = median(f0s);
  }
  const centsError = detectedHz !== null ? 1200 * Math.log2(detectedHz / toneHz) : null;
  return {
    roundTripMs, perBeepMs: per, detectedHz, centsError,
    pitchAbnormal: centsError !== null && Math.abs(centsError) >= tol,
    unstable: got.length >= 2 && Math.max(...got) - Math.min(...got) > 10,
  };
}
