// 合成の歌声 WAV を作る（Chrome の偽マイク入力で E2E を回す用、任意）。
// 例: node tools/make-wav.ts --level 3 --seed 48213 --lead 2.5 --out take.wav
//   --lead   課題の 1 拍目より前に置く無音の秒数（主和音とカウントの長さに合わせる）
//   --bpm    テンポ（省略時はレベルの既定）
//   --cents  全音に足すセント  --lag 遅れ ms  --subst 番号:半音  --unsung 番号
import { writeFileSync } from "node:fs";
import Core from "../src/core/solfege-core.js";
import { renderTake, toWav16 } from "../test/helpers/synth.ts";

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const level = +(opt("level", "1") as string), seed = +(opt("seed", "1") as string);
const m = Core.genMelody(level, { exercise: "sight" }, Core.makeRng(seed));
const bpm = +(opt("bpm") ?? Core.levelTempo(level, m.rhythm.meter));
const sub = opt("subst");
const r = renderTake(m, {
  sampleRate: 48000, bpm, seed,
  prerollSec: +(opt("lead", "2") as string), tailSec: 2,
  centsOffset: +(opt("cents", "0") as string), lagMs: +(opt("lag", "0") as string),
  substitute: sub ? { index: +sub.split(":")[0], semitones: +sub.split(":")[1] } : null,
  unsung: opt("unsung") ? [+(opt("unsung") as string)] : [],
  noiseSnrDb: 40,
});
const out = opt("out", `Lv${level}-${seed}.wav`) as string;
writeFileSync(out, toWav16(r.samples, 48000));
console.log(`${out}: Lv${level}-${seed} ${m.rhythm.meter.str} bpm ${bpm} ${m.notes.length} 音 ${(r.samples.length / 48000).toFixed(2)} 秒（1 拍目 = ${(-r.startTime).toFixed(2)} 秒）`);
