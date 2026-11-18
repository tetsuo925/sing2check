// ワークレット（capture.worklet.ts）とメインスレッドの間のメッセージ（ハンドオフ文書 §8）
import type { Sing2CheckConfig } from "./config.ts";
import type { Frame } from "./dsp.ts";

export const PROCESSOR_NAME = "sing2check-capture";

/** 再生用 PCM（自分の歌を聴く・ループバック試験）: ローパス 10kHz（2 次 × 2 段）→ 解析と同じ率で間引く */
export const PLAYBACK_LPF_HZ = 10000;
export const PLAYBACK_LPF_SECTIONS = 2;

/** 解析のサンプルレートの目安。フレーム 1024 サンプルが約 43ms、ホップ 256 が約 10.7ms になる */
const ANALYSIS_RATE_HZ = 24000;

/**
 * 間引き率。設計は 48k → 24k、44.1k → 22.05k（1/2）。機器のサンプルレートがそれ以外でも解析のレートが
 * 24kHz 前後になるように決める（96k・88.2k → 1/4、32k 以下 → 間引かない）。
 * 96kHz を 1/2 のままにすると、フレームの長さが半分（21ms）になり、低い声を取れなくなる。
 */
export function decimationFor(sampleRate: number): number {
  return Math.max(1, Math.round(sampleRate / ANALYSIS_RATE_HZ));
}

/** 再生用 PCM のローパスの遮断周波数。間引き後のナイキスト周波数より下に置く */
export function playbackLpfHz(sampleRate: number, decimation: number): number {
  return Math.min(PLAYBACK_LPF_HZ, 0.42 * sampleRate / decimation);
}

/** マイクの確認シートのチューナー用のフレームに付ける takeId（録音中でないフレーム） */
export const TUNER_TAKE_ID = 0;

export type ToWorklet =
  /** 解析と録音を始める（解析器を作り直す） */
  | { type: "start"; takeId: number }
  /** 止める。未送信のフレームと PCM を送り切ってから "stopped" を返す */
  | { type: "stop"; takeId: number }
  | { type: "setConfig"; config: Partial<Sing2CheckConfig> }
  /** マイクの確認シートのチューナー用（録音はせずフレームだけ送る） */
  | { type: "analyze"; on: boolean };

export type FromWorklet =
  /** [t, f0, clarity, rmsDb] × n。f0 が null のときは NaN。約 50ms ごとにまとめて送る。時刻は AudioContext の秒 */
  | { type: "frames"; takeId: number; data: Float64Array }
  /** 再生用 PCM（約 100ms ごと）。startTime = data[0] の AudioContext 時刻 */
  | { type: "pcm"; takeId: number; startTime: number; rate: number; data: Float32Array }
  /** 約 50ms ごと。入力チャンネル 0 の RMS とピーク（dBFS） */
  | { type: "level"; rmsDb: number; peakDb: number }
  /** 約 500ms ごと。開始からの累計 */
  | { type: "stats"; receivedSamples: number; currentFrame: number; sampleRate: number }
  /** サンプルの連続が途切れた */
  | { type: "gap"; expectedFrame: number; currentFrame: number }
  | { type: "stopped"; takeId: number };

const FIELDS = 4;

export function packFrames(frames: Frame[]): Float64Array {
  const out = new Float64Array(frames.length * FIELDS);
  frames.forEach((f, i) => {
    out[i * FIELDS] = f.t;
    out[i * FIELDS + 1] = f.f0 === null ? NaN : f.f0;
    out[i * FIELDS + 2] = f.clarity;
    out[i * FIELDS + 3] = f.rmsDb;
  });
  return out;
}

export function unpackFrames(data: Float64Array): Frame[] {
  const out: Frame[] = [];
  for (let i = 0; i + FIELDS <= data.length; i += FIELDS) {
    const f0 = data[i + 1];
    out.push({ t: data[i], f0: Number.isNaN(f0) ? null : f0, clarity: data[i + 2], rmsDb: data[i + 3] });
  }
  return out;
}

/** 再生用 PCM のかたまりを、[startTime, endTime] の 1 本にまとめる。届かなかった所は 0 */
export function assemblePcm(chunks: { startTime: number; data: Float32Array }[], rate: number, startTime: number, endTime: number): Float32Array {
  const out = new Float32Array(Math.max(0, Math.ceil((endTime - startTime) * rate)));
  for (const c of chunks) {
    const at = Math.round((c.startTime - startTime) * rate);
    const from = Math.max(0, -at), to = Math.min(c.data.length, out.length - at);
    if (to > from) out.set(c.data.subarray(from, to), at + from);
  }
  return out;
}
