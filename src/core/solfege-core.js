// solfege-core.js — ソルフェージュ練習帳の課題生成コア（ES モジュール版）
// 出どころ: ソルフェージュ練習帳 index.html の <script id="core"> ブロック。
// tools/extract-core.mjs が自動で書き出したファイル。手で編集しないこと。
// 中身（下の IIFE）は index.html と同一。違うのは前後の包みと、IIFE を呼ぶ最後の 1 行（引数を __root にした）だけ。
// 確認: node tools/extract-core.mjs <index.html> solfege-core.js --check

const __root = {};

// ---- ここから index.html の <script id="core"> と同一（最後の 1 行のみ引数を差し替え） ----
(function (root) {
  "use strict";

  /* ---------- 基本の表 ---------- */
  var TPQ = 12; // 1 四分音符 = 12 tick
  var NAMES = ["ド", "ド♯", "レ", "レ♯", "ミ", "ファ", "ファ♯", "ソ", "ソ♯", "ラ", "シ♭", "シ"];
  var SPELL = { 0: [0, 0], 1: [0, 1], 2: [1, 0], 3: [1, 1], 4: [2, 0], 5: [3, 0], 6: [3, 1], 7: [4, 0], 8: [4, 1], 9: [5, 0], 10: [6, -1], 11: [6, 0] };
  var LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
  var LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  var MAJOR = [0, 2, 4, 5, 7, 9, 11];

  // tonic: 主音の階名（ドからの半音数）, fifth/third: 主和音の 5 度・3 度の音階インデックス
  var MODES = {
    laPenta: { tonic: 9, scale: [0, 3, 5, 7, 10], fifth: 3, third: 1, chord: [0, 1, 3] },
    doPenta: { tonic: 0, scale: [0, 2, 4, 7, 9], fifth: 3, third: 2, chord: [0, 2, 3] },
    major: { tonic: 0, scale: [0, 2, 4, 5, 7, 9, 11], fifth: 4, third: 2, chord: [0, 2, 4] },
    minor: { tonic: 9, scale: [0, 2, 3, 5, 7, 8, 10], fifth: 4, third: 2, chord: [0, 2, 4] }
  };

  var KEYS = {
    "C": { name: "C", abc: "C", pc: 0, letter: 0 },
    "F": { name: "F", abc: "F", pc: 5, letter: 3 },
    "G": { name: "G", abc: "G", pc: 7, letter: 4 },
    "D": { name: "D", abc: "D", pc: 2, letter: 1 },
    "B♭": { name: "B♭", abc: "Bb", pc: 10, letter: 6 },
    "A": { name: "A", abc: "A", pc: 9, letter: 5 },
    "E♭": { name: "E♭", abc: "Eb", pc: 3, letter: 2 }
  };

  /* ---------- リズム型 ---------- */
  function cell(id, label, span, evs, abc, compound) {
    return {
      id: id, label: label, span: span, compound: !!compound, abc: abc,
      events: evs.map(function (e) { return typeof e === "number" ? { dur: e, rest: false } : { dur: e[0], rest: true }; })
    };
  }
  var CELL_LIST = [
    cell("q", "タン", 1, [12], "X4"),
    cell("ee", "タタ", 1, [6, 6], "X2X2"),
    cell("ess", "タ・タカ", 1, [6, 3, 3], "X2XX"),
    cell("sse", "タカ・タ", 1, [3, 3, 6], "XXX2"),
    cell("ssss", "タカタカ", 1, [3, 3, 3, 3], "XXXX"),
    cell("r", "ウン", 1, [[12]], "z4"),
    cell("re", "ウ・タ", 1, [[6], 6], "z2X2"),
    cell("d8s", "タッカ", 1, [9, 3], "X3X"),
    cell("s8s", "タ・ター・タ", 1, [3, 6, 3], "XX2X"),
    cell("trip", "タタタ(3連)", 1, [4, 4, 4], "(3X2X2X2"),
    cell("half", "ターアン", 2, [24], "X8"),
    cell("dqe", "ターン・タ", 2, [18, 6], "X6X2"),
    cell("eqe", "タ・タン・タ", 2, [6, 12, 6], "X2X4X2"),
    cell("c_q", "ターン", 1, [18], "X6", true),
    cell("c_qe", "ター・タ", 1, [12, 6], "X4X2", true),
    cell("c_eq", "タ・ター", 1, [6, 12], "X2X4", true),
    cell("c_eee", "タタタ", 1, [6, 6, 6], "X2X2X2", true),
    cell("c_r", "ウーン", 1, [[18]], "z6", true),
    cell("c_eess", "タタ・タカ", 1, [6, 6, 3, 3], "X2X2XX", true),
    cell("c_esse", "タ・タカ・タ", 1, [6, 3, 3, 6], "X2XXX2", true),
    cell("c_d8s8", "タッカ・タ", 1, [9, 3, 6], "X3XX2", true),
    cell("c_h", "ターーン", 2, [36], "X12", true),
    cell("c_hemi", "タン・タン・タン", 2, [12, 12, 12], "X4X4X4", true)
  ];
  var CELLS = {};
  CELL_LIST.forEach(function (c) { CELLS[c.id] = c; });
  var REST_CELLS = { r: 1, re: 1, c_r: 1 };

  /* ---------- レベル表 ---------- */
  var L4_CELLS = { q: 3, ee: 3, ess: 2, sse: 2, ssss: 1, r: 1, re: 1, dqe: 2, half: 1 };
  var L5_CELLS = merge(L4_CELLS, { d8s: 2, s8s: 1.5, eqe: 1.5 });
  var L6_CELLS = { c_q: 3, c_qe: 3, c_eq: 2, c_eee: 3, c_r: 0.5, c_h: 1 };
  var L7_SIMPLE = merge(L5_CELLS, { trip: 1 });
  var L7_COMP = merge(L6_CELLS, { c_eess: 1.5, c_esse: 1.5, c_d8s8: 1.5 });
  var L8_COMP = merge(L7_COMP, { c_hemi: 1.5 });
  var KEYS3 = ["C", "F", "G"], KEYS5 = ["C", "F", "G", "D", "B♭"], KEYS7 = ["C", "F", "G", "D", "B♭", "A", "E♭"];

  var LEVELS = [null,
    { lv: 1, name: "ペンタトニック・順次", modes: { laPenta: 1 }, keys: KEYS3, range: [0, 5], width: 99, maxLeap: 1,
      meters: { "2/4": 1 }, simple: { q: 4, ee: 4 }, compound: null, tempo: 63, ctempo: 54 },
    { lv: 2, name: "ペンタトニック・跳躍", modes: { laPenta: 1 }, keys: KEYS3, range: [-2, 5], width: 99, maxLeap: 3,
      meters: { "2/4": 1 }, simple: { q: 3, ee: 3, ess: 3, sse: 2, r: 1 }, compound: null, tempo: 63, ctempo: 54 },
    { lv: 3, name: "二つのペンタトニック", modes: { laPenta: 1, doPenta: 1 }, keys: KEYS5, range: [-2, 5], width: 99, maxLeap: 3,
      meters: { "2/4": 1 }, simple: { q: 3, ee: 3, ess: 3, sse: 2, ssss: 2, re: 1.5, eqe: 1.5, r: 1 }, compound: null, tempo: 66, ctempo: 54 },
    { lv: 4, name: "長調", modes: { major: 1 }, keys: KEYS5, range: [-3, 7], width: 8, maxLeap: 4,
      meters: { "2/4": 1, "3/4": 1, "4/4": 1 }, simple: L4_CELLS, compound: null, tempo: 69, ctempo: 54 },
    { lv: 5, name: "短調", modes: { minor: 1 }, keys: KEYS7, range: [-3, 7], width: 8, maxLeap: 4,
      meters: { "2/4": 1, "3/4": 1, "4/4": 1 }, simple: L5_CELLS, compound: null, tempo: 69, ctempo: 54 },
    { lv: 6, name: "6/8 拍子", modes: { major: 1, minor: 1 }, keys: KEYS7, range: [-3, 7], width: 8, maxLeap: 4,
      meters: { "6/8": 1 }, simple: null, compound: L6_CELLS, tempo: 69, ctempo: 54 },
    { lv: 7, name: "半音と大きな跳躍", modes: { major: 1, minor: 1 }, keys: KEYS7, range: [-4, 8], width: 10, maxLeap: 7,
      meters: { "2/4": 1, "3/4": 1, "6/8": 1 }, simple: L7_SIMPLE, compound: L7_COMP, tempo: 72, ctempo: 56 },
    { lv: 8, name: "ヘミオラ", modes: { major: 1, minor: 1 }, keys: KEYS7, range: [-4, 8], width: 10, maxLeap: 7,
      meters: { "6/8": 0.8, "3/4": 0.2 }, simple: L7_SIMPLE, compound: L8_COMP, tempo: 72, ctempo: 56 }
  ];
  var MAX_LEVEL = 8;

  function merge(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
  function mod(a, n) { return ((a % n) + n) % n; }
  function pickWeighted(weights, rng) {
    var keys = Object.keys(weights).filter(function (k) { return weights[k] > 0; });
    var total = keys.reduce(function (s, k) { return s + weights[k]; }, 0);
    var r = rng() * total;
    for (var i = 0; i < keys.length; i++) { r -= weights[keys[i]]; if (r < 0) return keys[i]; }
    return keys[keys.length - 1];
  }
  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

  // シード付き乱数（テストと再現用）
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 拍子 ---------- */
  function meterInfo(str) {
    var p = str.split("/"), num = +p[0], den = +p[1];
    var compound = den === 8 && num % 3 === 0;
    return { num: num, den: den, beats: compound ? num / 3 : num, beatTicks: compound ? 18 : 12, compound: compound, str: str };
  }
  // 種目と拍子 → 小節数
  function barsFor(exercise, meter) {
    var four = meter.num === 4 && meter.den === 4;
    if (exercise === "rhythmTap" || exercise === "sight") return four ? 2 : 4;
    return four ? 1 : 2; // rhythmHear, earMelody
  }
  function levelTempo(level, meter) {
    var L = LEVELS[level];
    return meter.compound ? L.ctempo : L.tempo;
  }
  function cellsFor(level, compound) {
    var L = LEVELS[level];
    var w = compound ? L.compound : L.simple;
    return w ? Object.keys(w) : [];
  }
  function spanAllowedAt(meter, beat) {
    if (beat + 2 > meter.beats) return false;
    if (meter.beats === 4) return beat === 0 || beat === 2;
    if (meter.beats === 3) return beat === 0 || beat === 1;
    return beat === 0;
  }

  /* ---------- 小節（セル列）→ events ---------- */
  function expandBars(bars, beatTicks) {
    var events = [], tick = 0;
    bars.forEach(function (bar, b) {
      var beat = 0;
      bar.forEach(function (id, ci) {
        var c = CELLS[id];
        var t = tick + beat * beatTicks;
        c.events.forEach(function (e) {
          events.push({ startTick: t, dur: e.dur, rest: e.rest, bar: b, slot: beat, beat: beat + Math.floor((t - tick - beat * beatTicks) / beatTicks), cell: id, cellIndex: ci });
          t += e.dur;
        });
        beat += c.span;
      });
      tick += beat * beatTicks;
    });
    return { events: events, totalTicks: tick };
  }

  /* ---------- リズム生成 ---------- */
  function genRhythm(level, opts, rng) {
    opts = opts || {};
    var L = LEVELS[level];
    var meterStr = opts.meter || pickWeighted(L.meters, rng);
    var meter = meterInfo(meterStr);
    var nBars = typeof opts.bars === "number" ? opts.bars : barsFor(opts.exercise || "rhythmHear", meter);
    var weights = merge(meter.compound ? L.compound : L.simple, {});
    if (opts.melodic) for (var k in weights) if (REST_CELLS[k]) weights[k] *= 0.4;
    var lastCell = meter.compound ? "c_q" : "q";
    var longCell = meter.compound ? "c_h" : "half";
    var hemiola = meter.compound && weights.c_hemi;
    var needHemi = 0;
    if (hemiola) {
      delete weights.c_hemi; // 位置を決めて置く
      needHemi = Math.floor(nBars / 4);
      if (needHemi === 0 && nBars > 1 && rng() < 0.5) needHemi = 1;
    }

    for (var attempt = 0; attempt < 500; attempt++) {
      var bars = [];
      for (var b = 0; b < nBars; b++) bars.push(null);
      // ヘミオラの小節（最終小節以外）
      if (needHemi) {
        var cand = [];
        for (b = 0; b < nBars - 1; b++) cand.push(b);
        for (var h = 0; h < needHemi && cand.length; h++) {
          var bi = cand.splice(Math.floor(rng() * cand.length), 1)[0];
          bars[bi] = ["c_hemi"];
        }
      }
      var useLong = weights[longCell] > 0 && rng() < 0.4;
      var ok = true, restRun = 0;
      for (b = 0; b < nBars && ok; b++) {
        if (bars[b]) { restRun = 0; continue; }
        var bar = [], beat = 0, isLastBar = b === nBars - 1;
        while (beat < meter.beats) {
          var first = b === 0 && beat === 0;
          var id;
          if (isLastBar && useLong && beat === meter.beats - 2) id = longCell;
          else if (isLastBar && beat === meter.beats - 1) id = lastCell;
          else {
            var w = merge(weights, {});
            if (first || restRun >= 2) { w.r = 0; w.re = 0; w.c_r = 0; }
            for (var cid in w) {
              var c = CELLS[cid];
              if (c.span === 2 && !spanAllowedAt(meter, beat)) w[cid] = 0;
              // 最後の小節では終止の拍を残す
              if (isLastBar) {
                var endBeat = beat + c.span;
                var limit = useLong ? meter.beats - 2 : meter.beats - 1;
                if (endBeat > limit) w[cid] = 0;
              }
            }
            if (!Object.keys(w).some(function (k) { return w[k] > 0; })) { ok = false; break; }
            id = pickWeighted(w, rng);
          }
          bar.push(id);
          restRun = REST_CELLS[id] ? restRun + 1 : 0;
          beat += CELLS[id].span;
        }
        if (beat !== meter.beats) ok = false;
        bars[b] = bar;
      }
      if (!ok) continue;
      if (nBars > 1) {
        var s0 = bars[0].join(",");
        if (bars.every(function (x) { return x.join(",") === s0; })) continue;
      }
      // 休符セルは 2 連続まで（ヘミオラ小節をまたいでも確認）
      var flat = [].concat.apply([], bars), run = 0, bad = false;
      flat.forEach(function (id) { run = REST_CELLS[id] ? run + 1 : 0; if (run > 2) bad = true; });
      if (bad || REST_CELLS[flat[0]]) continue;
      var ex = expandBars(bars, meter.beatTicks);
      return { meter: meter, bars: bars, events: ex.events, totalTicks: ex.totalTicks, level: level };
    }
    throw new Error("genRhythm failed");
  }

  /* ---------- 旋律 ---------- */
  function scaleRel(mode, idx) {
    var sc = MODES[mode].scale, len = sc.length;
    return 12 * Math.floor(idx / len) + sc[mod(idx, len)];
  }

  function chooseMove(level, mode, cur, lastMove, dir, rng) {
    var M = MODES[mode], len = M.scale.length, L = LEVELS[level];
    var r = rng();
    if (Math.abs(lastMove) >= 3) return -Math.sign(lastMove); // 跳躍の次は逆方向へ順次
    var step = function () { return (rng() < 0.65 ? dir : -dir) || (rng() < 0.5 ? 1 : -1); };
    if (r < 0.12) return 0;
    r -= 0.12;
    var sgn = rng() < 0.5 ? 1 : -1;
    switch (level) {
      case 1: return step();
      case 2:
        if (r < 0.30) return 2 * sgn;
        if (r < 0.40) { if (cur === 0) return 3; if (cur === 3) return -3; }
        return step();
      case 3:
        if (r < 0.35) return (rng() < 0.5 ? 2 : 3) * sgn;
        return step();
      case 4: case 5:
        if (r < 0.25 && M.chord.indexOf(mod(cur, len)) >= 0) {
          var targets = [];
          for (var t = L.range[0]; t <= L.range[1]; t++) {
            var d = Math.abs(t - cur);
            if (d >= 2 && d <= L.maxLeap && M.chord.indexOf(mod(t, len)) >= 0) targets.push(t - cur);
          }
          if (targets.length) return pick(targets, rng);
        }
        return step();
      case 6:
        if (r < 0.30) return (2 + Math.floor(rng() * 3)) * sgn;
        return step();
      default:
        if (r < 0.35) return (2 + Math.floor(rng() * 6)) * sgn;
        return step();
    }
  }

  function walk(level, mode, n, rng) {
    var M = MODES[mode], len = M.scale.length, L = LEVELS[level];
    var lo = L.range[0], hi = L.range[1];
    for (var t = 0; t < 300; t++) {
      var r = rng();
      var deg = r < 0.6 ? 0 : r < 0.9 ? M.fifth : M.third;
      var starts = [deg, deg - len, deg + len].filter(function (i) { return i >= lo && i <= hi; });
      if (!starts.length) continue;
      var cur = starts[0];
      var seq = [cur], min = cur, max = cur, lastMove = 0, dir = rng() < 0.5 ? 1 : -1, same = 1, ok = true;
      for (var k = 1; k < n - 1; k++) {
        var found = false;
        for (var tries = 0; tries < 30; tries++) {
          var mv = chooseMove(level, mode, cur, lastMove, dir, rng);
          var nx = cur + mv;
          if (nx < lo || nx > hi) { if (Math.abs(lastMove) >= 3) break; continue; }
          if (Math.max(max, nx) - Math.min(min, nx) > L.width) continue;
          if (Math.abs(mv) > L.maxLeap) continue;
          if (mv === 0 && same >= 3) continue;
          if (Math.abs(scaleRel(mode, nx) - scaleRel(mode, cur)) === 6) continue; // 増 4 度の跳躍は避ける
          found = true; break;
        }
        if (!found) { ok = false; break; }
        same = mv === 0 ? same + 1 : 1;
        if (mv !== 0) dir = Math.sign(mv);
        lastMove = mv; cur = nx; seq.push(cur);
        if (cur < min) min = cur; if (cur > max) max = cur;
      }
      if (!ok) continue;
      if (n > 1) {
        var finals = [0, len].filter(function (i) { return i >= lo && i <= hi; });
        finals.sort(function (a, b) { return Math.abs(a - cur) - Math.abs(b - cur); });
        var f = finals[0];
        if (Math.abs(f - cur) > L.maxLeap) continue;
        if (f === cur && same >= 3) continue;
        if (Math.abs(lastMove) >= 3 && f !== cur && Math.sign(f - cur) === Math.sign(lastMove)) continue;
        if (Math.max(max, f) - Math.min(min, f) > L.width) continue;
        seq.push(f);
      }
      if (n >= 5) {
        var distinct = {};
        seq.forEach(function (i) { distinct[i] = 1; });
        if (Object.keys(distinct).length < 3) continue;
      }
      return seq;
    }
    return null;
  }

  function pickKey(level, rng, mode) {
    var L = LEVELS[level];
    mode = mode || pickWeighted(L.modes, rng);
    var key = KEYS[pick(L.keys, rng)];
    return { mode: mode, doName: key.name, doPc: key.pc, tonicPc: mod(key.pc + MODES[mode].tonic, 12), tonicSolfa: MODES[mode].tonic };
  }

  function genMelody(level, opts, rng) {
    opts = opts || {};
    var L = LEVELS[level];
    for (var attempt = 0; attempt < 200; attempt++) {
      var rhythm = genRhythm(level, { bars: opts.bars, exercise: opts.exercise, melodic: true, meter: opts.meter }, rng);
      var sounding = rhythm.events.filter(function (e) { return !e.rest; });
      var n = sounding.length;
      var key = pickKey(level, rng, opts.mode);
      var mode = key.mode, M = MODES[mode], len = M.scale.length;
      var idxs = walk(level, mode, n, rng);
      if (!idxs) continue;
      var alts = idxs.map(function () { return 0; });
      var rel = function (i) { return scaleRel(mode, idxs[i]) + alts[i]; };
      var solfaAt = function (i) { return mod(M.tonic + rel(i), 12); };

      // 短調: ソ→ラ の上行でソ♯（和声的短音階）
      if (mode === "minor" && level >= 5) {
        for (var i = 0; i < n - 1; i++) {
          if (mod(idxs[i], 7) === 6 && idxs[i + 1] === idxs[i] + 1) {
            if (i > 0) {
              var prevSolfa = solfaAt(i - 1);
              if (prevSolfa === 5) continue; // ファ→ソ♯ は増 2 度
              var iv = Math.abs(rel(i) + 1 - rel(i - 1));
              if (iv === 6 || iv === 8) continue; // 増 4 度・増 5 度も避ける
            }
            if (i + 1 === n - 1 || rng() < 0.5) alts[i] = 1;
          }
        }
      }
      // Lv7〜8: 半音の飾り
      if (level >= 7) addChromatic(mode, idxs, alts, rel, solfaAt, n, rng);

      // MIDI の配置（表記上 55〜79、平均が 67 に近い方）
      var rels = idxs.map(function (_, i) { return rel(i); });
      var lo = Math.min.apply(null, rels), hi = Math.max.apply(null, rels);
      var mean = rels.reduce(function (s, x) { return s + x; }, 0) / n;
      var best = null;
      for (var tm = key.tonicPc; tm <= 96; tm += 12) {
        if (tm + lo >= 55 && tm + hi <= 79) {
          if (best === null || Math.abs(tm + mean - 67) < Math.abs(best + mean - 67)) best = tm;
        }
      }
      if (best === null) continue;
      var notes = sounding.map(function (e, i) {
        var s = solfaAt(i);
        return { midi: best + rels[i], solfa: s, name: NAMES[s], startTick: e.startTick, dur: e.dur, bar: e.bar, idx: idxs[i], alt: alts[i] };
      });
      return buildMelody(level, rhythm, key, best, notes);
    }
    throw new Error("genMelody failed");
  }

  function addChromatic(mode, idxs, alts, rel, solfaAt, n, rng) {
    var want = rng() < 0.5 ? 1 : 2;
    var cands = [];
    for (var i = 1; i < n - 1; i++) {
      if (alts[i] !== 0) continue;
      var cs = solfaAt(i), ns = solfaAt(i + 1), cr = rel(i), nr = rel(i + 1), pr = rel(i - 1);
      var opts = [];
      if (mode === "major") {
        if (ns === 7 && alts[i + 1] === 0 && (nr === cr || (cs === 5 && nr === cr + 2))) opts.push({ i: i, alt: nr - 1 - cr });
        if (ns === 2 && alts[i + 1] === 0 && (nr === cr || (cs === 0 && nr === cr + 2))) opts.push({ i: i, alt: nr - 1 - cr });
        if (ns === 9 && alts[i + 1] === 0 && ((cs === 11 && nr === cr - 2) || nr === cr)) opts.push({ i: i, alt: nr + 1 - cr });
      } else {
        // ミ→ファ♯→ソ♯→ラ（旋律的短音階の上行）
        if (cs === 5 && i + 2 <= n - 1 && idxs[i + 1] === idxs[i] + 1 && idxs[i + 2] === idxs[i] + 2 && alts[i + 1] === 0 && alts[i + 2] === 0)
          opts.push({ i: i, alt: 1, also: i + 1 });
        if (ns === 4 && alts[i + 1] === 0 && (nr === cr || (cs === 2 && nr === cr + 2))) opts.push({ i: i, alt: nr - 1 - cr });
      }
      opts.forEach(function (o) {
        var newRel = cr + o.alt;
        var d = Math.abs(newRel - pr);
        if (d <= 5 && d !== 0) cands.push(o);
      });
    }
    var used = {};
    for (var c = 0; c < want && cands.length; c++) {
      var k = Math.floor(rng() * cands.length);
      var o = cands.splice(k, 1)[0];
      if (used[o.i] || used[o.i - 1] || used[o.i + 1] || (o.also && (used[o.also] || used[o.also + 1]))) { c--; continue; }
      if (alts[o.i] !== 0) { c--; continue; }
      alts[o.i] = o.alt; used[o.i] = 1;
      if (o.also != null) { alts[o.also] = 1; used[o.also] = 1; }
    }
  }

  function buildMelody(level, rhythm, key, tonicMidi, notes) {
    var m = {
      level: level, rhythm: rhythm, mode: key.mode, doPc: key.doPc, doName: key.doName,
      tonicMidi: tonicMidi, tonicSolfa: key.tonicSolfa, tonicName: NAMES[key.tonicSolfa], notes: notes
    };
    m.abc = function () { return melodyAbc(m, false); };
    m.abcWithSolfa = function () { return melodyAbc(m, true); };
    m.rhythmAbc = function () { return rhythmAbc(rhythm); };
    return m;
  }

  /* ---------- 一音聴音 ---------- */
  function answerSet(level, mode) {
    var LA5 = [9, 0, 2, 4, 7];
    var DO7 = [0, 2, 4, 5, 7, 9, 11];
    var LA8 = [9, 11, 0, 2, 4, 5, 7, 8];
    if (level <= 3) return LA5;
    if (level === 4) return DO7;
    if (level === 5) return LA8;
    var minor = mode === "minor" || mode === "laPenta";
    if (level === 6) return minor ? LA8 : DO7;
    return minor ? [9, 11, 0, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 2, 4, 5, 6, 7, 9, 10, 11];
  }

  function earKey(level, rng) {
    var k = pickKey(level, rng);
    // 主音を 55〜66 に置く（上に 11 半音まで載せても 79 以内）
    var tm = k.tonicPc + 48;
    while (tm < 55) tm += 12;
    k.tonicMidi = tm;
    return k;
  }

  // history: 直前に出た階名（半音数）の列
  function genEarNotes(level, key, count, history, rng) {
    var set = answerSet(level, key.mode);
    var M = MODES[key.mode];
    var diatonic = M.scale.map(function (s) { return mod(M.tonic + s, 12); });
    var hist = (history || []).slice();
    var out = [];
    for (var i = 0; i < count; i++) {
      var w = {};
      set.forEach(function (s) { w[s] = diatonic.indexOf(s) >= 0 ? 1 : 0.4; });
      var h = hist.length;
      if (h >= 2 && hist[h - 1] === hist[h - 2]) w[hist[h - 1]] = 0;
      var s = +pickWeighted(w, rng);
      hist.push(s);
      var relUp = mod(s - key.tonicSolfa, 12);
      out.push({ solfa: s, name: NAMES[s], midi: key.tonicMidi + relUp });
    }
    return out;
  }

  function contextNotes(mode, tonicMidi) {
    var M = MODES[mode];
    return M.tonic === 9 ? [tonicMidi, tonicMidi + 3, tonicMidi + 7] : [tonicMidi, tonicMidi + 4, tonicMidi + 7];
  }

  /* ---------- ABC 生成 ---------- */
  function keyAccidentals(doName) {
    var key = KEYS[doName], acc = {};
    for (var k = 0; k < 7; k++) {
      var letter = (key.letter + k) % 7;
      var pc = (key.pc + MAJOR[k]) % 12;
      acc[letter] = ((pc - LETTER_PC[letter] + 18) % 12) - 6;
    }
    return acc;
  }
  var ACC_STR = { "-2": "__", "-1": "_", "0": "=", "1": "^", "2": "^^" };

  // midi・階名（ドからの半音数）→ ABC の音名。barState は小節内の変位状態
  function spellNote(midi, solfa, doName, keyAcc, barState) {
    var key = KEYS[doName];
    var ka = SPELL[mod(solfa, 12)];
    var letter = (key.letter + ka[0]) % 7;
    var want = keyAcc[letter] + ka[1];
    var natural = midi - want;
    if (mod(natural, 12) !== LETTER_PC[letter]) throw new Error("spelling mismatch " + midi + " " + solfa + " " + doName);
    var octave = Math.floor(natural / 12) - 1;
    var id = letter + ":" + octave;
    var cur = Object.prototype.hasOwnProperty.call(barState, id) ? barState[id] : keyAcc[letter];
    var prefix = "";
    if (want !== cur) { prefix = ACC_STR[String(want)]; barState[id] = want; }
    var ch = LETTERS[letter];
    var s;
    if (octave >= 5) s = ch.toLowerCase() + "'".repeat(octave - 5);
    else s = ch + ",".repeat(4 - octave);
    return prefix + s;
  }

  // 1 段あたりの小節数。4/4 は 1 小節。2 小節で音（休符を含む）が多すぎるときも 1 小節にする
  function barsPerLine(r, kind) {
    var meter = r.meter;
    if (meter.num === 4 && meter.den === 4) return 1;
    var limit = kind === "rhythm" ? 14 : 8;
    var counts = r.bars.map(function (_, b) { return r.events.filter(function (e) { return e.bar === b; }).length; });
    for (var i = 0; i < counts.length; i += 2) if (counts[i] + (counts[i + 1] || 0) > limit) return 1;
    return 2;
  }

  function header(meter, k) {
    return "X:1\n%%stretchlast 1\nM:" + meter.num + "/" + meter.den + "\nL:1/16\nK:" + k + "\n";
  }

  function melodyAbc(m, withSolfa) {
    var r = m.rhythm, meter = r.meter;
    var keyAcc = keyAccidentals(m.doName);
    var per = barsPerLine(r, "melody");
    var out = header(meter, KEYS[m.doName].abc);
    var ni = 0, line = "", words = [];
    r.bars.forEach(function (bar, b) {
      var state = {};
      var cellsStr = bar.map(function (id) {
        return CELLS[id].abc.replace(/X/g, function () {
          var note = m.notes[ni++];
          words.push(note.name);
          return spellNote(note.midi, note.solfa, m.doName, keyAcc, state);
        });
      });
      line += cellsStr.join(" ");
      var last = b === r.bars.length - 1;
      if (last) line += " |]";
      else line += " |";
      if (last || (b + 1) % per === 0) {
        out += line + "\n";
        if (withSolfa) out += "w: " + (words.length ? words.join(" ") : "") + "\n";
        line = ""; words = [];
      } else line += " ";
    });
    return out;
  }

  function rhythmAbc(r) {
    var meter = r.meter;
    var per = barsPerLine(r, "rhythm");
    var out = header(meter, "C clef=perc stafflines=1").replace("X:1\n", "X:1\n%%staffsep 34\n");
    var line = "";
    r.bars.forEach(function (bar, b) {
      line += bar.map(function (id) { return CELLS[id].abc.replace(/X/g, "B"); }).join(" ");
      var last = b === r.bars.length - 1;
      line += last ? " |]" : " |";
      if (last || (b + 1) % per === 0) { out += line + "\n"; line = ""; } else line += " ";
    });
    return out;
  }

  // 小さな譜例（1 セル）。音部記号・拍子記号なし
  function cellAbc(id) {
    return "X:1\nL:1/16\nK:C clef=none stafflines=0\n" + CELLS[id].abc.replace(/X/g, "B") + "\n";
  }

  /* ---------- 判定 ---------- */
  function slotSignatures(events, beatTicks) {
    // (小節, 拍) → その拍の中身の文字列
    var total = 0;
    events.forEach(function (e) { total = Math.max(total, e.startTick + e.dur); });
    var sigs = [], nBeats = Math.round(total / beatTicks);
    for (var s = 0; s < nBeats; s++) {
      var a = s * beatTicks, z = a + beatTicks, parts = [];
      events.forEach(function (e) {
        var end = e.startTick + e.dur;
        if (e.startTick < a && end > a) parts.push("held" + (e.rest ? "R" : "N") + (Math.min(end, z) - a));
        if (e.startTick >= a && e.startTick < z) parts.push((e.startTick - a) + ":" + e.dur + (e.rest ? "R" : "N"));
      });
      sigs.push(parts.join(","));
    }
    return sigs;
  }

  function judgeRhythm(truthEvents, answerBars, beatTicks) {
    if (!beatTicks) {
      var first = truthEvents[0] && CELLS[truthEvents[0].cell];
      beatTicks = first && first.compound ? 18 : 12;
    }
    var ans = expandBars(answerBars, beatTicks).events;
    var t = slotSignatures(truthEvents, beatTicks), a = slotSignatures(ans, beatTicks);
    var slots = [], wrongCells = {};
    for (var i = 0; i < t.length; i++) {
      var ok = t[i] === a[i];
      slots.push({ index: i, ok: ok });
      if (!ok) {
        // この拍にかかる正解のセル
        truthEvents.forEach(function (e) {
          var a0 = i * beatTicks, z0 = a0 + beatTicks;
          if (e.startTick < z0 && e.startTick + e.dur > a0) wrongCells[e.bar + ":" + e.cellIndex] = e.cell;
        });
      }
    }
    var missed = Object.keys(wrongCells).map(function (k) { return wrongCells[k]; });
    return { correct: slots.every(function (s) { return s.ok; }), slots: slots, missedCells: missed };
  }

  function judgeMelody(notes, answers) {
    var per = notes.map(function (n, i) {
      var a = answers[i];
      return a !== null && a !== undefined && mod(a - n.solfa, 12) === 0;
    });
    var confusions = [];
    notes.forEach(function (n, i) {
      if (!per[i] && answers[i] !== null && answers[i] !== undefined)
        confusions.push(NAMES[mod(n.solfa, 12)] + ">" + NAMES[mod(answers[i], 12)]);
    });
    var hits = per.filter(Boolean).length;
    return { correct: hits === notes.length, per: per, hits: hits, count: notes.length, confusions: confusions };
  }

  function judgeTaps(expected, taps, opts) {
    opts = opts || {};
    var win = opts.windowSec || 0.110;
    var ratio = opts.gapRatio || 0.4;
    var used = taps.map(function () { return false; });
    var per = [], devs = [];
    for (var i = 0; i < expected.length; i++) {
      var gap = Infinity;
      if (i > 0) gap = Math.min(gap, expected[i] - expected[i - 1]);
      if (i < expected.length - 1) gap = Math.min(gap, expected[i + 1] - expected[i]);
      var w = Math.min(win, ratio * gap);
      var best = -1, bestD = Infinity;
      for (var j = 0; j < taps.length; j++) {
        if (used[j]) continue;
        var d = taps[j] - expected[i];
        if (Math.abs(d) <= w + 1e-9 && Math.abs(d) < Math.abs(bestD)) { best = j; bestD = d; }
      }
      if (best >= 0) { used[best] = true; per.push({ devMs: bestD * 1000 }); devs.push(bestD * 1000); }
      else per.push({ devMs: null });
    }
    var hits = devs.length, extras = used.filter(function (u) { return !u; }).length;
    var mean = hits ? devs.reduce(function (s, x) { return s + x; }, 0) / hits : 0;
    var sd = hits ? Math.sqrt(devs.reduce(function (s, x) { return s + (x - mean) * (x - mean); }, 0) / hits) : 0;
    var denom = expected.length + extras;
    var acc = denom ? hits / denom : 0;
    return { hits: hits, misses: expected.length - hits, extras: extras, accuracy: acc, meanDevMs: mean, sdDevMs: sd, perOnset: per, passed: acc >= 0.9 };
  }

  // 秒への変換
  function ticksToSec(ticks, bpm, beatTicks) { return ticks * 60 / bpm / beatTicks; }

  var api = {
    TPQ: TPQ, NAMES: NAMES, SPELL: SPELL, LETTERS: LETTERS, MODES: MODES, KEYS: KEYS,
    CELLS: CELLS, CELL_LIST: CELL_LIST, REST_CELLS: REST_CELLS, LEVELS: LEVELS, MAX_LEVEL: MAX_LEVEL,
    makeRng: makeRng, meterInfo: meterInfo, barsFor: barsFor, levelTempo: levelTempo, cellsFor: cellsFor,
    spanAllowedAt: spanAllowedAt, expandBars: expandBars, genRhythm: genRhythm, genMelody: genMelody,
    pickKey: pickKey, earKey: earKey, genEarNotes: genEarNotes, answerSet: answerSet, contextNotes: contextNotes,
    keyAccidentals: keyAccidentals, barsPerLine: barsPerLine, spellNote: spellNote, melodyAbc: melodyAbc, rhythmAbc: rhythmAbc, cellAbc: cellAbc,
    judgeRhythm: judgeRhythm, judgeMelody: judgeMelody, judgeTaps: judgeTaps, ticksToSec: ticksToSec, scaleRel: scaleRel
  };
  root.SolfegeCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(__root);
// ---- ここまで ----

const SolfegeCore = __root.SolfegeCore;
export default SolfegeCore;
export const {
  TPQ, NAMES, SPELL, LETTERS, MODES, KEYS, CELLS, CELL_LIST, REST_CELLS, LEVELS, MAX_LEVEL, makeRng, meterInfo, barsFor, levelTempo, cellsFor, spanAllowedAt, expandBars, genRhythm, genMelody, pickKey, earKey, genEarNotes, answerSet, contextNotes, keyAccidentals, barsPerLine, spellNote, melodyAbc, rhythmAbc, cellAbc, judgeRhythm, judgeMelody, judgeTaps, ticksToSec, scaleRel
} = SolfegeCore;
