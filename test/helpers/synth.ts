// テスト用の合成「歌い手」。solfege-core の旋律から、マイクに入る音を合成する。
// 倍音の多い音（1/k の振幅で 5kHz まで）、ビブラート、歌い出しのしゃくり、タイミングの揺れ、雑音、クリック。
import Core from "../../src/core/solfege-core.js";
import type { Melody } from "../../src/core/solfege-core.js";
import { targetNotes } from "../../src/judge/judge.ts";

export interface SingerOptions {
  sampleRate: number;
  /** 1 拍あたりの BPM */
  bpm: number;
  seed?: number;
  /** false なら声を出さない（無音 / 雑音 / クリックだけ） */
  voice?: boolean;
  /** 全音に足すセント */
  centsOffset?: number;
  /** 全音をずらす半音数（−12 = 1 オクターブ下） */
  transpose?: number;
  /** この番号の音を semitones だけずらして歌う */
  substitute?: { index: number; semitones: number } | null;
  /** 歌わない音の番号 */
  unsung?: number[];
  /** 歌い手の全体の遅れ ms（正 = 遅れ）。聞こえたクリックに対する遅れ */
  lagMs?: number;
  /**
   * スピーカー → マイクの往復遅延（秒）。クリックも声も、録音の上ではこれだけ遅れて現れる
   * （歌い手はスピーカーから聞こえたクリックに合わせて歌い、その声が入力遅延を経て録音されるため）。
   */
  roundTripSec?: number;
  /** 音ごとの歌い出しの揺れ: 大きさ [min, max] ms、符号はランダム */
  jitterMs?: [number, number];
  vibratoCents?: number;
  vibratoHz?: number;
  /** ビブラートがかかり始めるまでの時間 ms（0 = 最初から全幅） */
  vibratoDelayMs?: number;
  /** 歌い出しのしゃくり（セント、負 = 下から）と長さ ms */
  scoopCents?: number;
  scoopMs?: number;
  /** 声のピーク振幅（0〜1） */
  level?: number;
  /** 雑音: 声の RMS に対する SN 比 dB（null = 雑音なし） */
  noiseSnrDb?: number | null;
  /** 雑音の絶対レベル dBFS（RMS）。voice=false のときの雑音に使う */
  noiseDbfs?: number | null;
  /** クリック: 拍の時刻（秒、課題時間）とピーク振幅 */
  clicks?: { times: { t: number; accent: boolean }[]; level: number; durMs?: number } | null;
  /** 課題開始より前に置く無音（秒）と、後ろの余白（秒） */
  prerollSec?: number;
  tailSec?: number;
}

export interface Rendered {
  samples: Float32Array;
  sampleRate: number;
  /** samples[0] の時刻（秒、課題開始 = 0） */
  startTime: number;
  /** 実際に歌った各音の開始・終了（秒） */
  sung: { index: number; start: number; end: number; midi: number }[];
}

function gauss(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 倍音 1..K を 1/k の振幅で重ねた 1 周期のテーブル（位相はランダム） */
function harmonicTable(K: number, rng: () => number, size = 4096): Float32Array {
  const tab = new Float32Array(size + 1);
  const ph = Array.from({ length: K }, () => rng() * 2 * Math.PI);
  let peak = 0;
  for (let i = 0; i < size; i++) {
    let s = 0;
    for (let k = 1; k <= K; k++) s += Math.sin(2 * Math.PI * k * i / size + ph[k - 1]) / k;
    tab[i] = s; peak = Math.max(peak, Math.abs(s));
  }
  for (let i = 0; i < size; i++) tab[i] /= peak;
  tab[size] = tab[0];
  return tab;
}

export function renderTake(melody: Melody, o: SingerOptions): Rendered {
  const sr = o.sampleRate;
  const rng = Core.makeRng(o.seed ?? 1);
  const voice = o.voice !== false;
  const notes = targetNotes(melody, o.bpm);
  const pre = o.prerollSec ?? 0.5, tail = o.tailSec ?? 1.0;
  const endSec = notes.length ? notes[notes.length - 1].offSec : 0;
  const n = Math.ceil((pre + endSec + tail) * sr);
  const out = new Float32Array(n);
  const t0 = -pre;
  const level = o.level ?? 0.5;
  const rt = o.roundTripSec ?? 0;
  const lag = (o.lagMs ?? 0) / 1000 + rt;
  const [jmin, jmax] = o.jitterMs ?? [10, 30];
  const jit = () => (jmin + (jmax - jmin) * rng()) / 1000 * (rng() < 0.5 ? -1 : 1);
  const vibC = o.vibratoCents ?? 20, vibHz = o.vibratoHz ?? 5.5, vibDelay = (o.vibratoDelayMs ?? 0) / 1000;
  const scoopC = o.scoopCents ?? -80, scoopS = (o.scoopMs ?? 60) / 1000;
  const unsung = new Set(o.unsung ?? []);

  // 歌い出しの時刻（揺れつき）
  const starts = notes.map((nt) => nt.onSec + lag + jit());
  const sung: Rendered["sung"] = [];
  let voiceSumSq = 0, voiceCount = 0;
  if (voice) {
    notes.forEach((nt, i) => {
      if (unsung.has(i)) return;
      const next = notes[i + 1];
      const start = starts[i];
      const end = next && Math.abs(next.onSec - nt.offSec) < 1e-9 ? starts[i + 1] : nt.offSec + lag + jit();
      let midi = nt.midi + (o.transpose ?? 0);
      if (o.substitute && o.substitute.index === i) midi += o.substitute.semitones;
      const f = 440 * Math.pow(2, (midi - 69 + (o.centsOffset ?? 0) / 100) / 12);
      const K = Math.max(1, Math.min(20, Math.floor(5000 / f)));
      const tab = harmonicTable(K, rng);
      const size = tab.length - 1;
      const vibPh = rng() * 2 * Math.PI;
      const att = 0.020, rel = 0.030;
      const a = Math.max(0, Math.floor((start - t0) * sr)), b = Math.min(n, Math.floor((end - t0) * sr));
      let phase = rng();
      for (let s = a; s < b; s++) {
        const tt = s / sr + t0 - start; // 音の中の経過時間
        const left = end - (s / sr + t0);
        let cents = 0;
        if (tt < scoopS) cents += scoopC * (1 - tt / scoopS);
        const vibAmt = vibDelay > 0 ? Math.min(1, tt / vibDelay) : 1;
        cents += vibC * vibAmt * Math.sin(2 * Math.PI * vibHz * (s / sr) + vibPh);
        phase += f * Math.pow(2, cents / 1200) / sr;
        phase -= Math.floor(phase);
        const x = phase * size, xi = Math.floor(x), fr = x - xi;
        let env = 1;
        if (tt < att) env = 0.5 - 0.5 * Math.cos(Math.PI * tt / att);
        if (left < rel) env *= Math.max(0, 0.5 - 0.5 * Math.cos(Math.PI * left / rel));
        const v = level * env * (tab[xi] + (tab[xi + 1] - tab[xi]) * fr);
        out[s] += v;
        voiceSumSq += v * v; voiceCount++;
      }
      sung.push({ index: i, start, end, midi });
    });
  }

  // 雑音
  let noiseRms = 0;
  if (o.noiseSnrDb != null && voiceCount > 0) noiseRms = Math.sqrt(voiceSumSq / voiceCount) / Math.pow(10, o.noiseSnrDb / 20);
  else if (o.noiseDbfs != null) noiseRms = Math.pow(10, o.noiseDbfs / 20);
  if (noiseRms > 0) for (let s = 0; s < n; s++) out[s] += noiseRms * gauss(rng);

  // クリック（2000Hz、強拍 2500Hz、30ms、両端 2ms のランプ）
  if (o.clicks) {
    const lat = rt, dur = (o.clicks.durMs ?? 30) / 1000;
    for (const c of o.clicks.times) {
      const fHz = c.accent ? 2500 : 2000;
      const a = Math.floor((c.t + lat - t0) * sr), len = Math.floor(dur * sr), ramp = Math.floor(0.002 * sr);
      for (let k = 0; k < len; k++) {
        const s = a + k;
        if (s < 0 || s >= n) continue;
        const env = Math.min(1, k / ramp, (len - 1 - k) / ramp);
        out[s] += o.clicks.level * env * Math.sin(2 * Math.PI * fHz * k / sr);
      }
    }
  }
  return { samples: out, sampleRate: sr, startTime: t0, sung };
}

/** 一定の高さの音（YIN の精度試験用）。harmonics = 1 なら正弦波 */
export function renderTone(f0: number, sec: number, sr: number, opts: { harmonics?: number; level?: number; noiseSnrDb?: number | null; seed?: number } = {}): Float32Array {
  const rng = Core.makeRng(opts.seed ?? 7);
  const n = Math.floor(sec * sr), out = new Float32Array(n);
  const K = opts.harmonics ?? 1, level = opts.level ?? 0.5;
  const ph = Array.from({ length: K }, () => rng() * 2 * Math.PI);
  let norm = 0;
  for (let k = 1; k <= K; k++) norm += 1 / k;
  let sumSq = 0;
  for (let s = 0; s < n; s++) {
    let v = 0;
    for (let k = 1; k <= K; k++) if (k * f0 < sr * 0.45) v += Math.sin(2 * Math.PI * k * f0 * s / sr + ph[k - 1]) / k;
    out[s] = level * v / (K === 1 ? 1 : norm * 0.6);
    sumSq += out[s] * out[s];
  }
  if (opts.noiseSnrDb != null) {
    const nr = Math.sqrt(sumSq / n) / Math.pow(10, opts.noiseSnrDb / 20);
    for (let s = 0; s < n; s++) out[s] += nr * gauss(rng);
  }
  return out;
}

/** WAV（16bit モノラル）に書き出すためのバイト列。E2E の偽マイク入力用 */
export function toWav16(samples: Float32Array, sr: number): Uint8Array {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, "data"); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), true);
  return new Uint8Array(buf);
}
