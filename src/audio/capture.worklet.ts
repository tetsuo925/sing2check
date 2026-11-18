// マイク入力を受ける AudioWorkletProcessor。dsp.ts の PitchAnalyzer を薄く包む（ハンドオフ文書 §8.1）。
// 入力はチャンネル 0 だけ使う。出力は書かない（0 のまま）。
import { makeConfig } from "./config.ts";
import type { Sing2CheckConfig } from "./config.ts";
import { Biquad, PitchAnalyzer, butterworthQs } from "./dsp.ts";
import type { Frame } from "./dsp.ts";
import { PLAYBACK_LPF_SECTIONS, PROCESSOR_NAME, TUNER_TAKE_ID, packFrames, playbackLpfHz } from "./messages.ts";
import type { FromWorklet, ToWorklet } from "./messages.ts";

// AudioWorkletGlobalScope の変数（lib.dom には無い）
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, ctor: new (options?: { processorOptions?: { config?: Partial<Sing2CheckConfig> } }) => AudioWorkletProcessor): void;

const FRAMES_PER_MESSAGE = 5; // 約 50ms
const PCM_MESSAGE_SEC = 0.1;
const LEVEL_SEC = 0.05;
const STATS_SEC = 0.5;

const toDb = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

class CaptureProcessor extends AudioWorkletProcessor {
  private cfg: Sing2CheckConfig;
  private analyzer: PitchAnalyzer | null = null;
  /** start〜stop の間（フレームと再生用 PCM を送る） */
  private recording = false;
  /** チューナー（フレームだけ送る） */
  private tuning = false;
  private takeId = TUNER_TAKE_ID;
  private pending: Frame[] = [];

  private pcmFilters: Biquad[] = [];
  private pcmPhase = 0;
  private pcmBuf: Float32Array | null = null;
  private pcmFill = 0;
  private pcmStartTime = 0;
  private pcmChunk = 0;

  private levelSumSq = 0;
  private levelPeak = 0;
  private levelCount = 0;
  private readonly levelEvery = Math.round(sampleRate * LEVEL_SEC);

  private received = 0;
  private statsCount = 0;
  private readonly statsEvery = Math.round(sampleRate * STATS_SEC);

  /** 連続して受けた入力サンプルの数。時間軸はこれで数える（下の process のコメント） */
  private position = 0;
  /** position 0 に当たる AudioContext のフレーム。null = まだ入力を受けていない */
  private origin: number | null = null;

  constructor(options?: { processorOptions?: { config?: Partial<Sing2CheckConfig> } }) {
    super();
    this.cfg = makeConfig(options?.processorOptions?.config ?? {});
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => this.onMessage(e.data);
  }

  private send(msg: FromWorklet, transfer?: Transferable[]): void {
    if (transfer) this.port.postMessage(msg, transfer);
    else this.port.postMessage(msg);
  }

  private onMessage(msg: ToWorklet): void {
    if (msg.type === "start") {
      this.flushFrames();
      this.takeId = msg.takeId;
      this.recording = true;
      this.resetStreams();
    } else if (msg.type === "stop") {
      if (this.recording && msg.takeId === this.takeId) {
        this.flushFrames();
        this.flushPcm();
        this.recording = false;
        this.takeId = TUNER_TAKE_ID;
        if (!this.tuning) this.analyzer = null;
      }
      this.send({ type: "stopped", takeId: msg.takeId });
    } else if (msg.type === "analyze") {
      this.tuning = msg.on;
      if (!this.recording) {
        this.pending = [];
        this.analyzer = null; // 次のブロックで作り直す
      }
    } else if (msg.type === "setConfig") {
      this.cfg = makeConfig({ ...this.cfg, ...msg.config });
      if (!this.recording) this.analyzer = null;
    }
  }

  /** 解析器と再生用 PCM の系統を作り直す（時刻の連続性が切れたとき・テイクの始め） */
  private resetStreams(): void {
    this.analyzer = null;
    this.pending = [];
    const dec = this.cfg.decimation;
    this.pcmFilters = butterworthQs(PLAYBACK_LPF_SECTIONS).map((q) => Biquad.make("lowpass", sampleRate, playbackLpfHz(sampleRate, dec), q));
    this.pcmChunk = Math.ceil(sampleRate / dec * PCM_MESSAGE_SEC);
    this.pcmPhase = 0;
    this.pcmBuf = null;
    this.pcmFill = 0;
  }

  private flushFrames(): void {
    if (!this.pending.length) return;
    const data = packFrames(this.pending);
    this.pending = [];
    this.send({ type: "frames", takeId: this.takeId, data }, [data.buffer]);
  }

  private flushPcm(): void {
    if (!this.pcmBuf || this.pcmFill === 0) return;
    const data = this.pcmBuf.slice(0, this.pcmFill);
    this.pcmFill = 0;
    this.send({ type: "pcm", takeId: this.takeId, startTime: this.pcmStartTime, rate: sampleRate / this.cfg.decimation, data }, [data.buffer]);
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    // 入力なし（マイクが繋がっていない）。position を進めないので、次に入力が来たとき連続が切れたと分かる
    if (!ch || ch.length === 0) return true;
    const n = ch.length;
    const active = this.recording || this.tuning;

    // 時刻の連続性。このブロックの先頭は AudioContext のフレーム origin + position に当たるはず。
    // currentFrame がそれと違えば、間のブロックを取りこぼしている（または入力が途切れていた）。
    // ただし Chrome では currentFrame がまれに 1 ブロック古い値のまま読める（受けるサンプルは連続している）ので、
    // ちょうど 1 ブロック小さい場合は連続として扱い、時刻は自前の position から出す。
    if (this.origin === null) {
      this.origin = currentFrame - this.position;
    } else {
      const expected = this.origin + this.position;
      if (currentFrame !== expected && currentFrame !== expected - n) {
        if (active) {
          this.flushFrames();
          this.flushPcm();
          this.send({ type: "gap", expectedFrame: expected, currentFrame });
          this.resetStreams();
        }
        this.origin = currentFrame - this.position;
      }
    }
    /** このブロックの先頭の AudioContext フレーム */
    const blockFrame = this.origin + this.position;
    this.position += n;

    // 入力レベル（常に数える）
    let sumSq = 0, peak = this.levelPeak;
    for (let i = 0; i < n; i++) {
      const v = ch[i];
      sumSq += v * v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    this.levelSumSq += sumSq;
    this.levelPeak = peak;
    this.levelCount += n;
    if (this.levelCount >= this.levelEvery) {
      this.send({ type: "level", rmsDb: toDb(Math.sqrt(this.levelSumSq / this.levelCount)), peakDb: toDb(this.levelPeak) });
      this.levelSumSq = 0; this.levelPeak = 0; this.levelCount = 0;
    }

    // 自己点検用の累計
    this.received += n;
    this.statsCount += n;
    if (this.statsCount >= this.statsEvery) {
      this.statsCount = 0;
      this.send({ type: "stats", receivedSamples: this.received, currentFrame: blockFrame + n, sampleRate });
    }

    if (!active) return true;

    // ピッチ解析
    if (!this.analyzer) this.analyzer = new PitchAnalyzer(sampleRate, this.cfg);
    const frames = this.analyzer.push(ch, blockFrame / sampleRate);
    for (const f of frames) this.pending.push(f);
    if (this.pending.length >= FRAMES_PER_MESSAGE) this.flushFrames();

    // 再生用 PCM（録音中だけ）
    if (this.recording) {
      const fl = this.pcmFilters, nf = fl.length;
      for (let i = 0; i < n; i++) {
        let x = ch[i];
        for (let k = 0; k < nf; k++) x = fl[k].step(x);
        if (this.pcmPhase === 0) {
          if (!this.pcmBuf) this.pcmBuf = new Float32Array(this.pcmChunk + n);
          if (this.pcmFill === 0) this.pcmStartTime = (blockFrame + i) / sampleRate;
          this.pcmBuf[this.pcmFill++] = x;
        }
        this.pcmPhase = (this.pcmPhase + 1) % this.cfg.decimation;
      }
      if (this.pcmFill >= this.pcmChunk) this.flushPcm();
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, CaptureProcessor);
