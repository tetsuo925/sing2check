// ループバック試験のテスト（合成）（参照実装 reference/test から移植）
import { makeConfig } from "../src/audio/config.ts";
import { measureLoopback } from "../src/audio/loopback.ts";
import { test } from "vitest";
import { check, info } from "./helpers/check.ts";

const cfg = makeConfig();
const RATE = 24000, START = 100.0;
const SCHED = [100.3, 101.1, 101.9, 102.7]; // 0.8 秒おきに 4 回

/** スピーカー → マイクを模した録音: 遅れ・音量・高さの倍率（実効サンプルレートのずれ）・雑音・残響 1 本 */
function record(delaySec: number, gain: number, rateFactor = 1, noiseDb = -55, seed = 1): Float32Array {
  const n = Math.floor(3.4 * RATE), x = new Float32Array(n);
  for (const s of SCHED) {
    const a = Math.floor((s + delaySec - START) * RATE), len = Math.floor(0.3 * RATE), ramp = Math.floor(0.005 * RATE);
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / ramp, (len - 1 - i) / ramp);
      const v = gain * env * Math.sin(2 * Math.PI * 440 * rateFactor * i / RATE);
      if (a + i < n) x[a + i] += v;
      const r = a + i + Math.floor(0.012 * RATE); // 12ms 後の反射（−10dB）
      if (r < n) x[r] += 0.3 * v;
    }
  }
  let st = seed;
  const nl = Math.pow(10, noiseDb / 20) * Math.sqrt(3);
  for (let i = 0; i < n; i++) { st = (st * 1103515245 + 12345) & 0x7fffffff; x[i] += nl * (2 * st / 0x7fffffff - 1); }
  return x;
}

for (const d of [0.012, 0.085, 0.23]) {
  test(`遅れ ${d * 1000}ms を ±2ms・高さを ±2 セントで測れる`, () => {
    const r = measureLoopback(record(d, 0.2), RATE, START, SCHED, cfg);
    info(`ループバック 実 ${d * 1000}ms`, `測定 ${r.roundTripMs?.toFixed(2)}ms（各回 ${r.perBeepMs.map((x) => x?.toFixed(2)).join(", ")}）、${r.detectedHz?.toFixed(2)}Hz（${r.centsError?.toFixed(2)} セント）`);
    check(r.roundTripMs !== null && Math.abs(r.roundTripMs - d * 1000) <= 2, "latency");
    check(r.centsError !== null && Math.abs(r.centsError) <= 2 && !r.pitchAbnormal && !r.unstable, "pitch");
  });
}

test("実効サンプルレートが 2% ずれた入力（高さ +34 セント）は異常として出る", () => {
  const r = measureLoopback(record(0.085, 0.2, 1.02), RATE, START, SCHED, cfg);
  info("サンプルレート 2% ずれ", `${r.detectedHz?.toFixed(2)}Hz（${r.centsError?.toFixed(1)} セント）、異常 = ${r.pitchAbnormal}`);
  check(r.pitchAbnormal, "abnormal");
});

test("音がマイクに届かない（イヤホン）→ 測れない（null）", () => {
  const r = measureLoopback(record(0.085, 0), RATE, START, SCHED, cfg);
  check(r.roundTripMs === null && r.detectedHz === null, "null");
});

