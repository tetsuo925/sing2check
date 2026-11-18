// 前処理・YIN・クリックのマスク・自己点検のテスト（参照実装 reference/test から移植）
import { makeConfig } from "../src/audio/config.ts";
import { analyzeBuffer, yin, makeYinScratch, PitchAnalyzer, checkSampleRate, preprocessGainDb } from "../src/audio/dsp.ts";
import type { Frame } from "../src/audio/dsp.ts";
import { prepareTrace } from "../src/judge/judge.ts";
import { renderTone } from "./helpers/synth.ts";
import { test } from "vitest";
import { check, info } from "./helpers/check.ts";

const cfg = makeConfig();
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);
const voiced = (f: Frame) => f.f0 !== null && f.clarity >= cfg.minClarity && f.rmsDb >= cfg.gateDb;
const FREQS = Array.from({ length: 41 }, (_, k) => 80 * Math.pow(10, k / 40)); // 80〜800Hz、41 点（対数）

/** 定常部（最初の 4 フレームと最後の 2 フレームを除く）の誤差 */
function toneError(f0: number, sr: number, opt: Parameters<typeof renderTone>[3]) {
  const x = renderTone(f0, 0.5, sr, opt);
  const fr = analyzeBuffer(x, sr, 0, cfg).slice(4, -2);
  let maxErr = 0, unv = 0, maxFold = 0;
  for (const f of fr) {
    if (!voiced(f)) { unv++; continue; }
    const e = Math.abs(cents(f.f0 as number, f0));
    maxErr = Math.max(maxErr, e);
    const fold = Math.abs(((cents(f.f0 as number, f0) + 600) % 1200 + 1200) % 1200 - 600);
    maxFold = Math.max(maxFold, fold);
  }
  return { maxErr, unv, n: fr.length, maxFold };
}

for (const sr of [48000, 44100]) {
  for (const [label, H] of [["正弦波", 1], ["倍音 12 本", 12]] as const) {
    test(`YIN 精度 ${label} 80〜800Hz 41 点 @${sr}`, () => {
      let worst = 0, worstF = 0, unv = 0, n = 0;
      FREQS.forEach((f, k) => {
        const r = toneError(f, sr, { harmonics: H, seed: k + 1 });
        if (r.maxErr > worst) { worst = r.maxErr; worstF = f; }
        unv += r.unv; n += r.n;
      });
      info(`YIN 最大誤差 ${label} @${sr}`, `${worst.toFixed(2)} セント（${worstF.toFixed(1)}Hz）、無声と判定 ${unv}/${n} フレーム`);
      check(unv === 0, `unvoiced frames ${unv}`);
      check(worst < 5, `max error ${worst.toFixed(2)} cents`);
    });
    test(`YIN 雑音 SN 比 20dB ${label} @${sr}`, () => {
      let worst = 0, unv = 0, n = 0;
      FREQS.forEach((f, k) => {
        const r = toneError(f, sr, { harmonics: H, seed: 100 + k, noiseSnrDb: 20 });
        worst = Math.max(worst, r.maxErr); unv += r.unv; n += r.n;
      });
      info(`YIN 最大誤差 SN20dB ${label} @${sr}`, `${worst.toFixed(2)} セント、無声と判定 ${unv}/${n} フレーム`);
      check(unv / n < 0.01, `unvoiced ${unv}/${n}`);
      check(worst < 10, `max error ${worst.toFixed(2)} cents`);
    });
  }
}

test("基音の弱い音（基音 0.1・2 倍音 1.0 …）でオクターブを畳めば 5 セント以内", () => {
  let worstFold = 0, octaveErr = 0, n = 0;
  for (const f0 of [98, 147, 196, 262, 392, 523, 784]) {
    // 基音を弱くした音: 倍音 12 本の音から基音成分を 1/10 にしたものを直接作る
    const sr = 48000, len = Math.floor(0.5 * sr), x = new Float32Array(len);
    for (let s = 0; s < len; s++) {
      let v = 0.1 * Math.sin(2 * Math.PI * f0 * s / sr);
      for (let k = 2; k <= 12; k++) if (k * f0 < 5000) v += Math.sin(2 * Math.PI * k * f0 * s / sr + k) / (k - 1);
      x[s] = 0.15 * v;
    }
    for (const f of analyzeBuffer(x, sr, 0, cfg).slice(4, -2)) {
      if (!voiced(f)) continue;
      n++;
      const c = cents(f.f0 as number, f0);
      if (Math.abs(c) > 600) octaveErr++;
      worstFold = Math.max(worstFold, Math.abs(((c + 600) % 1200 + 1200) % 1200 - 600));
    }
  }
  info("基音の弱い音", `オクターブ誤り ${octaveErr}/${n} フレーム、畳んだ誤差の最大 ${worstFold.toFixed(2)} セント`);
  check(n > 0 && worstFold < 5, `fold error ${worstFold}`);
});

test("無音（0）と、ごく小さい雑音（−90dBFS）は無声", () => {
  const sr = 48000;
  const z = new Float32Array(sr);
  const fz = analyzeBuffer(z, sr, 0, cfg);
  check(fz.every((f) => f.f0 === null), "digital silence gives f0 null");
  const d = renderTone(440, 1, sr, { level: 0, noiseSnrDb: null });
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(10, -90 / 20) * Math.sqrt(3);
  const fd = analyzeBuffer(d, sr, 0, cfg);
  check(fd.every((f) => !voiced(f)), "dither unvoiced");
});

for (const db of [-40, -30, -20]) {
  test(`白色雑音だけ（${db}dBFS、ゲートより大きい）は無声`, () => {
    const sr = 48000, n = sr * 3, x = new Float32Array(n);
    let seed = 12345 + db;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const a = Math.pow(10, db / 20);
    for (let i = 0; i < n; i += 2) {
      const u = Math.max(1e-12, rnd()), v = rnd(), r = Math.sqrt(-2 * Math.log(u));
      x[i] = a * r * Math.cos(2 * Math.PI * v);
      if (i + 1 < n) x[i + 1] = a * r * Math.sin(2 * Math.PI * v);
    }
    const fr = analyzeBuffer(x, sr, 0, cfg);
    const v = fr.filter(voiced).length;
    const f0Found = fr.filter((f) => f.f0 !== null).length;
    const maxClar = Math.max(...fr.map((f) => f.clarity));
    info(`雑音だけ ${db}dBFS`, `有声 ${v}/${fr.length}、f0 が出たフレーム ${f0Found}、clarity 最大 ${maxClar.toFixed(3)}`);
    check(v === 0, `voiced ${v}`);
  });
}

/* ---------- クリック ---------- */
function addClicks(x: Float32Array, sr: number, times: number[], level: number, accentEvery = 2) {
  times.forEach((t, k) => {
    const hz = k % accentEvery === 0 ? 2500 : 2000, a = Math.floor(t * sr), len = Math.floor(0.03 * sr), ramp = Math.floor(0.002 * sr);
    for (let i = 0; i < len && a + i < x.length; i++) x[a + i] += level * Math.min(1, i / ramp, (len - 1 - i) / ramp) * Math.sin(2 * Math.PI * hz * i / sr);
  });
}
function clickRun(f0: number | null, clickLevel: number, useMask: boolean, lpfSections: number) {
  const c = makeConfig({ lpfSections });
  const sr = 48000, sec = 4;
  const x = f0 === null ? new Float32Array(sr * sec) : renderTone(f0, sec, sr, { harmonics: 12, level: 0.5, seed: 3 });
  const times: number[] = [];
  for (let t = 0.25; t < sec - 0.1; t += 0.5) times.push(t);
  addClicks(x, sr, times, clickLevel);
  const fr = analyzeBuffer(x, sr, 0, c);
  const trace = prepareTrace(fr, { config: c, frameDurSec: c.frameSize * c.decimation / sr, clickTimes: useMask ? times : [] });
  const used = trace.slice(4, -2).filter((f) => !f.masked);
  const v = used.filter((f) => f.cents !== null);
  let maxErr = 0;
  if (f0 !== null) for (const f of v) maxErr = Math.max(maxErr, Math.abs((f.cents as number) - (6900 + 1200 * Math.log2(f0 / 440))));
  return { maxErr, voicedFrac: v.length / Math.max(1, used.length), voiced: v.length, used: used.length, masked: trace.filter((f) => f.masked).length, total: trace.length };
}

for (const f0 of [196, 330, 784]) {
  for (const lvl of [0.5, 1.0]) {
    test(`クリック（2kHz/2.5kHz 30ms、振幅 ${lvl}）+ 声 ${f0}Hz: LPF + マスクで誤差 5 セント以内`, () => {
      const r = clickRun(f0, lvl, true, 3);
      const noMask = clickRun(f0, lvl, false, 3);
      const weakLpf = clickRun(f0, lvl, false, 1);
      info(`クリック ${f0}Hz 振幅${lvl}`, `マスクあり 最大誤差 ${r.maxErr.toFixed(2)} セント（有声 ${r.voiced}/${r.used}、マスク ${r.masked}/${r.total}）／マスクなし 6 次 LPF ${noMask.maxErr.toFixed(1)} セント／マスクなし 2 次 LPF ${weakLpf.maxErr.toFixed(1)} セント`);
      check(r.maxErr < 5, `max err ${r.maxErr}`);
      check(r.voicedFrac > 0.99, `voiced frac ${r.voicedFrac}`);
    });
  }
}
test("クリックだけ（声なし、振幅 1.0）: マスクありなら有声 0", () => {
  const r = clickRun(null, 1.0, true, 3);
  const n6 = clickRun(null, 1.0, false, 3);
  const n2 = clickRun(null, 1.0, false, 1);
  info("クリックだけ", `マスクあり 有声 ${r.voiced}/${r.used}／マスクなし 6 次 LPF 有声 ${n6.voiced}/${n6.used}／マスクなし 2 次 LPF 有声 ${n2.voiced}/${n2.used}`);
  check(r.voiced === 0, `voiced ${r.voiced}`);
});

test("前処理の振幅特性（48kHz）", () => {
  const pts = [50, 60, 80, 100, 400, 800, 1000, 1500, 2000, 2500, 4000];
  const g = pts.map((hz) => `${hz}Hz ${preprocessGainDb(48000, cfg, hz).toFixed(1)}dB`);
  info("前処理の利得", g.join(", "));
  check(preprocessGainDb(48000, cfg, 2000) < -12, "2kHz attenuated by >12dB");
  check(Math.abs(preprocessGainDb(48000, cfg, 400)) < 0.5, "400Hz passband");
});

/* ---------- ストリームと時刻 ---------- */
test("チャンクの大きさに依らず同じフレーム・時刻 = 開始時刻 + フレーム中心", () => {
  const sr = 48000, x = renderTone(261.6, 1.2, sr, { harmonics: 8, seed: 9 });
  const a = analyzeBuffer(x, sr, 10, cfg, 128), b = analyzeBuffer(x, sr, 10, cfg, 997), c = analyzeBuffer(x, sr, 10, cfg, x.length);
  check(a.length === b.length && a.length === c.length, "same frame count");
  for (let i = 0; i < a.length; i++) {
    check(a[i].t === b[i].t && a[i].f0 === b[i].f0 && b[i].f0 === c[i].f0, "identical frame " + i);
    const expect = 10 + (i * cfg.hopSize + cfg.frameSize / 2) * cfg.decimation / sr;
    check(Math.abs(a[i].t - expect) < 1e-9, "time of frame " + i);
  }
  info("1.2 秒のフレーム数", String(a.length));
});

test("44.1kHz でも時刻とフレーム長が合う", () => {
  const an = new PitchAnalyzer(44100, cfg);
  check(Math.abs(an.rate - 22050) < 1e-9, "rate");
  check(Math.abs(an.frameDurSec - 1024 * 2 / 44100) < 1e-12, "frameDur");
});

test("実効サンプルレートの自己点検", () => {
  check(checkSampleRate(48000 * 3, 3.0, 48000, cfg.sampleRateTolerance).ok, "exact");
  check(checkSampleRate(48000 * 3 * 1.04, 3.0, 48000, cfg.sampleRateTolerance).ok, "4% ok");
  check(!checkSampleRate(44100 * 3, 3.0, 48000, cfg.sampleRateTolerance).ok, "44.1 vs 48 flagged");
});

/* ---------- 速さ ---------- */
test("YIN 1 フレームの処理時間（Node）", () => {
  const sr = 24000, x = new Float32Array(cfg.frameSize);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(2 * Math.PI * 220 * i / sr) + 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
  const s = makeYinScratch(Math.ceil(sr / cfg.minHz));
  for (let i = 0; i < 300; i++) yin(x, sr, cfg, s);
  const N = 3000, t0 = performance.now();
  for (let i = 0; i < N; i++) yin(x, sr, cfg, s);
  const per = (performance.now() - t0) / N;
  // 前処理込み: 10 秒ぶんを 128 サンプルずつ
  const y = renderTone(220, 10, 48000, { harmonics: 12, seed: 1 });
  const t1 = performance.now();
  const fr = analyzeBuffer(y, 48000, 0, cfg);
  const all = performance.now() - t1;
  const hopMs = cfg.hopSize * cfg.decimation / 48000 * 1000;
  info("YIN 1 フレーム", `${per.toFixed(3)} ms（ホップ ${hopMs.toFixed(1)} ms に対して ${(100 * per / hopMs).toFixed(1)}%）`);
  info("前処理込み 10 秒の解析", `${all.toFixed(0)} ms（${fr.length} フレーム、1 フレームあたり ${(all / fr.length).toFixed(3)} ms、実時間の ${(all / 100).toFixed(1)}%）`);
  check(per < hopMs, "faster than real time");
});

