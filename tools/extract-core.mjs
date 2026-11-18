// index.html の <script id="core"> を ES モジュール solfege-core.js に書き出す。
// 使い方:
//   node tools/extract-core.mjs <index.html> <出力 solfege-core.js>          … 書き出す
//   node tools/extract-core.mjs <index.html> <solfege-core.js> --check       … 一致を確認するだけ（不一致なら exit 1）
// コアの中身（IIFE）は変えない。変えるのは前後の包みと IIFE を呼ぶ最後の 1 行だけ。
import { readFileSync, writeFileSync } from "node:fs";

const [src, out, flag] = process.argv.slice(2);
if (!src || !out) {
  console.error("usage: node tools/extract-core.mjs <index.html> <solfege-core.js> [--check]");
  process.exit(2);
}
const html = readFileSync(src, "utf8");
const m = html.match(/<script id="core">([\s\S]*?)<\/script>/);
if (!m) throw new Error("<script id=\"core\"> not found in " + src);
const body = m[1].replace(/^\n/, "").replace(/\s+$/, "") + "\n";

const NAMES = [
  "TPQ", "NAMES", "SPELL", "LETTERS", "MODES", "KEYS", "CELLS", "CELL_LIST", "REST_CELLS", "LEVELS", "MAX_LEVEL",
  "makeRng", "meterInfo", "barsFor", "levelTempo", "cellsFor", "spanAllowedAt", "expandBars", "genRhythm", "genMelody",
  "pickKey", "earKey", "genEarNotes", "answerSet", "contextNotes", "keyAccidentals", "barsPerLine", "spellNote",
  "melodyAbc", "rhythmAbc", "cellAbc", "judgeRhythm", "judgeMelody", "judgeTaps", "ticksToSec", "scaleRel"
];

const text =
`// solfege-core.js — ソルフェージュ練習帳の課題生成コア（ES モジュール版）
// 出どころ: ソルフェージュ練習帳 index.html の <script id="core"> ブロック。
// tools/extract-core.mjs が自動で書き出したファイル。手で編集しないこと。
// 中身（下の IIFE）は index.html と同一。違うのは前後の包みと、IIFE を呼ぶ最後の 1 行（引数を __root にした）だけ。
// 確認: node tools/extract-core.mjs <index.html> solfege-core.js --check

const __root = {};

// ---- ここから index.html の <script id="core"> と同一（最後の 1 行のみ引数を差し替え） ----
${body.replace("})(typeof window !== \"undefined\" ? window : globalThis);", "})(__root);")}// ---- ここまで ----

const SolfegeCore = __root.SolfegeCore;
export default SolfegeCore;
export const {
  ${NAMES.join(", ")}
} = SolfegeCore;
`;

// IIFE の呼び出し部分（最後の 1 行）以外は同一であることを確かめる
const callOrig = "})(typeof window !== \"undefined\" ? window : globalThis);";
if (!body.includes(callOrig)) throw new Error("IIFE call line not found; core block format changed");

if (flag === "--check") {
  const cur = readFileSync(out, "utf8");
  if (cur !== text) { console.error("MISMATCH: " + out + " is not the extraction of " + src); process.exit(1); }
  console.log("OK: " + out + " matches " + src);
} else {
  writeFileSync(out, text);
  console.log("wrote " + out + " (" + text.length + " bytes)");
}
