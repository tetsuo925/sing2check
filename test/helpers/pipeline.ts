// 録音 1 テイク分のサンプル → フレーム → 判定、を通しで行う（テスト・オフライン用）。
// アプリではフレームはワークレットから届くので、analyzeBuffer の代わりにそれを集めて judgeTake に渡す。
import type { Sing2CheckConfig } from "../../src/audio/config.ts";
import { analyzeBuffer } from "../../src/audio/dsp.ts";
import type { Frame } from "../../src/audio/dsp.ts";
import { judgeTake } from "../../src/judge/judge.ts";
import type { TargetNote, TakeResult } from "../../src/judge/judge.ts";

export interface PipelineInput {
  samples: Float32Array;
  sampleRate: number;
  /** samples[0] の時刻（秒、課題時間。課題開始 = 0） */
  startTime: number;
  notes: TargetNote[];
  /** 課題中に鳴らしたクリックの時刻（秒、課題時間） */
  clickTimes: number[];
  /**
   * スピーカー → マイクの往復遅延（秒）。分かっていればフレームの時刻から引いて時間軸を補正する。
   * 分からなければ 0（Δ 合わせが吸収する。クリックのマスクは clickLatencySec で合わせる）。
   */
  roundTripSec: number;
  /** 補正していない分のクリック遅延（秒）。通常 0 */
  clickLatencySec?: number;
}

export function runPipeline(inp: PipelineInput, cfg: Sing2CheckConfig): { frames: Frame[]; result: TakeResult } {
  const raw = analyzeBuffer(inp.samples, inp.sampleRate, inp.startTime, cfg);
  const frames = raw.map((f) => ({ ...f, t: f.t - inp.roundTripSec }));
  const result = judgeTake(inp.notes, frames, {
    config: cfg,
    frameDurSec: cfg.frameSize * cfg.decimation / inp.sampleRate,
    clickTimes: inp.clickTimes,
    clickLatencySec: inp.clickLatencySec ?? 0,
  });
  return { frames, result };
}
