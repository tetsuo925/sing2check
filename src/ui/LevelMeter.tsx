// 入力レベルの細いメーター（−70〜0dBFS）。声が入っているかが分かればよい。
import { useEffect, useRef } from "react";
import { engine } from "../audio/engine.ts";

const FLOOR_DB = -70;
const position = (db: number) => Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));

/** gateDb を渡すと、ゲート（設定値）の位置に印を出す */
export function LevelMeter({ gateDb, label = "入力レベル" }: { gateDb?: number; label?: string }) {
  const fill = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const set = (db: number) => { if (fill.current) fill.current.style.transform = `scaleX(${position(db)})`; };
    const offLevel = engine.subscribe((msg) => { if (msg.type === "level") set(msg.rmsDb); });
    const offChange = engine.onChange(() => { if (engine.micState !== "open") set(FLOOR_DB); });
    return () => { offLevel(); offChange(); };
  }, []);

  return (
    <div className="meter" role="img" aria-label={label}>
      <div className="meter-fill" ref={fill} />
      {gateDb !== undefined && <div className="meter-gate" style={{ left: `${position(gateDb) * 100}%` }} />}
    </div>
  );
}
