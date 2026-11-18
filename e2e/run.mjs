// デスクトップ Chrome の E2E（ハンドオフ文書 §17.2）。合成した歌声の WAV を偽のマイク入力にして、
// 「歌う」→ 判定 → 結果 → 記録 までを実際のブラウザで通す。
//
//   npm run build && npm run e2e
//
// 手元の Google Chrome をヘッドレスで使う（playwright-core の channel: "chrome"。別のブラウザは E2E_CHANNEL で指定）。
// 音は出ない（--mute-audio）。1 条件につき 20 秒ほどかかる（テイクを実時間で 1 回行うため）。
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { makeExercise } from "../src/core/exercise.ts";
import { MIC_SETTLE_SEC, scheduleTake } from "../src/judge/take.ts";
import { renderTake, toWav16 } from "../test/helpers/synth.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4183;
const LEVEL = 3, SEED = 48213;
const exercise = makeExercise(LEVEL, SEED);
const bpm = exercise.defaultTempo;
// 「歌う」を押してから課題の 1 拍目までの時間（主和音 → 1 拍 → カウント）。
// 偽のマイクは、ストリームを開いた時点から WAV の頭を流し始める。マイクが開いてから予約までの時間（数十 ms）は
// 分からないので、WAV の 1 拍目を少し遅らせておく。ずれは判定の Δ 合わせ（−150〜+400ms）が吸収する。
const LEAD_SEC = scheduleTake(0, exercise.melody, bpm, { chord: true }).t0 + MIC_SETTLE_SEC + 0.05;

const SCENARIOS = [
  { name: "正確に歌う → 合格", singer: {}, expect: { passed: true, wrong: [], silent: [] } },
  { name: "6 番目の音を 2 半音上で歌う → その音だけ ✕", singer: { substitute: { index: 5, semitones: 2 } }, expect: { passed: false, wrong: [5], silent: [] } },
  { name: "9 番目の音を歌わない → その音だけ ー", singer: { unsung: [8] }, expect: { passed: false, wrong: [], silent: [8] } },
];

function check(cond, message) {
  if (!cond) throw new Error(message);
}

function startPreview() {
  const child = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let out = "";
    const onData = (d) => {
      out += d;
      if (out.includes(`:${PORT}`)) resolve(child);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite preview が終了しました（${code}）。先に npm run build を実行してください。\n${out}`)));
    setTimeout(() => reject(new Error("vite preview が起動しません\n" + out)), 15000);
  });
}

async function runScenario(scenario, wavPath, index) {
  const browser = await chromium.launch({
    channel: process.env.E2E_CHANNEL ?? "chrome",
    headless: !process.env.E2E_HEADED,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wavPath}`, "--mute-audio"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    await page.goto(`http://localhost:${PORT}/#e2e-Lv${LEVEL}-${SEED}`);
    await page.waitForSelector("#button-sing");
    check((await page.textContent("#exercise-id")) === exercise.id, "課題番号が違う");
    check((await page.textContent("#tempo-label")) === `${exercise.melody.rhythm.meter.str} ♩=${bpm}`, "テンポの表示が違う");
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "横スクロールが出ている");

    await page.click("#button-sing");
    await page.waitForSelector(".beat-numbers", { timeout: 10000 }); // カウントが始まる
    await page.waitForSelector(".result", { timeout: 40000 });

    const got = await page.evaluate(() => {
      const el = document.querySelector(".result");
      const groups = Array.from(document.querySelectorAll(".score .judge"));
      const index = (cls) => groups.map((g, i) => (g.classList.contains(cls) ? i : -1)).filter((i) => i >= 0);
      return {
        passed: el.dataset.passed === "true", correct: +el.dataset.correct, count: +el.dataset.count, offsetMs: +el.dataset.offsetMs,
        wrong: index("judge-wrong"), silent: index("judge-silent"), notes: groups.length,
        verdict: document.querySelector(".verdict").textContent, summary: document.querySelector(".summary").textContent,
        notices: Array.from(document.querySelectorAll(".notices li")).map((li) => li.textContent),
        chart: (() => { const c = document.querySelector(".pitch-chart"); return c ? c.width * c.height : 0; })(),
      };
    });
    console.log(`  ${got.verdict.trim()}｜${got.summary}${got.notices.length ? "｜" + got.notices.join(" ") : ""}`);
    check(got.count === exercise.melody.notes.length && got.notes === got.count, `音の数 ${got.notes}/${got.count}`);
    check(got.passed === scenario.expect.passed, `合否が違う（${got.verdict}）`);
    check(JSON.stringify(got.wrong) === JSON.stringify(scenario.expect.wrong), `✕ の音 [${got.wrong}]、期待 [${scenario.expect.wrong}]`);
    check(JSON.stringify(got.silent) === JSON.stringify(scenario.expect.silent), `ー の音 [${got.silent}]、期待 [${scenario.expect.silent}]`);
    check(got.correct === got.count - scenario.expect.wrong.length - scenario.expect.silent.length, `正解数 ${got.correct}`);
    check(got.verdict.includes(scenario.expect.passed ? "合格" : "もう一度"), "合否の文言");
    check(got.notices.length === 0, `注意が出ている: ${got.notices.join(" ")}`);
    check(got.chart > 0, "ピッチ軌跡の図が無い");

    // 自分の歌を聴く・正解を聴く（押すと「■ 停止」になり、もう一度押すと戻る）
    for (const id of ["#button-play-mine", "#button-play-answer"]) {
      const label = await page.textContent(id);
      await page.click(id);
      check((await page.textContent(id)) === "■ 停止", `${label}: 再生が始まらない`);
      await page.click(id);
      check((await page.textContent(id)) === label, `${label}: 止まらない`);
    }

    // 記録: localStorage に残り、再読み込みしても「記録」シートに出る。コピー文は 8 行
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("sing2check.v1.takes") ?? "[]"));
    check(stored.length === 1 && stored[0].exerciseId === exercise.id && stored[0].passed === scenario.expect.passed, "テイクが記録されていない");
    check(stored[0].notes.length === got.count && stored[0].hintsUsed.tonicChord === false, "記録の中身");
    await page.reload();
    await page.waitForSelector("#button-sing");
    await page.click("#button-open-records");
    await page.waitForSelector("#sheet-records[open]");
    check((await page.textContent("#sheet-records .record-big")).includes("累計 1 回"), "記録シートに累計が出ない");
    await page.click("#button-copy");
    await page.waitForFunction(() => document.querySelector("#sheet-records .sheet-status")?.textContent.includes("コピーしました"));
    const copied = (await page.evaluate(() => navigator.clipboard.readText())).split("\n");
    check(copied.length === 8 && copied[0].startsWith("視唱チェッカーの記録（") && copied[1].startsWith(`Lv${LEVEL} 直近1回 合格 ${scenario.expect.passed ? 100 : 0}%（累計 1 回）`), `コピー文: ${copied.join(" / ")}`);
    if (index === 0) console.log(copied.map((l) => "    " + l).join("\n"));

    check(errors.length === 0, `ページのエラー: ${errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
}

const dir = mkdtempSync(join(tmpdir(), "sing2check-e2e-"));
const preview = await startPreview();
let failed = 0;
try {
  for (const [i, scenario] of SCENARIOS.entries()) {
    const audio = renderTake(exercise.melody, { sampleRate: 48000, bpm, seed: SEED, prerollSec: LEAD_SEC, tailSec: 2, noiseSnrDb: 40, ...scenario.singer });
    const wav = join(dir, `take-${i}.wav`);
    writeFileSync(wav, toWav16(audio.samples, 48000));
    console.log(`${exercise.id} ${scenario.name}`);
    try {
      await runScenario(scenario, wav, i);
      console.log("  PASS");
    } catch (e) {
      failed++;
      console.log(`  FAIL ${e.message}`);
    }
  }
} finally {
  preview.kill();
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\ne2e: ${SCENARIOS.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
