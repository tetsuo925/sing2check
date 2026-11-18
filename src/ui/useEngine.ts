import { useSyncExternalStore } from "react";
import { engine } from "../audio/engine.ts";
import type { MicInfo, MicState, RateCheck } from "../audio/engine.ts";

export interface EngineSnapshot { micState: MicState; micInfo: MicInfo | null; rateCheck: RateCheck | null }

let snapshot: EngineSnapshot = { micState: engine.micState, micInfo: engine.micInfo, rateCheck: engine.rateCheck };

function subscribe(onChange: () => void): () => void {
  return engine.onChange(() => {
    snapshot = { micState: engine.micState, micInfo: engine.micInfo, rateCheck: engine.rateCheck };
    onChange();
  });
}

/** マイクの状態と自己点検の結果（変わったら描き直す） */
export function useEngine(): EngineSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}
