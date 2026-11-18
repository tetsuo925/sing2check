// @ts-nocheck — 練習帳の test/logic.test.mjs（型なしの JavaScript）をそのまま移したもの。中身は変えていない。
// ロジックテスト: solfege-core.js（ES モジュール）を import して検証する（63 件）
import assert from "node:assert/strict";
import { test } from "vitest";
import C, * as named from "../src/core/solfege-core.js";

assert.ok(C.genRhythm && C.genMelody, "SolfegeCore exported");
// 名前付き export が default の API と同じものを指す
for (const k of Object.keys(C)) assert.equal(named[k], C[k], "named export " + k);

// 配列は JSON で比べる（元のテストと同じ書き方）
const same = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const N = 300;
const EXERCISES = ["rhythmHear", "rhythmTap", "sight", "earMelody"];
const SIMPLE_LAST = "q", COMP_LAST = "c_q";

function levelCellSet(lv, compound) {
  const L = C.LEVELS[lv];
  return new Set(Object.keys((compound ? L.compound : L.simple) || {}));
}

/* ---------- リズム ---------- */
for (let lv = 1; lv <= 8; lv++) {
  for (const ex of EXERCISES) {
    test(`rhythm Lv${lv} ${ex} x${N}`, () => {
      const rng = C.makeRng(1000 * lv + ex.length);
      for (let i = 0; i < N; i++) {
        const melodic = ex === "sight" || ex === "earMelody";
        const r = C.genRhythm(lv, { exercise: ex, melodic }, rng);
        const meter = r.meter;
        assert.ok(C.LEVELS[lv].meters[meter.str] > 0, "meter in level");
        assert.equal(r.bars.length, C.barsFor(ex, meter), "bar count");
        const set = levelCellSet(lv, meter.compound);
        const barTicks = meter.beats * meter.beatTicks;
        r.bars.forEach((bar, b) => {
          let beat = 0, ticks = 0;
          for (const id of bar) {
            const c = C.CELLS[id];
            assert.ok(set.has(id), `cell ${id} in Lv${lv} set`);
            if (c.span === 2) {
              assert.ok(C.spanAllowedAt(meter, beat), `span2 ${id} at beat ${beat} in ${meter.str}`);
            }
            beat += c.span;
            ticks += c.events.reduce((s, e) => s + e.dur, 0);
            assert.equal(c.events.reduce((s, e) => s + e.dur, 0), c.span * meter.beatTicks, `cell ${id} length`);
          }
          assert.equal(ticks, barTicks, `bar ${b} ticks`);
          assert.equal(beat, meter.beats, `bar ${b} beats`);
        });
        const flat = r.bars.flat();
        assert.ok(!C.REST_CELLS[flat[0]], "does not start with rest");
        const last = flat[flat.length - 1];
        const lastOk = meter.compound ? (last === COMP_LAST || last === "c_h") : (last === SIMPLE_LAST || last === "half");
        assert.ok(lastOk, "last slot rule: " + last);
        if (last === "half" || last === "c_h") assert.ok(set.has(last));
        let run = 0;
        for (const id of flat) { run = C.REST_CELLS[id] ? run + 1 : 0; assert.ok(run <= 2, "max 2 rest cells in a row"); }
        if (r.bars.length > 1) assert.ok(!r.bars.every(b => b.join() === r.bars[0].join()), "not all bars identical");
        assert.equal(r.totalTicks, barTicks * r.bars.length);
        const evSum = r.events.reduce((s, e) => s + e.dur, 0);
        assert.equal(evSum, r.totalTicks, "events cover whole");
        if (lv === 8 && meter.compound && r.bars.length >= 4) assert.ok(flat.includes("c_hemi"), "Lv8 6/8 4 bars has hemiola");
      }
    });
  }
}

/* ---------- 旋律 ---------- */
for (let lv = 1; lv <= 8; lv++) {
  for (const ex of ["sight", "earMelody"]) {
    test(`melody Lv${lv} ${ex} x${N}`, () => {
      const rng = C.makeRng(77 * lv + ex.length);
      const L = C.LEVELS[lv];
      for (let i = 0; i < N; i++) {
        const m = C.genMelody(lv, { exercise: ex }, rng);
        const set = new Set(C.answerSet(lv, m.mode));
        assert.ok(L.modes[m.mode] > 0, "mode in level");
        assert.ok(L.keys.includes(m.doName), "key in level");
        assert.equal(m.notes.length, m.rhythm.events.filter(e => !e.rest).length);
        m.notes.forEach((n, k) => {
          assert.ok(n.midi >= 55 && n.midi <= 79, `midi ${n.midi} in range`);
          assert.ok(set.has(n.solfa), `Lv${lv} ${m.mode} solfa ${n.name} in set`);
          assert.equal((((n.midi - m.doPc - n.solfa) % 12) + 12) % 12, 0, "pitch class matches solfa");
          assert.ok(n.idx >= L.range[0] && n.idx <= L.range[1], "index in range");
          if (k > 0) assert.ok(Math.abs(n.idx - m.notes[k - 1].idx) <= L.maxLeap, `interval within Lv${lv} max (${m.notes[k - 1].idx}->${n.idx})`);
          if (k > 0) assert.ok(Math.abs(n.midi - m.notes[k - 1].midi) <= 12, "≤ octave");
        });
        const idxs = m.notes.map(n => n.idx);
        assert.ok(Math.max(...idxs) - Math.min(...idxs) <= L.width, "width");
        const last = m.notes[m.notes.length - 1];
        assert.equal(last.solfa, C.MODES[m.mode].tonic, "ends on tonic");
        assert.equal((last.midi - m.tonicMidi) % 12, 0, "ends on tonic pitch");
        if (m.notes.length >= 5) assert.ok(new Set(m.notes.map(n => n.midi)).size >= 3, "≥3 pitches");
        for (let k = 3; k < m.notes.length; k++) {
          const same = m.notes[k].midi === m.notes[k - 1].midi && m.notes[k].midi === m.notes[k - 2].midi && m.notes[k].midi === m.notes[k - 3].midi;
          assert.ok(!same, "no 4 same notes in a row");
        }
        if (lv >= 5) {
          for (let k = 1; k < m.notes.length; k++) {
            assert.ok(!(m.notes[k - 1].solfa === 5 && m.notes[k].solfa === 8), "no ファ→ソ♯");
          }
        }
        if (lv === 8 && m.rhythm.meter.compound && m.rhythm.bars.length >= 4) assert.ok(m.rhythm.bars.flat().includes("c_hemi"), "Lv8 hemiola");
        // ABC が生成できる（綴りの内部チェックを通る）
        const abc = m.abc(), abcW = m.abcWithSolfa();
        assert.ok(abc.includes("K:"), "abc");
        assert.ok(abcW.includes("w:"), "abc with solfa");
        assert.ok(m.rhythmAbc().includes("clef=perc"), "rhythm abc");
      }
    });
  }
}

test("Lv5 cadence ソ→ラ uses ソ♯ when not after ファ", () => {
  const rng = C.makeRng(5);
  let seen = 0;
  for (let i = 0; i < 400; i++) {
    const m = C.genMelody(5, { exercise: "sight" }, rng);
    const n = m.notes, k = n.length - 2;
    if (k >= 1 && n[k].idx % 7 === 6 && n[k + 1].idx === n[k].idx + 1 && n[k - 1].solfa !== 5) {
      const iv = Math.abs(n[k].midi + (n[k].alt ? 0 : 1) - n[k - 1].midi);
      if (iv !== 6 && iv !== 8) { assert.equal(n[k].solfa, 8, "cadence ソ♯"); seen++; }
    }
  }
  assert.ok(seen > 5, "cadence case occurred " + seen);
});

test("Lv7 chromatic ornaments appear", () => {
  const rng = C.makeRng(7);
  let chrom = 0;
  for (let i = 0; i < 300; i++) {
    const m = C.genMelody(7, { exercise: "sight" }, rng);
    const dia = C.MODES[m.mode].scale.map(s => (s + C.MODES[m.mode].tonic) % 12);
    if (m.notes.some(n => !dia.includes(n.solfa) && n.solfa !== 8)) chrom++;
  }
  assert.ok(chrom > 60, "chromatic tasks " + chrom);
});

/* ---------- 綴り ---------- */
test("key signatures", () => {
  const ka = C.keyAccidentals("B♭");
  assert.equal(ka[6], -1); assert.equal(ka[2], -1); assert.equal(ka[0], 0);
  const kd = C.keyAccidentals("D");
  assert.equal(kd[3], 1); assert.equal(kd[0], 1); assert.equal(kd[4], 0);
  const ke = C.keyAccidentals("E♭");
  assert.equal(ke[6], -1); assert.equal(ke[2], -1); assert.equal(ke[5], -1);
});
test("spellNote octaves & accidentals", () => {
  const st = {};
  const ka = C.keyAccidentals("F");
  assert.equal(C.spellNote(60, 7, "F", ka, st), "C");      // ソ in F = C4
  assert.equal(C.spellNote(61, 8, "F", ka, st), "^C");     // ソ♯
  assert.equal(C.spellNote(61, 8, "F", ka, st), "C");      // 同じ小節では記号なし
  assert.equal(C.spellNote(60, 7, "F", ka, st), "=C");     // 戻すときはナチュラル
  assert.equal(C.spellNote(63, 10, "F", ka, {}), "_E");    // シ♭ in F = E♭
  assert.equal(C.spellNote(65, 0, "F", ka, {}), "F");      // ド in F
  assert.equal(C.spellNote(70, 5, "F", ka, {}), "B");      // ファ in F = B♭4（調号どおり）
});
test("spellNote octave marks", () => {
  const ka = C.keyAccidentals("C");
  assert.equal(C.spellNote(84, 0, "C", ka, {}), "c'");
  assert.equal(C.spellNote(72, 0, "C", ka, {}), "c");
  assert.equal(C.spellNote(48, 0, "C", ka, {}), "C,");
  assert.equal(C.spellNote(59, 11, "C", ka, {}), "B,");
});

/* ---------- 判定 ---------- */
test("judgeTaps exact", () => {
  const e = [0, 0.5, 1, 1.25, 1.5, 2];
  const r = C.judgeTaps(e, e.slice());
  assert.equal(r.hits, 6); assert.equal(r.extras, 0); assert.equal(r.accuracy, 1);
  assert.ok(Math.abs(r.meanDevMs) < 1e-6); assert.ok(r.sdDevMs < 1e-6); assert.ok(r.passed);
});
test("judgeTaps +50ms", () => {
  const e = [0, 0.5, 1, 1.25, 1.5, 2];
  const r = C.judgeTaps(e, e.map(x => x + 0.05));
  assert.equal(r.hits, 6); assert.ok(Math.abs(r.meanDevMs - 50) < 1e-6); assert.ok(r.sdDevMs < 1e-6);
  assert.ok(r.passed);
  r.perOnset.forEach(p => assert.ok(Math.abs(p.devMs - 50) < 1e-6));
});
test("judgeTaps one missing", () => {
  const e = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5];
  const taps = e.filter((_, i) => i !== 3);
  const r = C.judgeTaps(e, taps);
  assert.equal(r.hits, 9); assert.equal(r.misses, 1); assert.equal(r.extras, 0);
  assert.equal(r.perOnset[3].devMs, null);
  assert.ok(Math.abs(r.accuracy - 0.9) < 1e-9); assert.ok(r.passed);
});
test("judgeTaps one extra", () => {
  const e = [0, 0.5, 1, 1.5, 2];
  const r = C.judgeTaps(e, [0, 0.25, 0.5, 1, 1.5, 2]);
  assert.equal(r.hits, 5); assert.equal(r.extras, 1);
  assert.ok(Math.abs(r.accuracy - 5 / 6) < 1e-9); assert.ok(!r.passed);
});
test("judgeTaps +200ms", () => {
  const e = [0, 0.5, 1, 1.5, 2];
  const r = C.judgeTaps(e, e.map(x => x + 0.2));
  assert.equal(r.hits, 0); assert.equal(r.extras, 5); assert.equal(r.accuracy, 0); assert.ok(!r.passed);
});
test("judgeTaps window shrinks for close onsets", () => {
  // 16 分 @ 120bpm = 0.125s → 窓 = 0.05s
  const e = [0, 0.125, 0.25];
  const r = C.judgeTaps(e, [0.06, 0.125, 0.25]);
  assert.equal(r.hits, 2); assert.equal(r.extras, 1);
});

test("judgeRhythm", () => {
  const truth = C.expandBars([["q", "ee"], ["ess", "q"]], 12).events;
  const ok = C.judgeRhythm(truth, [["q", "ee"], ["ess", "q"]]);
  assert.ok(ok.correct); assert.equal(ok.slots.length, 4);
  const ng = C.judgeRhythm(truth, [["q", "ee"], ["sse", "q"]]);
  assert.ok(!ng.correct);
  same(ng.slots.map(s => s.ok), [true, true, false, true]);
  same(ng.missedCells, ["ess"]);
  // span 2
  const t2 = C.expandBars([["half"], ["ee", "q"]], 12).events;
  const r2 = C.judgeRhythm(t2, [["q", "q"], ["ee", "q"]]);
  same(r2.slots.map(s => s.ok), [false, false, true, true]);
  same(r2.missedCells, ["half"]);
  // 6/8
  const t3 = C.expandBars([["c_qe", "c_eee"], ["c_hemi"], ["c_eq", "c_q"]], 18).events;
  assert.ok(C.judgeRhythm(t3, [["c_qe", "c_eee"], ["c_hemi"], ["c_eq", "c_q"]]).correct);
  const r3 = C.judgeRhythm(t3, [["c_qe", "c_eee"], ["c_h"], ["c_eq", "c_q"]]);
  same(r3.slots.map(s => s.ok), [true, true, false, false, true, true]);
  // 休符と音の区別
  const t4 = C.expandBars([["q", "r"]], 12).events;
  assert.ok(!C.judgeRhythm(t4, [["q", "q"]]).correct);
});

test("judgeMelody", () => {
  const notes = [{ solfa: 9 }, { solfa: 0 }, { solfa: 4 }, { solfa: 9 }];
  const r = C.judgeMelody(notes, [9, 0, 7, 21]);
  assert.ok(!r.correct);
  same(r.per, [true, true, false, true]);
  same(r.confusions, ["ミ>ソ"]);
  assert.ok(C.judgeMelody(notes, [9, 12, 4, 9]).correct, "octave ignored");
});

test("earNotes in set, no triple repeats", () => {
  const rng = C.makeRng(3);
  for (let lv = 1; lv <= 8; lv++) {
    for (let i = 0; i < N; i++) {
      const key = C.earKey(lv, rng);
      const set = C.answerSet(lv, key.mode);
      const hist = [];
      for (let q = 0; q < 5; q++) {
        const ns = C.genEarNotes(lv, key, 3, hist, rng);
        ns.forEach(n => {
          assert.ok(set.includes(n.solfa));
          assert.ok(n.midi >= 55 && n.midi <= 79, "ear midi range " + n.midi);
          assert.equal(((n.midi - key.doPc - n.solfa) % 12 + 12) % 12, 0);
          hist.push(n.solfa);
        });
      }
      for (let k = 2; k < hist.length; k++) assert.ok(!(hist[k] === hist[k - 1] && hist[k] === hist[k - 2]), "no triple");
    }
  }
});

test("determinism with same seed", () => {
  const a = C.genMelody(6, { exercise: "sight" }, C.makeRng(42)).abc();
  const b = C.genMelody(6, { exercise: "sight" }, C.makeRng(42)).abc();
  assert.equal(a, b);
});
