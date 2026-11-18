// 記録は端末の localStorage のみ。全アクセスを try/catch で包む。
// 使えない状態（プライベートブラウズなど）でもアプリは動く（記録されないだけ）。
import type { NoteStatus } from "./judge/judge.ts";

const KEY_SETTINGS = "sing2check.v1.settings";
const KEY_STATE = "sing2check.v1.state";
const KEY_TAKES = "sing2check.v1.takes";

export const MAX_TAKES = 200;
export const RECENT_MAX = 10;

export interface Settings {
  schema: 1;
  chordBeforeTake: boolean;
  clicksDuringTake: boolean;
  showPitchWhileSinging: boolean;
  playbackOctaveDown: boolean;
  gateDb: number;
  /** ループバック試験の結果。未測定は null */
  roundTripMs: number | null;
  roundTripMeasuredAt: string | null;
}

export interface PersistedState {
  schema: 1;
  level: number;
  /** ユーザーが変えたテンポ（無ければ既定）。キーは exercise.ts の tempoKey */
  tempoByLevel: Record<string, number>;
  /** 現在のレベルでの直近の合否（最大 10、レベルを変えたら空） */
  recent: boolean[];
  /** 提案帯を閉じたときの、そのレベルの累計テイク数 */
  nudgeSnoozedAtCount: number;
  totalsByLevel: Record<string, { takes: number; passed: number }>;
}

export interface TakeNoteRecord {
  solfa: number;
  name: string;
  intervalFromPrevious: number | null;
  status: NoteStatus;
  deviationCents: number | null;
  sungSolfa: number | null;
}

export interface TakeRecord {
  date: string;
  localDate: string;
  level: number;
  exerciseId: string;
  seed: number;
  meter: string;
  tempo: number;
  noteCount: number;
  correctCount: number;
  passed: boolean;
  meanDeviationCents: number | null;
  meanAbsoluteDeviationCents: number | null;
  driftCents: number | null;
  timingOffsetMs: number;
  /** Δ 合わせの得点が音数の半分以上 */
  timingReliable: boolean;
  /** null = 未測定 */
  roundTripMsUsed: number | null;
  hintsUsed: { tonicChord: boolean; firstNote: boolean };
  chordBeforeTake: boolean;
  clicksDuringTake: boolean;
  notes: TakeNoteRecord[];
}

export const GATE_MIN_DB = -70;
export const GATE_MAX_DB = -30;
export const GATE_STEP_DB = 5;

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  schema: 1,
  chordBeforeTake: true,
  clicksDuringTake: true,
  showPitchWhileSinging: false,
  playbackOctaveDown: false,
  gateDb: -50,
  roundTripMs: null,
  roundTripMeasuredAt: null,
});

export function defaultState(): PersistedState {
  return { schema: 1, level: 1, tempoByLevel: {}, recent: [], nudgeSnoozedAtCount: 0, totalsByLevel: {} };
}

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 書けたら true。使えない・容量超過は false（呼び出し側は無視してよい） */
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function loadSettings(): Settings {
  const v = read(KEY_SETTINGS);
  if (!isObject(v) || v.schema !== 1) return { ...DEFAULT_SETTINGS };
  const d = DEFAULT_SETTINGS;
  const gate = Math.min(GATE_MAX_DB, Math.max(GATE_MIN_DB, num(v.gateDb, d.gateDb)));
  const rt = typeof v.roundTripMs === "number" && Number.isFinite(v.roundTripMs) && v.roundTripMs >= 0 ? v.roundTripMs : null;
  return {
    schema: 1,
    chordBeforeTake: bool(v.chordBeforeTake, d.chordBeforeTake),
    clicksDuringTake: bool(v.clicksDuringTake, d.clicksDuringTake),
    showPitchWhileSinging: bool(v.showPitchWhileSinging, d.showPitchWhileSinging),
    playbackOctaveDown: bool(v.playbackOctaveDown, d.playbackOctaveDown),
    gateDb: gate,
    roundTripMs: rt,
    roundTripMeasuredAt: rt !== null && typeof v.roundTripMeasuredAt === "string" ? v.roundTripMeasuredAt : null,
  };
}

export function saveSettings(s: Settings): boolean {
  return write(KEY_SETTINGS, s);
}

export function loadState(): PersistedState {
  const v = read(KEY_STATE);
  const d = defaultState();
  if (!isObject(v) || v.schema !== 1) return d;
  const level = Math.min(8, Math.max(1, Math.round(num(v.level, 1))));
  const tempoByLevel: Record<string, number> = {};
  if (isObject(v.tempoByLevel)) for (const [k, t] of Object.entries(v.tempoByLevel)) if (typeof t === "number" && Number.isFinite(t)) tempoByLevel[k] = t;
  const totalsByLevel: PersistedState["totalsByLevel"] = {};
  if (isObject(v.totalsByLevel)) {
    for (const [k, t] of Object.entries(v.totalsByLevel)) if (isObject(t)) totalsByLevel[k] = { takes: num(t.takes, 0), passed: num(t.passed, 0) };
  }
  return {
    schema: 1,
    level,
    tempoByLevel,
    recent: Array.isArray(v.recent) ? v.recent.filter((x): x is boolean => typeof x === "boolean").slice(-RECENT_MAX) : [],
    nudgeSnoozedAtCount: num(v.nudgeSnoozedAtCount, 0),
    totalsByLevel,
  };
}

export function saveState(s: PersistedState): boolean {
  return write(KEY_STATE, s);
}

/** 新しい順 */
export function loadTakes(): TakeRecord[] {
  const v = read(KEY_TAKES);
  if (!Array.isArray(v)) return [];
  return v.filter((t): t is TakeRecord => isObject(t) && typeof t.date === "string" && typeof t.level === "number" && Array.isArray(t.notes)).slice(0, MAX_TAKES);
}

export function saveTakes(takes: TakeRecord[]): boolean {
  return write(KEY_TAKES, takes.slice(0, MAX_TAKES));
}

/** 「記録を消す」: テイクと合否の集計を消す。設定（往復の遅れを含む）・レベル・テンポは残す */
export function clearRecords(state: PersistedState): PersistedState {
  const next: PersistedState = { ...state, recent: [], nudgeSnoozedAtCount: 0, totalsByLevel: {} };
  try { localStorage.removeItem(KEY_TAKES); } catch { /* 無視 */ }
  saveState(next);
  return next;
}

/** 端末の日付（YYYY-MM-DD） */
export function localDateString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
