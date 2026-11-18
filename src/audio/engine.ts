// AudioContext は 1 つだけ。再生（主和音・最初の音・クリック・正解・自分の歌）とマイクを同じ AudioContext に置き、
// 時計を 1 つにする（ハンドオフ文書 §6）。マイクはスピーカーに繋がない。
import captureWorkletUrl from "./capture.worklet.ts?worker&url";
import { makeConfig } from "./config.ts";
import type { Sing2CheckConfig } from "./config.ts";
import { checkSampleRate } from "./dsp.ts";
import { PROCESSOR_NAME, decimationFor } from "./messages.ts";
import type { FromWorklet, ToWorklet } from "./messages.ts";
import { setAudioSession } from "./session.ts";

export type MicState = "closed" | "opening" | "open";

/** getUserMedia のあとの track.getSettings()（マイクの確認シートに出す） */
export interface MicInfo {
  label: string;
  echoCancellation: boolean | null;
  sampleRate: number | null;
  channelCount: number | null;
}

/** 実効サンプルレートの自己点検（§9.6） */
export interface RateCheck {
  measuredRate: number;
  nominalRate: number;
  /** 受けたサンプル数と currentFrame の進みが合わない（ブロックの取りこぼし） */
  dropped: boolean;
  ok: boolean;
}

/** マイクを開くとき、AudioContext の resume() を待つ上限 */
const RESUME_TIMEOUT_MS = 1500;

/** まとめて止められる再生の単位（テイク 1 回、「正解を聴く」1 回など） */
export class PlayGroup {
  private voices: { sources: AudioScheduledSourceNode[]; gain: GainNode }[] = [];
  private stopped = false;
  private readonly ctx: AudioContext;
  constructor(ctx: AudioContext) { this.ctx = ctx; }

  add(sources: AudioScheduledSourceNode[], gain: GainNode): void {
    if (this.stopped) {
      for (const s of sources) { try { s.stop(); } catch { /* 無視 */ } }
      try { gain.disconnect(); } catch { /* 無視 */ }
      return;
    }
    const voice = { sources, gain };
    this.voices.push(voice);
    sources[0].onended = () => {
      gain.disconnect();
      this.voices = this.voices.filter((v) => v !== voice);
    };
  }

  /** 鳴っている音・予約した音をすべて止める（20ms でしぼる） */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      try {
        // いまの値を保ったまま予約を消す（cancelScheduledValues だけだと、途中のランプが消えて値が跳ぶ）
        const g = v.gain.gain as AudioParam & { cancelAndHoldAtTime?(t: number): AudioParam };
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
        else g.cancelScheduledValues(now);
        g.setTargetAtTime(0, now, 0.006);
      } catch { /* 無視 */ }
      for (const s of v.sources) { try { s.stop(now + 0.04); } catch { /* 無視 */ } }
    }
  }
}

const MASTER_GAIN = 0.5;
const TONE_PEAK = 0.34;
const CLICK_PEAK = 0.5;
const TEST_TONE_PEAK = 0.6;
const RATE_WINDOW_MIN_SEC = 2;
const RATE_WINDOW_MAX_SEC = 10;

const midiToHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

type Listener = (msg: FromWorklet) => void;

export class AudioEngine {
  ctx: AudioContext | null = null;
  micState: MicState = "closed";
  micInfo: MicInfo | null = null;
  rateCheck: RateCheck | null = null;
  /** このページでマイクを開けたことがある */
  micEverOpened = false;

  private melodyBus!: GainNode;
  private clickBus!: GainNode;
  private playbackBus!: GainNode;
  private node: AudioWorkletNode | null = null;
  private workletLoaded: Promise<void> | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private opening: Promise<void> | null = null;
  /** openMic / closeMic のたびに進める。開いている途中に閉じられたことを知るため */
  private micGen = 0;
  private openingGen = 0;
  private listeners = new Set<Listener>();
  private changeListeners = new Set<() => void>();
  private ratePoints: { samples: number; frame: number; at: number }[] = [];
  private takeCounter = 0;
  /** 解析の設定。間引き率は AudioContext のサンプルレートで決まる（ensureContext で入れる） */
  config: Sing2CheckConfig = makeConfig();

  /* ---------- AudioContext ---------- */
  /** ユーザー操作（タップ）のハンドラの中で、await より前に呼ぶ */
  ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor({ latencyHint: "interactive" });
      const master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
      this.melodyBus = ctx.createGain();
      this.clickBus = ctx.createGain();
      this.playbackBus = ctx.createGain();
      for (const bus of [this.melodyBus, this.clickBus, this.playbackBus]) bus.connect(master);
      this.config = makeConfig({ decimation: decimationFor(ctx.sampleRate) });
      this.ctx = ctx;
    }
    if (this.ctx.state !== "running") void this.ctx.resume().catch(() => { /* 次のタップでもう一度 */ });
    return this.ctx;
  }

  get currentTime(): number { return this.ctx?.currentTime ?? 0; }
  /** 画面の表示に使う時刻: いまスピーカーから出ている音の時刻（出力の遅れの分だけ手前） */
  visualTime(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const latency = (ctx as AudioContext & { outputLatency?: number }).outputLatency || ctx.baseLatency || 0;
    return ctx.currentTime - Math.min(0.5, latency);
  }
  get sampleRate(): number { return this.ctx?.sampleRate ?? 48000; }
  /** 解析フレーム 1 つの長さ（秒）。judgeTake の frameDurSec */
  get frameDurSec(): number { return this.config.frameSize * this.config.decimation / this.sampleRate; }

  newGroup(): PlayGroup { return new PlayGroup(this.ensureContext()); }
  nextTakeId(): number { return ++this.takeCounter; }

  /* ---------- 購読 ---------- */
  /** ワークレットからのメッセージ */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  /** マイクの状態・自己点検の結果が変わったとき */
  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => { this.changeListeners.delete(fn); };
  }
  private changed(): void { for (const fn of [...this.changeListeners]) fn(); }

  /* ---------- マイク ---------- */
  /**
   * マイクを開く。ユーザー操作のハンドラの中で、await より前に呼ぶ（getUserMedia を同期的に呼ぶため）。
   * 失敗したら DOMException（name = NotAllowedError など）で reject する。
   */
  openMic(): Promise<void> {
    const ctx = this.ensureContext();
    if (this.micState === "open" && this.stream?.getAudioTracks().some((t) => t.readyState === "live")) return Promise.resolve();
    if (this.opening && this.openingGen === this.micGen) return this.opening;
    if (!navigator.mediaDevices?.getUserMedia) {
      return Promise.reject(new DOMException("mediaDevices is not available", "SecurityError"));
    }
    this.releaseMic();
    const gen = ++this.micGen;
    this.openingGen = gen;
    /** 待っている間に閉じられた・別の openMic に置き換わったら、開いたストリームを捨てて抜ける */
    const superseded = (stream: MediaStream | null) => {
      if (gen === this.micGen) return;
      if (stream) for (const t of stream.getTracks()) t.stop();
      throw new DOMException("cancelled", "AbortError");
    };
    this.micState = "opening";
    this.changed();
    // §16.1: 起動時 playback → マイクを開く直前 auto → getUserMedia → play-and-record → 止めたら playback
    setAudioSession("auto");
    const request = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    let opening: Promise<void> | null = null;
    opening = (async () => {
      try {
        const stream = await request;
        superseded(stream);
        setAudioSession("play-and-record");
        this.stream = stream;
        await this.loadWorklet(ctx);
        superseded(null); // closeMic が先にストリームを止めている
        // resume() は、割り込み中（interrupted）だと解決しないことがある。待ちすぎない
        if (ctx.state !== "running") {
          await Promise.race([ctx.resume().catch(() => { /* 無視 */ }), new Promise((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS))]);
          superseded(null);
          if ((ctx.state as string) !== "running") throw new DOMException("audio context is not running", "NotReadableError");
        }
        const node = this.ensureNode(ctx);
        this.source = ctx.createMediaStreamSource(stream);
        this.source.connect(node);
        const track = stream.getAudioTracks()[0];
        const s = track?.getSettings?.() ?? {};
        this.micInfo = {
          label: track?.label ?? "",
          echoCancellation: typeof s.echoCancellation === "boolean" ? s.echoCancellation : null,
          sampleRate: typeof s.sampleRate === "number" ? s.sampleRate : null,
          channelCount: typeof s.channelCount === "number" ? s.channelCount : null,
        };
        if (track) track.onended = () => { if (this.stream === stream) this.closeMic(); };
        this.ratePoints = [];
        this.rateCheck = null;
        this.micState = "open";
        this.micEverOpened = true;
      } catch (e) {
        if (gen === this.micGen) {
          this.releaseMic();
          this.micState = "closed";
          setAudioSession("playback");
        }
        throw e;
      } finally {
        if (opening && this.opening === opening) this.opening = null;
        this.changed();
      }
    })();
    this.opening = opening;
    return opening;
  }

  /** マイクを閉じる（バックグラウンドに回ったときなど）。次のタップで取り直す */
  closeMic(): void {
    if (this.micState === "closed" && !this.stream) return;
    this.micGen++; // 開いている途中の openMic を無効にする
    this.releaseMic();
    this.micState = "closed";
    setAudioSession("playback");
    this.changed();
  }

  private releaseMic(): void {
    try { this.source?.disconnect(); } catch { /* 無視 */ }
    this.source = null;
    if (this.stream) for (const t of this.stream.getTracks()) { t.onended = null; t.stop(); }
    this.stream = null;
  }

  private loadWorklet(ctx: AudioContext): Promise<void> {
    this.workletLoaded ??= ctx.audioWorklet.addModule(captureWorkletUrl).catch((e) => {
      this.workletLoaded = null;
      throw e;
    });
    return this.workletLoaded;
  }

  private ensureNode(ctx: AudioContext): AudioWorkletNode {
    if (this.node) return this.node;
    const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: { config: this.config },
    });
    node.port.onmessage = (e: MessageEvent<FromWorklet>) => this.onWorkletMessage(e.data);
    // 出力は常に 0。gain 0 を経て destination に繋ぐ（出力先が無いと処理が止まるのを避ける）
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);
    this.node = node;
    return node;
  }

  post(msg: ToWorklet): void {
    this.node?.port.postMessage(msg);
  }

  private onWorkletMessage(msg: FromWorklet): void {
    if (msg.type === "stats") this.onStats(msg.receivedSamples, msg.currentFrame, msg.sampleRate);
    for (const fn of [...this.listeners]) fn(msg);
  }

  /** §9.6: 受けたサンプル数 / 経過時間（performance.now()）を sampleRate と比べる。2 秒以上の区間で判定 */
  private onStats(samples: number, frame: number, sampleRate: number): void {
    if (this.micState !== "open") return;
    const at = performance.now();
    const pts = this.ratePoints;
    pts.push({ samples, frame, at });
    while (pts.length > 2 && at - pts[1].at >= RATE_WINDOW_MAX_SEC * 1000) pts.shift();
    const base = pts[0];
    const elapsed = (at - base.at) / 1000;
    if (elapsed < RATE_WINDOW_MIN_SEC) return;
    const got = samples - base.samples;
    const r = checkSampleRate(got, elapsed, sampleRate, this.config.sampleRateTolerance);
    const dropped = frame - base.frame !== got;
    const prev = this.rateCheck;
    this.rateCheck = { measuredRate: r.measuredRate, nominalRate: sampleRate, dropped, ok: r.ok && !dropped };
    if (!prev || prev.ok !== this.rateCheck.ok || Math.abs(prev.measuredRate - r.measuredRate) >= 1) this.changed();
  }

  /* ---------- 再生 ---------- */
  /**
   * 旋律音: 基音 triangle + 2 倍音 sine 0.3 + 3 倍音 sine 0.1、アタック 6ms、指数減衰、終わりで 60ms リリース。
   * A4 = 440 の平均律。
   */
  tone(group: PlayGroup, midi: number, t: number, dur: number): void {
    const ctx = this.ensureContext();
    const f = midiToHz(midi);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(TONE_PEAK, t + 0.006);
    env.gain.exponentialRampToValueAtTime(TONE_PEAK * 0.4, t + Math.max(0.02, dur));
    env.gain.linearRampToValueAtTime(0, t + Math.max(0.02, dur) + 0.06);
    env.connect(this.melodyBus);
    const sources: OscillatorNode[] = [];
    for (const [mult, level, type] of [[1, 1, "triangle"], [2, 0.3, "sine"], [3, 0.1, "sine"]] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * mult;
      if (level === 1) osc.connect(env);
      else {
        const g = ctx.createGain();
        g.gain.value = level;
        osc.connect(g).connect(env);
      }
      osc.start(t);
      osc.stop(t + Math.max(0.02, dur) + 0.08);
      sources.push(osc);
    }
    group.add(sources, env);
  }

  /** 主和音: 分散 各 0.35 秒 → 和音 0.9 秒 → 主音 0.7 秒（計 2.65 秒）。終わりの時刻を返す */
  chord(group: PlayGroup, notes: readonly number[], t: number): number {
    const ARP = 0.35, CHORD = 0.9, TONIC = 0.7;
    notes.forEach((m, i) => this.tone(group, m, t + i * ARP, ARP));
    const tc = t + notes.length * ARP;
    for (const m of notes) this.tone(group, m, tc, CHORD);
    this.tone(group, notes[0], tc + CHORD, TONIC);
    return tc + CHORD + TONIC;
  }

  /** クリック: 2000Hz（強拍 2500Hz）、30ms の正弦波（両端 2ms のランプ）。声の検出範囲の外に置く */
  click(group: PlayGroup, t: number, accent: boolean): void {
    this.sine(group, this.clickBus, accent ? 2500 : 2000, t, this.config.clickDurMs / 1000, 0.002, CLICK_PEAK);
  }

  /** ループバック試験の音: 440Hz・300ms（両端 5ms のランプ） */
  testTone(group: PlayGroup, t: number, hz = 440, dur = 0.3): void {
    this.sine(group, this.melodyBus, hz, t, dur, 0.005, TEST_TONE_PEAK);
  }

  private sine(group: PlayGroup, bus: GainNode, hz: number, t: number, dur: number, ramp: number, peak: number): void {
    const ctx = this.ensureContext();
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + ramp);
    env.gain.setValueAtTime(peak, t + dur - ramp);
    env.gain.linearRampToValueAtTime(0, t + dur);
    env.connect(bus);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = hz;
    osc.connect(env);
    osc.start(t);
    osc.stop(t + dur + 0.01);
    group.add([osc], env);
  }

  /** 録音（モノラル PCM）を鳴らす。聞こえやすい大きさに持ち上げる。終わりの時刻を返す */
  playPcm(group: PlayGroup, pcm: Float32Array, rate: number, t: number): number {
    const ctx = this.ensureContext();
    let buffer: AudioBuffer;
    try {
      buffer = ctx.createBuffer(1, Math.max(1, pcm.length), rate);
      buffer.getChannelData(0).set(pcm);
    } catch {
      // 24kHz / 22.05kHz の AudioBuffer を作れないブラウザ: 2 倍に戻して作る
      const up = new Float32Array(Math.max(2, pcm.length * 2));
      for (let i = 0; i < pcm.length; i++) {
        up[2 * i] = pcm[i];
        up[2 * i + 1] = (pcm[i] + (pcm[i + 1] ?? pcm[i])) / 2;
      }
      buffer = ctx.createBuffer(1, up.length, rate * 2);
      buffer.getChannelData(0).set(up);
    }
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > peak) peak = a; }
    const env = ctx.createGain();
    env.gain.value = peak > 0 ? Math.min(12, Math.max(1, 0.9 / peak)) : 1;
    env.connect(this.playbackBus);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(env);
    src.start(t);
    group.add([src], env);
    return t + buffer.duration;
  }
}

/** アプリ全体で 1 つ */
export const engine = new AudioEngine();
