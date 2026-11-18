// 五線譜（abcjs）。結果があれば符頭を判定で色分けし、各音の下に階名と「記号 + ずれ」の 2 行を出す。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { engine } from "../audio/engine.ts";
import type { Melody } from "../core/solfege-core.js";
import type { TakeResult } from "../judge/judge.ts";
import { playheadPosition, renderScore } from "./scoreRender.ts";
import type { RenderedScore } from "./scoreRender.ts";

/** 拍の位置の線。t0 = 課題の 1 拍目の AudioContext 時刻 */
export interface Playhead { t0: number; bpm: number }

interface Props {
  melody: Melody;
  result?: TakeResult | null;
  playhead?: Playhead | null;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const FALLBACK_WIDTH = 328;

export function Score({ melody, result = null, playhead = null }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef<RenderedScore | null>(null);
  const [width, setWidth] = useState(0);
  const [fontsReady, setFontsReady] = useState(false);

  // 歌詞の幅は書体で変わる。Web フォントが読めたら描き直す
  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => { if (alive) setFontsReady(true); });
    return () => { alive = false; };
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setWidth(Math.round(host.clientWidth) || FALLBACK_WIDTH);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const paper = paperRef.current;
    if (!paper || width <= 0) return;
    // 五線の幅 = 表示幅 − 左右の余白（8px）。入りきらない段は abcjs が全体を縮めて収める
    renderedRef.current = renderScore(paper, melody, result, Math.max(240, Math.min(640, width - 8)));
  }, [melody, result, width, fontsReady]);

  useEffect(() => {
    if (!playhead) return;
    const { beatTicks } = melody.rhythm.meter;
    const totalTicks = melody.rhythm.totalTicks;
    let raf = 0;
    let line: SVGLineElement | null = null;
    let shownStaff = -1;
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const frame = () => {
      const rendered = renderedRef.current;
      if (rendered?.svg) {
        if (!line || line.ownerSVGElement !== rendered.svg) {
          line?.remove();
          line = document.createElementNS(SVG_NS, "line");
          line.setAttribute("class", "playhead");
          rendered.svg.appendChild(line);
        }
        const tick = (engine.visualTime() - playhead.t0) * playhead.bpm / 60 * beatTicks;
        const pos = playheadPosition(rendered, totalTicks, tick);
        if (pos) {
          line.setAttribute("x1", String(pos.x)); line.setAttribute("x2", String(pos.x));
          line.setAttribute("y1", String(pos.top)); line.setAttribute("y2", String(pos.bottom));
          line.style.display = "";
          // 段が変わったら、その段が見える所まで送る（小さい画面で譜面が入りきらないとき）
          if (pos.line !== shownStaff) {
            shownStaff = pos.line;
            try {
              rendered.svg.querySelector(`.abcjs-staff-wrapper.abcjs-l${pos.line}`)?.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
            } catch { /* 無視 */ }
          }
        } else {
          line.style.display = "none";
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      line?.remove();
    };
  }, [playhead, melody, result, width, fontsReady]);

  return (
    <div className="score" ref={hostRef}>
      <div ref={paperRef} />
    </div>
  );
}
