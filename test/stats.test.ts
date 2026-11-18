// 記録の集計とコピー文の形（ハンドオフ文書 §11.3、§14.3、§14.4）
import { describe, test, expect } from "vitest";
import Core from "../src/core/solfege-core.js";
import {
  buildCopyText, summaryLine, intervalName, timingPhrase, signed, tendencyWord,
  levelNudge, snoozeNudge, changeLevel, addTakeToState, dailyCounts, weakIntervals,
} from "../src/judge/stats.ts";
import type { TakeResult, NoteStatus } from "../src/judge/judge.ts";
import type { PersistedState, TakeRecord, TakeNoteRecord } from "../src/storage.ts";
import { defaultState } from "../src/storage.ts";

const NOW = new Date(2026, 10, 20, 9, 30); // 2026-11-20（端末の日付）
const RA = 9, DO = 0, RE = 2, MI = 4, SO = 7;

/** g = good（+7）、o = ok（−35）、s = silent、w = wrong（sung を歌った） */
function note(solfa: number, kind: "g" | "o" | "s" | "w", interval: number | null, sung: number | null = null): TakeNoteRecord {
  const status: NoteStatus = kind === "g" ? "good" : kind === "o" ? "ok" : kind === "s" ? "silent" : "wrong";
  const deviationCents = kind === "g" ? 7 : kind === "o" ? -35 : kind === "w" ? 100 * (((sung as number) - solfa + 18) % 12 - 6) : null;
  return { solfa, name: Core.NAMES[solfa], intervalFromPrevious: interval, status, deviationCents, sungSolfa: sung };
}

function take(localDate: string, notes: TakeNoteRecord[], o: { drift?: number | null; offset?: number; reliable?: boolean } = {}): TakeRecord {
  const hit = notes.filter((n) => n.status === "good" || n.status === "ok");
  return {
    date: `${localDate}T01:00:00.000Z`, localDate, level: 2, exerciseId: "Lv2-48213", seed: 48213, meter: "2/4", tempo: 63,
    noteCount: notes.length, correctCount: hit.length, passed: hit.length === notes.length,
    meanDeviationCents: null, meanAbsoluteDeviationCents: null,
    driftCents: o.drift ?? null, timingOffsetMs: o.offset ?? 60, timingReliable: o.reliable ?? true, roundTripMsUsed: null,
    hintsUsed: { tonicChord: false, firstNote: false }, chordBeforeTake: true, clicksDuringTake: true, notes,
  };
}

// 9 テイク（11/18 に 6、11/19 に 3）と、14 日より前の 1 テイク。
//   階名: ソ 5/7（71%）、ミ 8/10（80%）、ド 9/10（90% → 出さない）、レ 1/4（5 回未満 → 出さない）、ラ 13/14
//   音程: +5 が 3/5（60%）、−7 が 4/6（67%）、+2 が 17/20（85%）、−2 が 4/4（5 回未満）
//   good/ok の音: +7 が 18、−35 が 18 → 平均 −14、大きさの平均 21
const T1 = take("2026-11-18", [note(RA, "g", null), note(DO, "o", 2), note(MI, "g", 2), note(SO, "o", 2), note(RA, "g", 2)], { drift: -12, offset: 40 });
const T2 = take("2026-11-18", [note(RA, "o", null), note(DO, "g", 2), note(RE, "w", 2, MI), note(MI, "o", 2), note(SO, "g", 5)], { offset: 60 });
const T3 = take("2026-11-18", [note(MI, "w", null, SO), note(RA, "o", 5), note(DO, "g", -7), note(MI, "o", 2), note(RA, "g", 2)], { offset: 80 });
const T4 = take("2026-11-18", [note(RA, "o", null), note(SO, "s", -7), note(DO, "g", 2), note(RE, "w", 5, MI), note(MI, "o", 2)], { offset: 60 });
const T5 = take("2026-11-18", [note(DO, "g", null), note(MI, "o", 2), note(SO, "w", 2, RA), note(RA, "g", 2), note(DO, "o", -7)], { drift: -6, offset: 100 });
const T6 = take("2026-11-18", [note(RA, "g", null), note(DO, "s", 5), note(MI, "o", 2), note(RA, "g", 2), note(SO, "o", -7)], { offset: 20 });
const T7 = take("2026-11-19", [note(MI, "g", null), note(MI, "w", -7, SO), note(RA, "o", 2), note(DO, "g", 2), note(RE, "w", 2, MI)], { offset: 500, reliable: false });
const T8 = take("2026-11-19", [note(DO, "o", null), note(RA, "g", 5), note(MI, "o", -2), note(SO, "g", -7), note(RA, "o", -2)], { drift: -9, offset: 60 });
const T9 = take("2026-11-19", [note(RA, "g", null), note(DO, "o", 2), note(RE, "g", -2), note(SO, "o", -2)], { offset: 60 });
const OLD = take("2026-10-01", [note(RA, "s", null)], { offset: 0, reliable: false });
const TAKES = [T9, T8, T7, T6, T5, T4, T3, T2, T1, OLD]; // 新しい順

const STATE: PersistedState = {
  ...defaultState(), level: 2,
  recent: [true, true, false, true, true, false, true, true, false, true],
  totalsByLevel: { "2": { takes: 34, passed: 20 } },
};

describe("コピー文", () => {
  test("8 行の形（数字・符号・音程の名前・順番）", () => {
    expect(buildCopyText(TAKES, STATE, NOW)).toBe([
      "視唱チェッカーの記録（2026-11-20 時点）",
      "Lv2 直近10回 合格 70%（累計 34 回）",
      "音程: 平均 −14 セント（低め）・ずれの大きさ 平均 21 セント・後半に向かって −9 セント",
      "タイミング: 全体に +60ms 遅れ（中央値）",
      "外しやすい階名: ソ（正答 71%）, ミ（80%）",
      "外しやすい音程: 上行 4度（正答 60%）, 下行 5度（67%）, 上行 長2度（85%）",
      "取り違え: レ→ミ ×3, ミ→ソ ×2, ソ→ラ ×1",
      "直近14日: 11/18 6回 合格 1, 11/19 3回 合格 2",
    ].join("\n"));
  });

  test("マイナスは U+2212、ハイフンは使わない", () => {
    const text = buildCopyText(TAKES, STATE, NOW);
    expect(text).toContain("−" + "14 セント");
    expect(text.split("\n").slice(1).join("\n")).not.toMatch(/-\d/);
  });

  test("記録が無いときは各行「まだ記録がありません」", () => {
    expect(buildCopyText([], defaultState(), NOW)).toBe([
      "視唱チェッカーの記録（2026-11-20 時点）",
      "Lv1 まだ記録がありません",
      "音程: まだ記録がありません",
      "タイミング: まだ記録がありません",
      "外しやすい階名: まだ記録がありません",
      "外しやすい音程: まだ記録がありません",
      "取り違え: まだ記録がありません",
      "直近14日: まだ記録がありません",
    ].join("\n"));
  });

  test("ドリフトが 1 つも無ければ「後半に向かって」を出さない／高めの言い方", () => {
    const t = take("2026-11-20", [note(RA, "g", null), note(DO, "g", 3)], { offset: -45 });
    const lines = buildCopyText([t], { ...defaultState(), recent: [true], totalsByLevel: { "1": { takes: 1, passed: 1 } } }, NOW).split("\n");
    expect(lines[1]).toBe("Lv1 直近1回 合格 100%（累計 1 回）");
    expect(lines[2]).toBe("音程: 平均 +7 セント（高め）・ずれの大きさ 平均 7 セント");
    expect(lines[3]).toBe("タイミング: 全体に −45ms 早め（中央値）");
    expect(lines[7]).toBe("直近14日: 11/20 1回 合格 1");
  });

  test("直近 20 テイクより古いテイクは音程とタイミングに入れない（階名・音程・取り違えは全履歴）", () => {
    const fresh = Array.from({ length: 20 }, () => take("2026-11-20", [note(RA, "g", null)], { offset: 0 }));
    const lines = buildCopyText([...fresh, ...TAKES], STATE, NOW).split("\n");
    expect(lines[2]).toBe("音程: 平均 +7 セント（高め）・ずれの大きさ 平均 7 セント");
    expect(lines[3]).toBe("タイミング: 全体のずれ ±20ms 以内（中央値）");
    expect(lines[4]).toBe("外しやすい階名: ソ（正答 71%）, ミ（80%）");
    expect(lines[6]).toBe("取り違え: レ→ミ ×3, ミ→ソ ×2, ソ→ラ ×1");
  });
});

describe("文の部品", () => {
  test("音程の名前", () => {
    expect(intervalName(0)).toBe("同音");
    expect(intervalName(1)).toBe("上行 短2度");
    expect(intervalName(5)).toBe("上行 4度");
    expect(intervalName(6)).toBe("上行 増4度");
    expect(intervalName(-3)).toBe("下行 短3度");
    expect(intervalName(-7)).toBe("下行 5度");
    expect(intervalName(12)).toBe("上行 オクターブ");
    expect(intervalName(-11)).toBe("下行 長7度");
  });

  test("符号つきの数とずれの言い方", () => {
    expect(signed(12.4)).toBe("+12");
    expect(signed(-12.4)).toBe("−12");
    expect(signed(-0.4)).toBe("±0");
    expect(tendencyWord(-4.4)).toBe("ほぼ正確");
    expect(tendencyWord(-5)).toBe("低め");
    expect(tendencyWord(5)).toBe("高め");
  });

  test("タイミングの言い方", () => {
    expect(timingPhrase(20)).toBe("全体のずれ ±20ms 以内");
    expect(timingPhrase(-20)).toBe("全体のずれ ±20ms 以内");
    expect(timingPhrase(40)).toBe("全体に +40ms 遅れ");
    expect(timingPhrase(-40)).toBe("全体に −40ms 早め");
  });

  test("結果のまとめ 1 行", () => {
    const base: TakeResult = {
      notes: [], count: 8, correct: 7, passed: false, meanDevCents: -12.3, meanAbsDevCents: 18, driftCents: -6,
      offsetMs: 40, offsetScore: 6.5, confusions: [], trace: [],
    };
    expect(summaryLine(base)).toBe("8 音中 7 音 正解・平均 −12 セント（低め）・全体に +40ms 遅れ");
    expect(summaryLine({ ...base, offsetScore: 3.9 })).toBe("8 音中 7 音 正解・平均 −12 セント（低め）・タイミングは判定できず");
    expect(summaryLine({ ...base, correct: 0, meanDevCents: null, offsetScore: 0, offsetMs: 0 })).toBe("8 音中 0 音 正解・平均 —・タイミングは判定できず");
    expect(summaryLine({ ...base, correct: 8, meanDevCents: 3, offsetMs: -10 })).toBe("8 音中 8 音 正解・平均 +3 セント（ほぼ正確）・全体のずれ ±20ms 以内");
  });
});

describe("集計", () => {
  test("直近 14 日は今日を含む 14 行。範囲の外のテイクは数えない", () => {
    const rows = dailyCounts(TAKES, NOW);
    expect(rows).toHaveLength(14);
    expect(rows[0].localDate).toBe("2026-11-07");
    expect(rows[13]).toMatchObject({ localDate: "2026-11-20", label: "11/20", takes: 0, passed: 0 });
    expect(rows.reduce((s, r) => s + r.takes, 0)).toBe(9);
  });

  test("外しやすい音程は 3 つまで・5 回未満と 90% 以上は出さない", () => {
    const rows = weakIntervals(TAKES);
    expect(rows.map((r) => r.label)).toEqual(["上行 4度", "下行 5度", "上行 長2度"]);
    expect(rows[0]).toMatchObject({ total: 5, correct: 3, percent: 60 });
  });

  test("テイクを積む: 直近は 10 件まで、累計はレベルごと", () => {
    let s = defaultState();
    for (let i = 0; i < 12; i++) s = addTakeToState(s, { level: 1, passed: i >= 2 });
    expect(s.recent).toHaveLength(10);
    expect(s.recent.every(Boolean)).toBe(true);
    expect(s.totalsByLevel["1"]).toEqual({ takes: 12, passed: 10 });
  });
});

describe("レベルの提案", () => {
  const ten = (passes: number) => Array.from({ length: 10 }, (_, i) => i < passes);
  const at = (level: number, passes: number, takes = 10): PersistedState =>
    ({ ...defaultState(), level, recent: ten(passes), totalsByLevel: { [String(level)]: { takes, passed: passes } } });

  test("直近 10 回で合格 80% 以上 → 次のレベル", () => {
    expect(levelNudge(at(2, 8), 8)).toMatchObject({ kind: "up", targetLevel: 3, message: "直近 10 回で合格 80%。Lv3 に進めます" });
    expect(levelNudge(at(2, 7), 8)).toBeNull();
    expect(levelNudge(at(8, 10), 8)).toBeNull();
  });

  test("合格 40% 以下 → 前のレベル（Lv2 以上）", () => {
    expect(levelNudge(at(2, 4), 8)).toMatchObject({ kind: "down", targetLevel: 1, message: "少し難しいようです。Lv1 に戻りますか" });
    expect(levelNudge(at(2, 5), 8)).toBeNull();
    expect(levelNudge(at(1, 0), 8)).toBeNull();
  });

  test("10 件たまるまでは出さない", () => {
    expect(levelNudge({ ...at(2, 8), recent: ten(8).slice(0, 9) }, 8)).toBeNull();
  });

  test("閉じたら、さらに 10 テイクたまるまで出さない", () => {
    let s = snoozeNudge(at(2, 9, 10));
    expect(levelNudge(s, 8)).toBeNull();
    for (let i = 0; i < 9; i++) s = addTakeToState(s, { level: 2, passed: true });
    expect(levelNudge(s, 8)).toBeNull();
    s = addTakeToState(s, { level: 2, passed: true });
    expect(levelNudge(s, 8)).toMatchObject({ kind: "up", targetLevel: 3 });
  });

  test("レベルを変えたら直近の合否は空", () => {
    const s = changeLevel(at(2, 9), 3);
    expect(s).toMatchObject({ level: 3, recent: [], nudgeSnoozedAtCount: 0 });
    expect(s.totalsByLevel["2"]).toEqual({ takes: 10, passed: 9 });
  });
});
