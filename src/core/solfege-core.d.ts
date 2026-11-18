// solfege-core.d.ts — solfege-core.js の型宣言（sing2check が使う部分を中心に、export されている全項目）
// solfege-core.js 本体は自動生成で手を入れない。型が実体とずれたら、この .d.ts の方を直す。

/** 0 以上 1 未満を返す乱数関数。makeRng(seed) で作る。 */
export type Rng = () => number;

/** 旋法の id */
export type ModeName = "laPenta" | "doPenta" | "major" | "minor";
/** ドの音名（KEYS のキー） */
export type KeyName = "C" | "F" | "G" | "D" | "B♭" | "A" | "E♭";
/** 拍子の文字列 */
export type MeterString = "2/4" | "3/4" | "4/4" | "6/8";
/** 種目（小節数の決め方に使う）。sing2check は "sight" を使う。 */
export type ExerciseName = "rhythmHear" | "rhythmTap" | "sight" | "earMelody" | (string & {});
/** リズム型（セル）の id */
export type CellId =
  | "q" | "ee" | "ess" | "sse" | "ssss" | "r" | "re" | "d8s" | "s8s" | "trip" | "half" | "dqe" | "eqe"
  | "c_q" | "c_qe" | "c_eq" | "c_eee" | "c_r" | "c_eess" | "c_esse" | "c_d8s8" | "c_h" | "c_hemi";

/** 階名 = ドからの半音数 0〜11（9 = ラ）。 */
export type Solfa = number;

export interface Mode {
  /** 主音の階名（ドからの半音数）。laPenta / minor = 9、doPenta / major = 0 */
  tonic: Solfa;
  /** 主音からの半音数の列 */
  scale: number[];
  /** 主和音の 5 度・3 度の音階インデックス */
  fifth: number;
  third: number;
  /** 主和音の音の音階インデックス */
  chord: number[];
}

export interface KeyInfo {
  name: KeyName;
  /** ABC の K: に使う名前（"Bb" など） */
  abc: string;
  /** ドの pitch class（C=0） */
  pc: number;
  /** ドの文字（C=0 … B=6） */
  letter: number;
}

export interface CellEvent { dur: number; rest: boolean; }
export interface Cell {
  id: CellId;
  label: string;
  /** 占める拍数（1 か 2） */
  span: 1 | 2;
  compound: boolean;
  /** L:1/16 の ABC。音符は "X" のプレースホルダ */
  abc: string;
  events: CellEvent[];
}

export interface Level {
  lv: number;
  /** 例 "ペンタトニック・順次" */
  name: string;
  modes: Partial<Record<ModeName, number>>;
  keys: KeyName[];
  /** 音階インデックスの範囲 [下, 上] */
  range: [number, number];
  width: number;
  maxLeap: number;
  meters: Partial<Record<MeterString, number>>;
  simple: Partial<Record<CellId, number>> | null;
  compound: Partial<Record<CellId, number>> | null;
  /** 単純拍子のテンポ（1 拍 = 四分） */
  tempo: number;
  /** 複合拍子のテンポ（1 拍 = 付点四分） */
  ctempo: number;
}

export interface Meter {
  num: number;
  den: number;
  /** 1 小節の拍数（6/8 は 2） */
  beats: number;
  /** 1 拍の tick 数（単純 12、複合 18） */
  beatTicks: 12 | 18;
  compound: boolean;
  str: string;
}

export interface RhythmEvent {
  startTick: number;
  dur: number;
  rest: boolean;
  /** 小節番号（0 始まり） */
  bar: number;
  /** セルが始まる拍（小節内、0 始まり） */
  slot: number;
  /** その音が属する拍（小節内、0 始まり） */
  beat: number;
  cell: CellId;
  cellIndex: number;
}

export interface Rhythm {
  meter: Meter;
  bars: CellId[][];
  events: RhythmEvent[];
  totalTicks: number;
  level: number;
}

export interface MelodyNote {
  /** 表記上の MIDI 音高（55〜79） */
  midi: number;
  /** 階名（ドからの半音数 0〜11） */
  solfa: Solfa;
  /** 階名の表示名（NAMES[solfa]） */
  name: string;
  startTick: number;
  dur: number;
  bar: number;
  /** 音階インデックス */
  idx: number;
  /** 半音の変位（ソ♯ などで +1 / −1、無ければ 0） */
  alt: number;
}

export interface Melody {
  level: number;
  rhythm: Rhythm;
  mode: ModeName;
  doPc: number;
  doName: KeyName;
  /** 主音の MIDI（旋律の配置に使った基準。必ずしも旋律中の音ではない） */
  tonicMidi: number;
  tonicSolfa: Solfa;
  /** 主音の階名（"ラ" / "ド"） */
  tonicName: string;
  /** 鳴る音だけ（休符は含まない）。時間順。 */
  notes: MelodyNote[];
  /** 五線譜の ABC（L:1/16、ト音記号） */
  abc(): string;
  /** 階名の歌詞行（w:）つき ABC */
  abcWithSolfa(): string;
  /** リズムだけの一線譜 ABC */
  rhythmAbc(): string;
}

export interface GenRhythmOptions {
  meter?: MeterString;
  bars?: number;
  exercise?: ExerciseName;
  /** true なら休符セルの重みを 0.4 倍 */
  melodic?: boolean;
}

export interface GenMelodyOptions {
  bars?: number;
  /** 小節数を決める種目。sing2check は "sight"（2/4・3/4・6/8 は 4 小節、4/4 は 2 小節） */
  exercise?: ExerciseName;
  meter?: MeterString;
  mode?: ModeName;
}

export interface KeyChoice {
  mode: ModeName;
  doName: KeyName;
  doPc: number;
  tonicPc: number;
  tonicSolfa: Solfa;
}
export interface EarKey extends KeyChoice { tonicMidi: number; }
export interface EarNote { solfa: Solfa; name: string; midi: number; }

export interface JudgeRhythmResult {
  correct: boolean;
  slots: { index: number; ok: boolean }[];
  missedCells: CellId[];
}
export interface JudgeMelodyResult {
  correct: boolean;
  per: boolean[];
  hits: number;
  count: number;
  /** "ミ>ソ" の形（出題>回答） */
  confusions: string[];
}
export interface JudgeTapsResult {
  hits: number;
  misses: number;
  extras: number;
  accuracy: number;
  meanDevMs: number;
  sdDevMs: number;
  perOnset: { devMs: number | null }[];
  passed: boolean;
}

export interface SolfegeCoreApi {
  /** 1 四分音符の tick 数 = 12 */
  TPQ: 12;
  /** 階名の表示名。添字 = ドからの半音数。["ド","ド♯","レ","レ♯","ミ","ファ","ファ♯","ソ","ソ♯","ラ","シ♭","シ"] */
  NAMES: string[];
  /** 半音数 → [音階度数, 変位] */
  SPELL: Record<number, [number, number]>;
  LETTERS: string[];
  MODES: Record<ModeName, Mode>;
  KEYS: Record<KeyName, KeyInfo>;
  CELLS: Record<CellId, Cell>;
  CELL_LIST: Cell[];
  REST_CELLS: Partial<Record<CellId, 1>>;
  /** 添字 1〜8 がレベル。LEVELS[0] は null */
  LEVELS: [null, Level, Level, Level, Level, Level, Level, Level, Level];
  MAX_LEVEL: 8;

  makeRng(seed: number): Rng;
  meterInfo(str: string): Meter;
  barsFor(exercise: ExerciseName, meter: Meter): number;
  levelTempo(level: number, meter: Meter): number;
  cellsFor(level: number, compound: boolean): CellId[];
  spanAllowedAt(meter: Meter, beat: number): boolean;
  expandBars(bars: CellId[][], beatTicks: number): { events: RhythmEvent[]; totalTicks: number };
  genRhythm(level: number, opts: GenRhythmOptions | undefined, rng: Rng): Rhythm;
  /** 失敗すると例外 "genMelody failed"（実用上は起きない） */
  genMelody(level: number, opts: GenMelodyOptions | undefined, rng: Rng): Melody;
  pickKey(level: number, rng: Rng, mode?: ModeName): KeyChoice;
  earKey(level: number, rng: Rng): EarKey;
  genEarNotes(level: number, key: EarKey, count: number, history: Solfa[] | null | undefined, rng: Rng): EarNote[];
  /** レベル（と旋法）で使う階名の集合。答えボタンの並び順 */
  answerSet(level: number, mode?: ModeName): Solfa[];
  /** 主和音の MIDI 3 音（ラ主音なら短三和音、ド主音なら長三和音） */
  contextNotes(mode: ModeName, tonicMidi: number): [number, number, number];
  keyAccidentals(doName: KeyName): Record<number, number>;
  barsPerLine(r: Rhythm, kind: "rhythm" | "melody"): 1 | 2;
  spellNote(midi: number, solfa: Solfa, doName: KeyName, keyAcc: Record<number, number>, barState: Record<string, number>): string;
  melodyAbc(m: Melody, withSolfa: boolean): string;
  rhythmAbc(r: Rhythm): string;
  cellAbc(id: CellId): string;
  judgeRhythm(truthEvents: RhythmEvent[], answerBars: CellId[][], beatTicks?: number): JudgeRhythmResult;
  judgeMelody(notes: { solfa: Solfa }[], answers: (Solfa | null | undefined)[]): JudgeMelodyResult;
  judgeTaps(expected: number[], taps: number[], opts?: { windowSec?: number; gapRatio?: number }): JudgeTapsResult;
  /** tick → 秒。bpm は 1 拍あたり、beatTicks は Meter.beatTicks */
  ticksToSec(ticks: number, bpm: number, beatTicks: number): number;
  scaleRel(mode: ModeName, idx: number): number;
}

declare const SolfegeCore: SolfegeCoreApi;
export default SolfegeCore;

export declare const TPQ: SolfegeCoreApi["TPQ"];
export declare const NAMES: SolfegeCoreApi["NAMES"];
export declare const SPELL: SolfegeCoreApi["SPELL"];
export declare const LETTERS: SolfegeCoreApi["LETTERS"];
export declare const MODES: SolfegeCoreApi["MODES"];
export declare const KEYS: SolfegeCoreApi["KEYS"];
export declare const CELLS: SolfegeCoreApi["CELLS"];
export declare const CELL_LIST: SolfegeCoreApi["CELL_LIST"];
export declare const REST_CELLS: SolfegeCoreApi["REST_CELLS"];
export declare const LEVELS: SolfegeCoreApi["LEVELS"];
export declare const MAX_LEVEL: SolfegeCoreApi["MAX_LEVEL"];
export declare const makeRng: SolfegeCoreApi["makeRng"];
export declare const meterInfo: SolfegeCoreApi["meterInfo"];
export declare const barsFor: SolfegeCoreApi["barsFor"];
export declare const levelTempo: SolfegeCoreApi["levelTempo"];
export declare const cellsFor: SolfegeCoreApi["cellsFor"];
export declare const spanAllowedAt: SolfegeCoreApi["spanAllowedAt"];
export declare const expandBars: SolfegeCoreApi["expandBars"];
export declare const genRhythm: SolfegeCoreApi["genRhythm"];
export declare const genMelody: SolfegeCoreApi["genMelody"];
export declare const pickKey: SolfegeCoreApi["pickKey"];
export declare const earKey: SolfegeCoreApi["earKey"];
export declare const genEarNotes: SolfegeCoreApi["genEarNotes"];
export declare const answerSet: SolfegeCoreApi["answerSet"];
export declare const contextNotes: SolfegeCoreApi["contextNotes"];
export declare const keyAccidentals: SolfegeCoreApi["keyAccidentals"];
export declare const barsPerLine: SolfegeCoreApi["barsPerLine"];
export declare const spellNote: SolfegeCoreApi["spellNote"];
export declare const melodyAbc: SolfegeCoreApi["melodyAbc"];
export declare const rhythmAbc: SolfegeCoreApi["rhythmAbc"];
export declare const cellAbc: SolfegeCoreApi["cellAbc"];
export declare const judgeRhythm: SolfegeCoreApi["judgeRhythm"];
export declare const judgeMelody: SolfegeCoreApi["judgeMelody"];
export declare const judgeTaps: SolfegeCoreApi["judgeTaps"];
export declare const ticksToSec: SolfegeCoreApi["ticksToSec"];
export declare const scaleRel: SolfegeCoreApi["scaleRel"];
