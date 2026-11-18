// 結果のまとめ: 合否・まとめ 1 行・注意（ハンドオフ文書 §5.4、§11.3）と、記号の凡例
import type { TakeOutcome } from "../audio/runTake.ts";
import { summaryLine, timingReliable } from "../judge/stats.ts";
import { STATUS_LABEL, STATUS_MARK } from "./scoreRender.ts";

const kHz = (hz: number) => `${Math.round(hz / 100) / 10}kHz`;

export function ResultSummary({ outcome, roundTripMeasured }: { outcome: TakeOutcome; roundTripMeasured: boolean }) {
  const { result, latencyChanged } = outcome.analysis;
  const rate = outcome.rateCheck;
  return (
    <section className="result" data-passed={result.passed} data-correct={result.correct} data-count={result.count} data-offset-ms={result.offsetMs}>
      <p className={`verdict ${result.passed ? "is-pass" : "is-fail"}`}>
        <span className="verdict-mark" aria-hidden="true">{result.passed ? "◯" : "✕"}</span>
        {result.passed ? "合格" : "もう一度"}
      </p>
      <p className="summary">
        {summaryLine(result)}
        {!roundTripMeasured && timingReliable(result) && <span className="summary-note">（機器の遅れを含む）</span>}
      </p>
      {(rate && !rate.ok) || latencyChanged || outcome.gaps > 0 ? (
        <ul className="notices">
          {rate && !rate.ok && <li>マイクの入力が不安定です（実効 {kHz(rate.measuredRate)} / 想定 {kHz(rate.nominalRate)}）。マイクの確認をしてください。</li>}
          {latencyChanged && <li>機器の遅れが測ったときと変わったようです（マイクの確認で測り直してください）。</li>}
          {outcome.gaps > 0 && <li>録音が {outcome.gaps} 回途切れました。判定が正しく出ていないかもしれません。</li>}
        </ul>
      ) : null}
    </section>
  );
}

/** 譜面の色と記号の意味 */
export function Legend() {
  return (
    <ul className="legend" aria-label="記号の意味">
      {(["good", "ok", "wrong", "silent"] as const).map((s) => (
        <li key={s} className={`legend-item judge-text-${s}`}><span aria-hidden="true">{STATUS_MARK[s]}</span> {STATUS_LABEL[s]}</li>
      ))}
    </ul>
  );
}
