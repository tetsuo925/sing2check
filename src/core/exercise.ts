// 課題番号・seed・テンポ・カウントの拍数。課題の中身は solfege-core が作る。
import Core from "./solfege-core.js";
import type { Melody, Meter } from "./solfege-core.js";

export interface Exercise {
  level: number;
  seed: number;
  /** 課題番号。例 "Lv3-48213" */
  id: string;
  melody: Melody;
  /** レベルの既定テンポ（1 拍あたりの BPM。6/8 は付点四分） */
  defaultTempo: number;
}

export const MIN_LEVEL = 1;
export const MAX_LEVEL: number = Core.MAX_LEVEL;

/** seed は 10000〜99999 の整数 */
export function newSeed(random: () => number = Math.random): number {
  return Math.floor(10000 + random() * 90000);
}

export function exerciseId(level: number, seed: number): string {
  return `Lv${level}-${seed}`;
}

/** 同じ level と seed なら同じ課題になる */
export function makeExercise(level: number, seed: number): Exercise {
  const melody = Core.genMelody(level, { exercise: "sight" }, Core.makeRng(seed));
  return { level, seed, id: exerciseId(level, seed), melody, defaultTempo: Core.levelTempo(level, melody.rhythm.meter) };
}

export function levelName(level: number): string {
  return Core.LEVELS[level]?.name ?? "";
}

/* ---------- テンポ ---------- */
export const TEMPO_STEP = 4;
const TEMPO_MIN_RATIO = 0.6;
/** 上限 1.2 倍は、合成信号で「1 音だけ歌わない」の判定が崩れなかった範囲（ハンドオフ文書 §18.3） */
const TEMPO_MAX_RATIO = 1.2;

/** テンポの範囲。4 の倍数に、範囲の内側へ丸める（上限が 1.2 倍を超えないように） */
export function tempoRange(defaultTempo: number): { min: number; max: number } {
  return {
    min: Math.ceil(defaultTempo * TEMPO_MIN_RATIO / TEMPO_STEP) * TEMPO_STEP,
    max: Math.floor(defaultTempo * TEMPO_MAX_RATIO / TEMPO_STEP) * TEMPO_STEP,
  };
}

/** 「−」「＋」: 隣の 4 の倍数へ。範囲の外には出ない */
export function stepTempo(bpm: number, direction: 1 | -1, defaultTempo: number): number {
  const { min, max } = tempoRange(defaultTempo);
  const next = direction > 0 ? Math.floor(bpm / TEMPO_STEP) * TEMPO_STEP + TEMPO_STEP : Math.ceil(bpm / TEMPO_STEP) * TEMPO_STEP - TEMPO_STEP;
  return Math.min(max, Math.max(min, next));
}

/** 保存してあるテンポを課題に当てはめる。範囲の外（別の拍子で決めた値など）なら既定に戻す */
export function resolveTempo(stored: number | undefined, defaultTempo: number): number {
  if (stored === undefined || !Number.isFinite(stored)) return defaultTempo;
  const { min, max } = tempoRange(defaultTempo);
  return stored >= min && stored <= max ? stored : defaultTempo;
}

/** tempoByLevel のキー。単純拍子は "7"、6/8 は "7:6/8"（同じレベルでも既定テンポが違うため別に持つ） */
export function tempoKey(level: number, meter: Meter): string {
  return meter.compound ? `${level}:${meter.str}` : String(level);
}

/** `2/4 ♩=66`、6/8 は `6/8 ♩.=54` */
export function tempoLabel(meter: Meter, bpm: number): string {
  return `${meter.str} ${meter.compound ? "♩." : "♩"}=${bpm}`;
}

/* ---------- 時間 ---------- */
/** カウントの拍数。2/4・6/8 は 2 小節、3/4・4/4 は 1 小節 */
export function countBeatsFor(meter: Meter): number {
  return meter.num === 4 && meter.den === 4 ? 4 : meter.num === 3 ? 3 : 2 * meter.beats;
}

/** 課題の長さ（秒） */
export function totalSeconds(melody: Melody, bpm: number): number {
  return Core.ticksToSec(melody.rhythm.totalTicks, bpm, melody.rhythm.meter.beatTicks);
}

/* ---------- テスト用: URL のハッシュで課題を指定する（#e2e-Lv3-48213） ---------- */
export function parseExerciseHash(hash: string): { level: number; seed: number } | null {
  const m = /^#?e2e-Lv([1-8])-(\d{5})$/.exec(hash);
  return m ? { level: +m[1], seed: +m[2] } : null;
}
