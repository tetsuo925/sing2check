// @vitest-environment jsdom
// 五線譜の描画（abcjs 6.7.2）: 符頭のたどり方が音符の順に一致すること（ハンドオフ文書 §11.1、§17.1）
import { describe, test, expect } from "vitest";
import { makeExercise } from "../src/core/exercise.ts";
import Core from "../src/core/solfege-core.js";
import type { NoteResult, NoteStatus, TakeResult } from "../src/judge/judge.ts";
import { judgeWord, playheadPosition, renderScore, scoreAbc } from "../src/ui/scoreRender.ts";

const STATUSES: NoteStatus[] = ["good", "ok", "wrong", "silent"];

/** 判定のにせもの: 音の番号で good / ok / wrong / silent を順に割り当てる */
function fakeResult(notes: { midi: number; solfa: number }[]): TakeResult {
  const results: NoteResult[] = notes.map((n, i) => {
    const status = STATUSES[i % 4];
    return {
      index: i, midi: n.midi, solfa: n.solfa, status,
      devCents: status === "good" ? -8 : status === "ok" ? 32 : status === "wrong" ? 212 : null,
      coverage: 1, windowStart: 0, windowEnd: 0,
      sungSolfa: status === "wrong" ? (n.solfa + 2) % 12 : null,
      intervalFromPrevious: i ? n.midi - notes[i - 1].midi : null,
    };
  });
  return {
    notes: results, count: notes.length, correct: 0, passed: false, meanDevCents: null, meanAbsDevCents: null, driftCents: null,
    offsetMs: 0, offsetScore: 0, confusions: [], trace: [],
  };
}

function container(): HTMLElement {
  document.body.innerHTML = "";
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("2 行目の語", () => {
  const base = { index: 0, midi: 69, solfa: 9, coverage: 1, windowStart: 0, windowEnd: 0, intervalFromPrevious: null };
  test("記号とずれ・歌った階名", () => {
    expect(judgeWord({ ...base, status: "good", devCents: -8.4, sungSolfa: null })).toBe("◯ −8");
    expect(judgeWord({ ...base, status: "ok", devCents: 32, sungSolfa: null })).toBe("△ +32");
    expect(judgeWord({ ...base, status: "good", devCents: 0.2, sungSolfa: null })).toBe("◯ ±0");
    expect(judgeWord({ ...base, status: "wrong", devCents: -212, sungSolfa: 7 })).toBe("✕ ソ");
    expect(judgeWord({ ...base, status: "silent", devCents: null, sungSolfa: null })).toBe("ー");
  });

  test("ABC の歌詞行: 階名の行の次に 2 行目を差し込む。語の中と前後の空白は ~、マイナスは U+2212", () => {
    const m = makeExercise(1, 48213).melody;
    const abc = scoreAbc(m, fakeResult(m.notes));
    const w = abc.split("\n").filter((l) => l.startsWith("w:"));
    expect(w).toEqual([
      "w: ミ ソ ラ ソ ミ レ ド",
      "w: ~◯~−8~ ~△~+32~ ~✕~シ~ ~ー~ ~◯~−8~ ~△~+32~ ~✕~レ~",
      "w: ド ラ ド ラ ラ ラ",
      "w: ~ー~ ~◯~−8~ ~△~+32~ ~✕~シ~ ~ー~ ~◯~−8~",
    ]);
    expect(abc).not.toMatch(/w:.*-/);
    expect(scoreAbc(m, null)).toBe(m.abc());
  });

  test("詰めた表示: 記号の行とずれの行に分ける。歌えていない音のずれは空白だけの語（* は使わない）", () => {
    const m = makeExercise(1, 48213).melody;
    const w = scoreAbc(m, fakeResult(m.notes), "compact").split("\n").filter((l) => l.startsWith("w:"));
    expect(w).toEqual([
      "w: ミ ソ ラ ソ ミ レ ド",
      "w: ◯ △ ✕ ー ◯ △ ✕",
      "w: −8~ +32~ シ~ ~ −8~ +32~ レ~",
      "w: ド ラ ド ラ ラ ラ",
      "w: ー ◯ △ ✕ ー ◯",
      "w: ~ −8~ +32~ シ~ ~ −8~",
    ]);
  });
});

describe("abcjs の描画", () => {
  for (let lv = 1; lv <= Core.MAX_LEVEL; lv++) {
    test(`Lv${lv} × 30 課題: たどった符頭の数 = 音の数、音符と休符の数 = リズムのイベント数、色と 2 行の歌詞が付く`, () => {
      for (let i = 0; i < 30; i++) {
        const ex = makeExercise(lv, 10000 * lv + i);
        const m = ex.melody;
        const el = container();

        // 準備・録音中（階名なし）
        const plain = renderScore(el, m, null, 328);
        expect(plain.noteElements, ex.id).toHaveLength(m.notes.length);
        expect(plain.marks, ex.id).toHaveLength(m.rhythm.events.length);
        expect(el.querySelectorAll(".abcjs-lyric"), ex.id).toHaveLength(0);
        expect(plain.noteElements.every((els) => els.length > 0), ex.id).toBe(true);

        // 結果（色分け + 2 行）
        const result = fakeResult(m.notes);
        const judged = renderScore(el, m, result, 328);
        expect(judged.noteElements, ex.id).toHaveLength(m.notes.length);
        judged.noteElements.forEach((els, k) => {
          const status = result.notes[k].status;
          for (const e of els) expect(e.classList.contains(`judge-${status}`), `${ex.id} #${k}`).toBe(true);
          const lyric = els[0].querySelector(".abcjs-lyric");
          // abcjs は歌詞の末尾に空の tspan を 1 つ足し、~ を改行しない空白（U+00A0）にする
          const rows = Array.from(lyric?.querySelectorAll("tspan") ?? []).map((t) => (t.textContent ?? "").replace(/\u00a0/g, " ").trim()).filter((t) => t !== "");
          expect(rows, `${ex.id} #${k}`).toEqual([m.notes[k].name, judgeWord(result.notes[k])]);
        });
        expect(el.querySelectorAll(".judge")).toHaveLength(m.notes.length);

        // 詰めた表示（3 行）でも同じ対応が取れる
        const compact = renderScore(el, m, result, 328, "compact");
        expect(compact.layout).toBe("compact");
        expect(compact.noteElements, ex.id).toHaveLength(m.notes.length);
        expect(compact.marks, ex.id).toHaveLength(m.rhythm.events.length);
        compact.noteElements.forEach((els, k) => {
          const r = result.notes[k];
          const rows = Array.from(els[0].querySelectorAll(".abcjs-lyric tspan")).map((t) => (t.textContent ?? "").replace(/\u00a0/g, " ").trim()).filter((t) => t !== "");
          const detail = r.status === "silent" ? [] : [r.status === "wrong" ? Core.NAMES[r.sungSolfa as number] : judgeWord(r).split(" ")[1]];
          expect(rows, `${ex.id} #${k}`).toEqual([m.notes[k].name, judgeWord(r).split(" ")[0], ...detail]);
        });

        // 拍の線: 段ごとの五線が取れ、位置は左から右へ進む
        expect(judged.staffLines.length, ex.id).toBeGreaterThan(0);
        const total = m.rhythm.totalTicks;
        const first = playheadPosition(judged, total, 0);
        expect(first, ex.id).not.toBeNull();
        expect(playheadPosition(judged, total, -1)).toBeNull();
        expect(playheadPosition(judged, total, total + 1)).toBeNull();
        let prev = { line: 0, x: -Infinity };
        for (const mark of judged.marks) {
          if (mark.line === prev.line) expect(mark.x, ex.id).toBeGreaterThan(prev.x);
          else expect(mark.line, ex.id).toBe(prev.line + 1);
          prev = mark;
        }
      }
    });
  }
});
