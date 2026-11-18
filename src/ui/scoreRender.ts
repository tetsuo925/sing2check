// abcjs での五線譜の描画・判定の色分け・拍の線の位置（ハンドオフ文書 §11.1）。React に依らない。
import abcjs from "abcjs";
import Core from "../core/solfege-core.js";
import type { Melody } from "../core/solfege-core.js";
import type { NoteResult, NoteStatus, TakeResult } from "../judge/judge.ts";
import { signed } from "../judge/stats.ts";

/** 判定の記号（色だけに頼らない） */
export const STATUS_MARK: Record<NoteStatus, string> = { good: "◯", ok: "△", wrong: "✕", silent: "ー" };
export const STATUS_LABEL: Record<NoteStatus, string> = { good: "良い", ok: "少しずれ", wrong: "違う音", silent: "歌えていない" };

/** 各音の下の 2 行目: `◯ −8`、`△ +32`、`✕ ソ`（歌った階名）、`ー` */
export function judgeWord(n: NoteResult): string {
  if (n.status === "silent") return STATUS_MARK.silent;
  if (n.status === "wrong") return `${STATUS_MARK.wrong} ${n.sungSolfa === null ? "" : Core.NAMES[n.sungSolfa]}`.trim();
  return `${STATUS_MARK[n.status]} ${signed(n.devCents ?? 0)}`;
}

/** 歌詞の書体。2 行のときは 12px、詰めた 3 行のときは 11px */
const vocalFont = (px: number) => `%%vocalfont "Zen Kaku Gothic New" ${px}\n`;

/** 判定の表示のしかた。wide = 各音の下に 2 行（階名 / `◯ −8`）、compact = 3 行（階名 / `◯` / `−8`） */
export type ScoreLayout = "wide" | "compact";

/**
 * 詰めた表示の 3 行目: ずれ（`−8`）か、歌った階名（`ソ`）。歌えていない音は空白だけの語にする
 * （ABC の `*` は使わない。abcjs 6.7.2 は休符の直後の `*` を休符に当ててしまい、以降が 1 音ずれる）。
 */
function detailWord(n: NoteResult): string {
  if (n.status === "silent") return "~";
  if (n.status === "wrong") return n.sungSolfa === null ? "~" : `${Core.NAMES[n.sungSolfa]}~`;
  return `${signed(n.devCents ?? 0)}~`;
}

/**
 * 描画する ABC。結果があるときは、階名の歌詞行（w:）の次に、判定の w: 行を差し込む。
 * - wide: 記号とずれを 1 行に（`◯ −8`）。語の中の空白は ~ でつなぐ
 * - compact: 記号の行とずれの行に分ける（音符が詰まった段で、文字の幅のために譜面全体が縮むのを防ぐ）
 * 語の前後にも ~（改行しない空白）を置く。abcjs は歌詞の幅ちょうどに音符を詰めるので、隣の語とくっつくのを防ぐ。
 * マイナスは U+2212（ABC の歌詞では - が音節の区切りになるため）。
 */
export function scoreAbc(melody: Melody, result: TakeResult | null, layout: ScoreLayout = "wide"): string {
  if (!result) return melody.abc();
  let next = 0;
  const lines = melody.abcWithSolfa().replace("X:1\n", "X:1\n" + vocalFont(layout === "wide" ? 12 : 11)).split("\n");
  const out: string[] = [];
  for (const line of lines) {
    out.push(line);
    if (!line.startsWith("w:")) continue;
    const count = line.slice(2).trim().split(/\s+/).filter(Boolean).length;
    const notes = result.notes.slice(next, next + count);
    next += count;
    if (layout === "wide") {
      out.push("w: " + notes.map((n) => `~${judgeWord(n).replace(/ /g, "~")}~`).join(" "));
    } else {
      out.push("w: " + notes.map((n) => STATUS_MARK[n.status]).join(" "));
      out.push("w: " + notes.map(detailWord).join(" "));
    }
  }
  return out.join("\n");
}

/** 音符・休符 1 つの位置（拍の線用） */
export interface EventMark { tick: number; x: number; line: number }
export interface StaffLine { left: number; right: number; top: number; bottom: number }

export interface RenderedScore {
  /** 鳴る音ごとの SVG 要素（melody.notes と同じ順） */
  noteElements: Element[][];
  /** 音符と休符の位置（melody.rhythm.events と同じ順）。対応が取れなかったら空 */
  marks: EventMark[];
  /** 段ごとの五線の範囲（SVG の座標） */
  staffLines: StaffLine[];
  svg: SVGSVGElement | null;
  /** 判定の表示のしかた（結果が無いときは "wide"） */
  layout: ScoreLayout;
}

interface AbcVoiceElement {
  el_type: string;
  rest?: unknown;
  abselem?: { x: number; w: number; elemset?: Element[] };
}
interface AbcLine { staff?: { voices: AbcVoiceElement[][] }[] }

function staffGeometry(container: Element, line: number): StaffLine | null {
  const g = container.querySelector(`.abcjs-staff.abcjs-l${line}`);
  if (!g) return null;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const p of Array.from(g.querySelectorAll("path"))) {
    const m = /^M\s*([-\d.]+)[ ,]+([-\d.]+)\s*L\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(p.getAttribute("d") ?? "");
    if (!m) continue;
    left = Math.min(left, +m[1]); right = Math.max(right, +m[3]);
    top = Math.min(top, +m[2]); bottom = Math.max(bottom, +m[4]);
  }
  return Number.isFinite(left) && Number.isFinite(top) ? { left, right, top, bottom } : null;
}

const PADDING_X = 4;
/** 五線の幅に対して、これを超えてはみ出したら描き直す */
const FIT_TOLERANCE = 1.02;
/** 2 行の表示でこれを超えてはみ出すなら、詰めた 3 行の表示に切り替える */
const COMPACT_AT = 1.1;

function draw(container: HTMLElement, abc: string, staffWidth: number, hasLyrics: boolean): AbcLine[] {
  const tunes = abcjs.renderAbc(container, abc, {
    add_classes: true,
    responsive: "resize",
    staffwidth: staffWidth,
    paddingtop: 8,
    paddingbottom: hasLyrics ? 10 : 4,
    paddingleft: PADDING_X,
    paddingright: PADDING_X,
    selectTypes: false,
  });
  return (tunes[0] as unknown as { lines?: AbcLine[] } | undefined)?.lines ?? [];
}

/** 描いた譜面のいちばん長い段の幅（SVG の viewBox から）。測れないとき（jsdom）は null */
function drawnStaffWidth(container: HTMLElement): number | null {
  const viewBox = container.querySelector("svg")?.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  const width = viewBox && viewBox.length === 4 ? viewBox[2] - 2 * PADDING_X : NaN;
  return Number.isFinite(width) && width > 0 ? width : null;
}

/**
 * 五線譜を描く。結果があれば符頭を判定で色分けし（class="judge-good" など）、各音の下に階名と判定を出す。
 * staffWidth は五線の幅（px）。音符や文字が入りきらない段があると abcjs はその段だけ長くするので、
 * 実際の幅を測って描き直す（判定の文字が原因なら詰めた表示に替え、それでも長ければ全段をその幅にそろえる。
 * 表示は全体が縮んで収まる）。forceLayout はテスト用。
 */
export function renderScore(container: HTMLElement, melody: Melody, result: TakeResult | null, staffWidth: number, forceLayout?: ScoreLayout): RenderedScore {
  let layout: ScoreLayout = forceLayout ?? "wide";
  let lines = draw(container, scoreAbc(melody, result, layout), staffWidth, result !== null);
  let drawn = drawnStaffWidth(container);
  if (result && !forceLayout && drawn !== null && drawn > staffWidth * COMPACT_AT) {
    layout = "compact";
    lines = draw(container, scoreAbc(melody, result, layout), staffWidth, true);
    drawn = drawnStaffWidth(container);
  }
  if (drawn !== null && drawn > staffWidth * FIT_TOLERANCE) {
    lines = draw(container, scoreAbc(melody, result, layout), Math.ceil(drawn), result !== null);
  }

  const noteElements: Element[][] = [];
  const marks: EventMark[] = [];
  const staffLines: StaffLine[] = [];
  const events = melody.rhythm.events;
  let eventIndex = 0, lineIndex = 0;
  for (const line of lines) {
    const voice = line.staff?.[0]?.voices?.[0];
    if (!voice) continue;
    const geom = staffGeometry(container, lineIndex);
    if (geom) staffLines[lineIndex] = geom;
    for (const el of voice) {
      if (el.el_type !== "note") continue;
      const abs = el.abselem;
      const ev = events[eventIndex++];
      if (abs && ev) marks.push({ tick: ev.startTick, x: abs.x + abs.w / 2, line: lineIndex });
      if (el.rest) continue;
      noteElements.push(abs?.elemset ?? []);
    }
    lineIndex++;
  }
  if (result) {
    noteElements.forEach((els, i) => {
      const status = result.notes[i]?.status;
      if (status) for (const e of els) e.classList.add("judge", `judge-${status}`);
    });
  }
  const consistent = eventIndex === events.length && marks.length === events.length;
  return { noteElements, marks: consistent ? marks : [], staffLines, svg: container.querySelector("svg"), layout };
}

/** 課題の tick 位置に対応する、譜面の上の縦線の位置。範囲の外・対応が取れないときは null */
export function playheadPosition(r: RenderedScore, totalTicks: number, tick: number): { x: number; top: number; bottom: number; line: number } | null {
  if (!r.marks.length || tick < 0 || tick > totalTicks) return null;
  let i = 0;
  while (i + 1 < r.marks.length && r.marks[i + 1].tick <= tick) i++;
  const a = r.marks[i], b = r.marks[i + 1];
  const staff = r.staffLines[a.line];
  if (!staff) return null;
  const endTick = b ? b.tick : totalTicks;
  const endX = b && b.line === a.line ? b.x : staff.right;
  const f = endTick > a.tick ? Math.min(1, Math.max(0, (tick - a.tick) / (endTick - a.tick))) : 0;
  return { x: a.x + (endX - a.x) * f, top: staff.top - 6, bottom: staff.bottom + 6, line: a.line };
}
