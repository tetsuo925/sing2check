// 録音中の大きな拍の表示。カウント中は「カウント 1 2 3 4」、課題中は小節番号と拍（「2 小節目 ・ 1 2」）。
// クリック音を OFF にしても常に出す。
import { useEffect, useState } from "react";
import { engine } from "../audio/engine.ts";
import { beatPosition } from "../judge/take.ts";
import type { BeatPosition, TakeSchedule } from "../judge/take.ts";

function Numbers({ count, perBar, current }: { count: number; perBar: number; current: number }) {
  return (
    <span className="beat-numbers">
      {Array.from({ length: count }, (_, k) => (
        <span key={k} className={`beat-number${k === current ? " is-now" : ""}${k % perBar === 0 && k > 0 ? " is-bar-start" : ""}`}>
          {(k % perBar) + 1}
        </span>
      ))}
    </span>
  );
}

export function BeatDisplay({ schedule }: { schedule: TakeSchedule | null }) {
  const [pos, setPos] = useState<BeatPosition | null>(null);

  useEffect(() => {
    if (!schedule) { setPos(null); return; }
    let raf = 0, key = "";
    const tick = () => {
      const p = beatPosition(schedule, engine.visualTime());
      const k = JSON.stringify(p);
      if (k !== key) { key = k; setPos(p); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [schedule]);

  if (!schedule || !pos) return <div className="beat"><span className="beat-label">マイクを準備しています…</span></div>;
  if (pos.phase === "chord") return <div className="beat"><span className="beat-label">主和音</span></div>;
  if (pos.phase === "tail") return <div className="beat"><span className="beat-label">余韻</span></div>;
  if (pos.phase === "count") {
    return (
      <div className="beat">
        <span className="beat-label">カウント</span>
        <Numbers count={schedule.countBeats} perBar={schedule.beatsPerBar} current={pos.index} />
      </div>
    );
  }
  return (
    <div className="beat">
      <span className="beat-label">{pos.bar + 1} 小節目</span>
      <span className="beat-sep" aria-hidden="true">・</span>
      <Numbers count={schedule.beatsPerBar} perBar={schedule.beatsPerBar} current={pos.beatInBar} />
    </div>
  );
}
