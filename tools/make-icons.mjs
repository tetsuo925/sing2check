// public/icon.svg から PNG のアイコン（192 / 512 / apple-touch-icon 180）を作る。
// 実行: node tools/make-icons.mjs （手元の Google Chrome を使う。アイコンを変えたときだけ）
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const svg = readFileSync(join(pub, "icon.svg"), "utf8");
const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: join(pub, name) });
  await page.close();
  console.log(name);
}
await browser.close();
