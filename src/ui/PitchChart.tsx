// ピッチ軌跡の図（canvas、ハンドオフ文書 §11.2）。
// 横 = 課題時間（小節線・拍）、縦 = 音高（半音）。正解の音符を帯（±50 セントを薄く、±25 を濃く）、歌った軌跡を線で。
import { useEffect, useRef } from "react";
import type { Frame } from "../audio/dsp.ts";
import { totalSeconds } from "../core/exercise.ts";
import Core from "../core/solfege-core.js";
import type { Melody } from "../core/solfege-core.js";
import { beatTimes, hzToCents, targetNotes } from "../judge/judge.ts";
import type { NoteStatus, TakeResult, TargetNote } from "../judge/judge.ts";

/** 歌っている間の表示（設定で ON にしたときだけ） */
export interface LiveTrace {
  /** 届いたフレーム（t は AudioContext の秒）。同じ配列に追記されていく */
  frames: Frame[];
  /** 課題の 1 拍目の AudioContext 時刻 */
  t0: number;
  roundTripSec: number;
  gateDb: number;
  minClarity: number;
  /** いまの AudioContext 時刻 */
  now(): number;
}

interface Props {
  melody: Melody;
  bpm: number;
  result?: TakeResult | null;
  live?: LiveTrace | null;
  height?: number;
}

interface Point { t: number; pitch: number | null }

const PAD = { left: 38, right: 8, top: 8, bottom: 18 };
const STATUS_TOKEN: Record<NoteStatus, string> = { good: "--ok", ok: "--warn", wrong: "--ng", silent: "--ink-soft" };

/** その時刻の正解の音（休符の中なら時間的に近い方の音） */
function noteAt(notes: TargetNote[], t: number): TargetNote {
  let best = notes[0], bestDist = Infinity;
  for (const n of notes) {
    if (t >= n.onSec && t < n.offSec) return n;
    const d = t < n.onSec ? n.onSec - t : t - n.offSec;
    if (d < bestDist) { bestDist = d; best = n; }
  }
  return best;
}

/** 歌った高さ（セント）を、その時刻の正解の音に最も近いオクターブに畳む（低い声でも重なる） */
function foldToTarget(cents: number, target: TargetNote): number {
  const p = cents / 100;
  return p + 12 * Math.round((target.midi - p) / 12);
}

function draw(canvas: HTMLCanvasElement, melody: Melody, bpm: number, result: TakeResult | null, live: LiveTrace | null): void {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (width <= 0 || height <= 0) return;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const g = canvas.getContext("2d");
  if (!g) return;
  const css = getComputedStyle(canvas);
  const token = (name: string) => css.getPropertyValue(name).trim() || "#888";
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);

  const notes = targetNotes(melody, bpm);
  if (!notes.length) return;
  const totalSec = totalSeconds(melody, bpm);
  const delta = result ? result.offsetMs / 1000 : 0;

  // 歌った軌跡（Δ を戻して正解と重ねる）
  const points: Point[] = [];
  if (result) {
    for (const f of result.trace) {
      const t = f.t - delta;
      points.push({ t, pitch: f.cents === null || f.masked ? null : foldToTarget(f.cents, noteAt(notes, t)) });
    }
  } else if (live) {
    for (const f of live.frames) {
      const t = f.t - live.t0 - live.roundTripSec;
      if (t < -0.2) continue;
      const voiced = f.f0 !== null && f.clarity >= live.minClarity && f.rmsDb >= live.gateDb;
      points.push({ t, pitch: voiced ? foldToTarget(hzToCents(f.f0 as number), noteAt(notes, t)) : null });
    }
  }

  // 縦の範囲: 課題の最低音 −2 〜 最高音 +2 半音。軌跡がはみ出すときは広げる
  let lo = Math.min(...notes.map((n) => n.midi)) - 2, hi = Math.max(...notes.map((n) => n.midi)) + 2;
  for (const p of points) {
    if (p.pitch === null || p.t < 0 || p.t > totalSec) continue;
    lo = Math.min(lo, Math.floor(p.pitch) - 1);
    hi = Math.max(hi, Math.ceil(p.pitch) + 1);
  }
  const plotW = width - PAD.left - PAD.right, plotH = height - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (t / totalSec) * plotW;
  const y = (pitch: number) => PAD.top + ((hi + 0.5 - pitch) / (hi - lo + 1)) * plotH;

  // 半音ごとの薄い横線
  g.lineWidth = 1;
  g.strokeStyle = token("--line");
  g.globalAlpha = 0.5;
  g.beginPath();
  for (let p = lo; p <= hi; p++) {
    const yy = Math.round(y(p)) + 0.5;
    g.moveTo(PAD.left, yy); g.lineTo(width - PAD.right, yy);
  }
  g.stroke();

  // 小節線（濃く）と拍（薄く）、小節番号
  const beats = beatTimes(melody, bpm);
  g.font = `11px ${css.fontFamily}`;
  g.textBaseline = "alphabetic";
  let bar = 0;
  for (const b of [...beats, { t: totalSec, accent: true }]) {
    const xx = Math.round(x(b.t)) + 0.5;
    g.globalAlpha = b.accent ? 1 : 0.45;
    g.strokeStyle = b.accent ? token("--ink-soft") : token("--line");
    g.beginPath(); g.moveTo(xx, PAD.top); g.lineTo(xx, PAD.top + plotH); g.stroke();
    if (b.accent && b.t < totalSec) {
      g.globalAlpha = 1;
      g.fillStyle = token("--ink-soft");
      g.textAlign = "left";
      g.fillText(String(++bar), xx + 3, height - 4);
    }
  }
  g.globalAlpha = 1;

  // 課題に出る音の高さに階名
  g.textAlign = "right";
  g.textBaseline = "middle";
  g.fillStyle = token("--ink-soft");
  const seen = new Map<number, number>();
  for (const n of notes) seen.set(n.midi, n.solfa);
  let lastY = Infinity;
  for (const midi of [...seen.keys()].sort((a, b) => a - b)) {
    const yy = y(midi);
    if (lastY - yy < 11) continue; // 重なる階名は省く
    g.fillText(Core.NAMES[seen.get(midi) as number], PAD.left - 6, yy);
    lastY = yy;
  }

  // 正解の音符の帯
  g.fillStyle = token("--accent");
  for (const n of notes) {
    const x1 = x(n.onSec), w = Math.max(1, x(n.offSec) - x1 - 1);
    g.globalAlpha = 0.15;
    g.fillRect(x1, y(n.midi + 0.5), w, y(n.midi - 0.5) - y(n.midi + 0.5));
    g.globalAlpha = 0.3;
    g.fillRect(x1, y(n.midi + 0.25), w, y(n.midi - 0.25) - y(n.midi + 0.25));
  }
  g.globalAlpha = 1;

  // 判定に使った窓（帯の下の細い線。Δ を戻した位置）
  if (result) {
    g.lineWidth = 2;
    for (const r of result.notes) {
      const yy = Math.round(y(r.midi - 0.5)) + 3;
      g.strokeStyle = token(STATUS_TOKEN[r.status]);
      g.beginPath(); g.moveTo(x(r.windowStart - delta), yy); g.lineTo(x(r.windowEnd - delta), yy); g.stroke();
    }
  }

  // 歌った軌跡。有声でない所・マスクの所・大きく跳んだ所は線を切る
  g.save();
  g.beginPath(); g.rect(PAD.left, PAD.top, plotW, plotH); g.clip();
  g.strokeStyle = token("--ink");
  g.lineWidth = 1.75;
  g.lineJoin = "round";
  g.lineCap = "round";
  g.beginPath();
  let prev: Point | null = null;
  for (const p of points) {
    if (p.pitch === null) { prev = null; continue; }
    if (prev === null || prev.pitch === null || Math.abs(p.pitch - prev.pitch) > 6) {
      g.moveTo(x(p.t), y(p.pitch));
      g.lineTo(x(p.t) + 0.01, y(p.pitch)); // 1 フレームだけの点も見えるように
    } else {
      g.lineTo(x(p.t), y(p.pitch));
    }
    prev = p;
  }
  g.stroke();
  g.restore();

  // 歌っている間: いまの位置
  if (live) {
    const t = live.now() - live.t0;
    if (t >= 0 && t <= totalSec) {
      const xx = Math.round(x(t)) + 0.5;
      g.strokeStyle = token("--accent");
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(xx, PAD.top); g.lineTo(xx, PAD.top + plotH); g.stroke();
    }
  }
}

export function PitchChart({ melody, bpm, result = null, live = null, height = 180 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    const paint = () => draw(canvas, melody, bpm, result, live);
    const loop = () => { paint(); raf = requestAnimationFrame(loop); };
    if (live) raf = requestAnimationFrame(loop);
    else paint();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(paint);
    observer?.observe(canvas);
    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    scheme?.addEventListener("change", paint);
    void document.fonts?.ready.then(paint);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      scheme?.removeEventListener("change", paint);
    };
  }, [melody, bpm, result, live]);

  return <canvas ref={ref} className="pitch-chart" style={{ height }} role="img" aria-label="ピッチの軌跡（横は時間、縦は音の高さ）" />;
}
