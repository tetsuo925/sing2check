// 記録の集計・まとめの文・コピー文（ハンドオフ文書 §11.3、§14）。純関数。
import Core from "../core/solfege-core.js";
import type { TakeResult } from "./judge.ts";
import type { PersistedState, TakeRecord } from "../storage.ts";
import { RECENT_MAX, localDateString } from "../storage.ts";

const NAMES = Core.NAMES;
/** マイナス記号は U+2212（練習帳と同じ） */
export const MINUS = "−";

/** 符号つきの整数。+12 / −12 / ±0 */
export function signed(value: number): string {
  const n = Math.round(value);
  return n > 0 ? `+${n}` : n < 0 ? `${MINUS}${-n}` : "±0";
}

function mean(a: number[]): number {
  return a.reduce((s, x) => s + x, 0) / a.length;
}
function median(a: number[]): number {
  const s = a.slice().sort((x, y) => x - y), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
const percent = (ok: number, total: number) => Math.round(100 * ok / total);
const isHit = (status: string) => status === "good" || status === "ok";

/* ---------- 文の部品 ---------- */
/** 平均ずれ（セント）の言い方。|m| < 5 は「ほぼ正確」 */
export function tendencyWord(meanCents: number): "低め" | "高め" | "ほぼ正確" {
  const m = Math.round(meanCents);
  return Math.abs(m) < 5 ? "ほぼ正確" : m < 0 ? "低め" : "高め";
}

/** 全体の時間ずれの言い方。|Δ| ≤ 20ms は「±20ms 以内」 */
export function timingPhrase(offsetMs: number): string {
  const ms = Math.round(offsetMs);
  if (Math.abs(ms) <= 20) return "全体のずれ ±20ms 以内";
  return ms > 0 ? `全体に +${ms}ms 遅れ` : `全体に ${MINUS}${-ms}ms 早め`;
}

/** Δ 合わせの得点が音数の半分以上なら、Δ は意味を持つ */
export function timingReliable(result: Pick<TakeResult, "offsetScore" | "count">): boolean {
  return result.offsetScore >= result.count / 2;
}

/** 結果のまとめ 1 行: `8 音中 7 音 正解・平均 −12 セント（低め）・全体に +40ms 遅れ` */
export function summaryLine(result: TakeResult): string {
  const pitch = result.meanDevCents === null
    ? "平均 —"
    : `平均 ${signed(result.meanDevCents)} セント（${tendencyWord(result.meanDevCents)}）`;
  const timing = timingReliable(result) ? timingPhrase(result.offsetMs) : "タイミングは判定できず";
  return `${result.count} 音中 ${result.correct} 音 正解・${pitch}・${timing}`;
}

const INTERVAL_NAMES = ["同音", "短2度", "長2度", "短3度", "長3度", "4度", "増4度", "5度", "短6度", "長6度", "短7度", "長7度", "オクターブ"];

/** 直前の音からの音程（半音・符号つき）の名前。`上行 4度`、`下行 短3度`、`同音` */
export function intervalName(semitones: number): string {
  const a = Math.abs(semitones);
  const base = INTERVAL_NAMES[a] ?? `${a}半音`;
  return semitones === 0 ? base : `${semitones > 0 ? "上行" : "下行"} ${base}`;
}

/* ---------- 集計 ---------- */
export interface AccuracyRow { label: string; total: number; correct: number; percent: number }
export interface ConfusionRow { label: string; count: number }
export interface DayRow { localDate: string; label: string; takes: number; passed: number }

const WEAK_MIN_COUNT = 5;
const WEAK_HIDE_PERCENT = 90;
const WEAK_ROWS = 3;
const CONFUSION_ROWS = 5;
const PITCH_TAKES = 20;
const DAYS = 14;

function weakest(groups: Map<number, { total: number; correct: number }>, label: (key: number) => string): AccuracyRow[] {
  return [...groups.entries()]
    .map(([key, g]) => ({ key, label: label(key), total: g.total, correct: g.correct, percent: percent(g.correct, g.total) }))
    .filter((r) => r.total >= WEAK_MIN_COUNT && r.percent < WEAK_HIDE_PERCENT)
    .sort((a, b) => a.percent - b.percent || b.total - a.total || a.key - b.key)
    .slice(0, WEAK_ROWS)
    .map(({ label: l, total, correct, percent: p }) => ({ label: l, total, correct, percent: p }));
}

function tally(takes: TakeRecord[], keyOf: (note: TakeRecord["notes"][number]) => number | null): Map<number, { total: number; correct: number }> {
  const groups = new Map<number, { total: number; correct: number }>();
  for (const take of takes) {
    for (const note of take.notes) {
      const key = keyOf(note);
      if (key === null) continue;
      const g = groups.get(key) ?? { total: 0, correct: 0 };
      g.total++;
      if (isHit(note.status)) g.correct++;
      groups.set(key, g);
    }
  }
  return groups;
}

/** 外しやすい階名（5 回以上出たもののうち正答率の低い順に 3 つ、90% 以上は出さない） */
export function weakSolfa(takes: TakeRecord[]): AccuracyRow[] {
  return weakest(tally(takes, (n) => n.solfa), (solfa) => NAMES[solfa] ?? String(solfa));
}

/** 外しやすい音程（直前の音からの音程ごと） */
export function weakIntervals(takes: TakeRecord[]): AccuracyRow[] {
  return weakest(tally(takes, (n) => n.intervalFromPrevious), intervalName);
}

/** 取り違え（出題→回答）。多い順に 5 つ */
export function topConfusions(takes: TakeRecord[]): ConfusionRow[] {
  const counts = new Map<string, number>();
  for (const take of takes) {
    for (const note of take.notes) {
      if (note.status !== "wrong" || note.sungSolfa === null) continue;
      const label = `${NAMES[note.solfa]}→${NAMES[note.sungSolfa]}`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ja"))
    .slice(0, CONFUSION_ROWS);
}

/** 直近 14 日（今日を含む）の日別テイク数と合格数。古い順。テイクの無い日も入る */
export function dailyCounts(takes: TakeRecord[], now: Date): DayRow[] {
  const rows: DayRow[] = [];
  for (let back = DAYS - 1; back >= 0; back--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    rows.push({ localDate: localDateString(d), label: `${d.getMonth() + 1}/${d.getDate()}`, takes: 0, passed: 0 });
  }
  const byDate = new Map(rows.map((r) => [r.localDate, r]));
  for (const take of takes) {
    const row = byDate.get(take.localDate);
    if (!row) continue;
    row.takes++;
    if (take.passed) row.passed++;
  }
  return rows;
}

export interface PitchSummary { meanCents: number; meanAbsCents: number; driftCents: number | null }

/** 直近 20 テイク（全レベル）の good/ok の音のずれ。該当なしは null */
export function pitchSummary(takes: TakeRecord[]): PitchSummary | null {
  const recent = takes.slice(0, PITCH_TAKES);
  const devs: number[] = [];
  for (const take of recent) for (const n of take.notes) if (isHit(n.status) && n.deviationCents !== null) devs.push(n.deviationCents);
  if (!devs.length) return null;
  const drifts = recent.map((t) => t.driftCents).filter((x): x is number => x !== null);
  return { meanCents: mean(devs), meanAbsCents: mean(devs.map(Math.abs)), driftCents: drifts.length ? mean(drifts) : null };
}

/** 直近 20 テイクのうち、タイミングを判定できたものの Δ の中央値（ms）。該当なしは null */
export function timingSummary(takes: TakeRecord[]): number | null {
  const offsets = takes.slice(0, PITCH_TAKES).filter((t) => t.timingReliable).map((t) => t.timingOffsetMs);
  return offsets.length ? median(offsets) : null;
}

export interface LevelSummary { level: number; recentCount: number; recentPercent: number | null; totalTakes: number }

export function levelSummary(state: PersistedState): LevelSummary {
  const recent = state.recent;
  return {
    level: state.level,
    recentCount: recent.length,
    recentPercent: recent.length ? percent(recent.filter(Boolean).length, recent.length) : null,
    totalTakes: state.totalsByLevel[String(state.level)]?.takes ?? 0,
  };
}

/* ---------- コピー文（§14.3） ---------- */
const NONE = "まだ記録がありません";

export function pitchLine(takes: TakeRecord[]): string {
  const p = pitchSummary(takes);
  if (!p) return `音程: ${NONE}`;
  const parts = [`平均 ${signed(p.meanCents)} セント（${tendencyWord(p.meanCents)}）`, `ずれの大きさ 平均 ${Math.round(p.meanAbsCents)} セント`];
  if (p.driftCents !== null) parts.push(`後半に向かって ${signed(p.driftCents)} セント`);
  return `音程: ${parts.join("・")}`;
}

export function timingLine(takes: TakeRecord[]): string {
  const t = timingSummary(takes);
  return t === null ? `タイミング: ${NONE}` : `タイミング: ${timingPhrase(t)}（中央値）`;
}

function accuracyList(rows: AccuracyRow[]): string {
  return rows.map((r, i) => `${r.label}（${i === 0 ? "正答 " : ""}${r.percent}%）`).join(", ");
}

export function weakSolfaLine(takes: TakeRecord[]): string {
  const rows = weakSolfa(takes);
  return `外しやすい階名: ${rows.length ? accuracyList(rows) : NONE}`;
}

export function weakIntervalLine(takes: TakeRecord[]): string {
  const rows = weakIntervals(takes);
  return `外しやすい音程: ${rows.length ? accuracyList(rows) : NONE}`;
}

export function confusionLine(takes: TakeRecord[]): string {
  const rows = topConfusions(takes);
  return `取り違え: ${rows.length ? rows.map((r) => `${r.label} ×${r.count}`).join(", ") : NONE}`;
}

export function dailyLine(takes: TakeRecord[], now: Date): string {
  const rows = dailyCounts(takes, now).filter((r) => r.takes > 0);
  return `直近14日: ${rows.length ? rows.map((r) => `${r.label} ${r.takes}回 合格 ${r.passed}`).join(", ") : NONE}`;
}

export function levelLine(state: PersistedState): string {
  const s = levelSummary(state);
  if (s.recentPercent === null) return `Lv${s.level} ${NONE}`;
  return `Lv${s.level} 直近${s.recentCount}回 合格 ${s.recentPercent}%（累計 ${s.totalTakes} 回）`;
}

/** 「結果をコピー」の文（8 行） */
export function buildCopyText(takes: TakeRecord[], state: PersistedState, now: Date): string {
  return [
    `視唱チェッカーの記録（${localDateString(now)} 時点）`,
    levelLine(state),
    pitchLine(takes),
    timingLine(takes),
    weakSolfaLine(takes),
    weakIntervalLine(takes),
    confusionLine(takes),
    dailyLine(takes, now),
  ].join("\n");
}

/* ---------- 記録に積む ---------- */
/** テイク 1 つを状態に積む（直近の合否・レベルの累計） */
export function addTakeToState(state: PersistedState, take: Pick<TakeRecord, "level" | "passed">): PersistedState {
  const key = String(take.level);
  const prev = state.totalsByLevel[key] ?? { takes: 0, passed: 0 };
  return {
    ...state,
    recent: take.level === state.level ? [...state.recent, take.passed].slice(-RECENT_MAX) : state.recent,
    totalsByLevel: { ...state.totalsByLevel, [key]: { takes: prev.takes + 1, passed: prev.passed + (take.passed ? 1 : 0) } },
  };
}

/* ---------- レベルの提案（§14.4） ---------- */
export interface Nudge { kind: "up" | "down"; percent: number; targetLevel: number; message: string }

const NUDGE_UP_PERCENT = 80;
const NUDGE_DOWN_PERCENT = 40;

/** 直近 10 回で合格 80% 以上なら次のレベル、40% 以下なら前のレベルを提案する。閉じたら、さらに 10 テイクたまるまで出さない */
export function levelNudge(state: PersistedState, maxLevel: number): Nudge | null {
  if (state.recent.length < RECENT_MAX) return null;
  const total = state.totalsByLevel[String(state.level)]?.takes ?? 0;
  if (state.nudgeSnoozedAtCount > 0 && total - state.nudgeSnoozedAtCount < RECENT_MAX) return null;
  const p = percent(state.recent.filter(Boolean).length, state.recent.length);
  if (p >= NUDGE_UP_PERCENT && state.level < maxLevel) {
    return { kind: "up", percent: p, targetLevel: state.level + 1, message: `直近 ${state.recent.length} 回で合格 ${p}%。Lv${state.level + 1} に進めます` };
  }
  if (p <= NUDGE_DOWN_PERCENT && state.level > 1) {
    return { kind: "down", percent: p, targetLevel: state.level - 1, message: `少し難しいようです。Lv${state.level - 1} に戻りますか` };
  }
  return null;
}

/** 提案帯を閉じる（「まだ続ける」「このまま」） */
export function snoozeNudge(state: PersistedState): PersistedState {
  return { ...state, nudgeSnoozedAtCount: state.totalsByLevel[String(state.level)]?.takes ?? 0 };
}

/** レベルを変える。直近の合否は空にする */
export function changeLevel(state: PersistedState, level: number): PersistedState {
  return level === state.level ? state : { ...state, level, recent: [], nudgeSnoozedAtCount: 0 };
}
