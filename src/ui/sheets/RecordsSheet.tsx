// 記録シート（ハンドオフ文書 §14.2）
import { useState } from "react";
import {
  buildCopyText, dailyCounts, levelSummary, pitchLine, timingLine, topConfusions, weakIntervals, weakSolfa,
} from "../../judge/stats.ts";
import type { AccuracyRow } from "../../judge/stats.ts";
import type { PersistedState, TakeRecord } from "../../storage.ts";
import { Sheet } from "./Sheet.tsx";

interface Props {
  takes: TakeRecord[];
  state: PersistedState;
  onClear(): void;
  onClose(): void;
}

const NONE = "まだ記録がありません";

function AccuracyList({ rows }: { rows: AccuracyRow[] }) {
  if (!rows.length) return <p className="record-none">{NONE}</p>;
  return (
    <ul className="record-rows">
      {rows.map((r) => (
        <li key={r.label} className="record-row">
          <span className="record-row-label">{r.label}</span>
          <span className="record-row-bar" aria-hidden="true"><span style={{ width: `${r.percent}%` }} /></span>
          <span className="record-row-value">正答 {r.percent}%<small>（{r.correct}/{r.total}）</small></span>
        </li>
      ))}
    </ul>
  );
}

export function RecordsSheet({ takes, state, onClear, onClose }: Props) {
  const [copied, setCopied] = useState<"ok" | "ng" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const now = new Date();
  const level = levelSummary(state);
  const days = dailyCounts(takes, now);
  const maxPerDay = Math.max(1, ...days.map((d) => d.takes));
  const confusions = topConfusions(takes);

  // navigator.clipboard.writeText はタップのハンドラの中で呼ぶ
  const copy = () => {
    const text = buildCopyText(takes, state, new Date());
    const done = (ok: boolean) => setCopied(ok ? "ok" : "ng");
    try {
      if (!navigator.clipboard?.writeText) { done(false); return; }
      navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    } catch {
      done(false);
    }
  };

  return (
    <Sheet id="sheet-records" title="記録" onClose={onClose}>
      <section className="record-section">
        <h3 className="record-heading">Lv{level.level} の合格率</h3>
        {level.recentPercent === null
          ? <p className="record-none">{NONE}</p>
          : <p className="record-big"><span className="record-number">{level.recentPercent}%</span> 直近 {level.recentCount} 回・累計 {level.totalTakes} 回</p>}
      </section>

      <section className="record-section">
        <h3 className="record-heading">直近 14 日</h3>
        {days.every((d) => d.takes === 0)
          ? <p className="record-none">{NONE}</p>
          : (
            <div className="days" role="img" aria-label={days.filter((d) => d.takes).map((d) => `${d.label} ${d.takes}回 合格 ${d.passed}`).join("、")}>
              {days.map((d) => (
                <div key={d.localDate} className="day">
                  <div className="day-bars">
                    <span className="day-bar" style={{ height: `${(d.takes / maxPerDay) * 100}%` }}>
                      <span className="day-bar-passed" style={{ height: d.takes ? `${(d.passed / d.takes) * 100}%` : 0 }} />
                    </span>
                  </div>
                  <span className="day-label">{d.label.split("/")[1]}</span>
                </div>
              ))}
            </div>
          )}
        <p className="record-caption">棒 = テイク数、濃い部分 = 合格</p>
      </section>

      <section className="record-section">
        <h3 className="record-heading">音程とタイミング（直近 20 テイク）</h3>
        <p className="record-line">{pitchLine(takes).replace(/^音程: /, "")}</p>
        <p className="record-line">{timingLine(takes).replace(/^タイミング: /, "")}</p>
      </section>

      <section className="record-section">
        <h3 className="record-heading">外しやすい階名</h3>
        <AccuracyList rows={weakSolfa(takes)} />
      </section>
      <section className="record-section">
        <h3 className="record-heading">外しやすい音程</h3>
        <AccuracyList rows={weakIntervals(takes)} />
      </section>
      <section className="record-section">
        <h3 className="record-heading">取り違え</h3>
        {confusions.length
          ? <p className="record-line">{confusions.map((c) => `${c.label} ×${c.count}`).join("、")}</p>
          : <p className="record-none">{NONE}</p>}
      </section>

      <div className="sheet-actions">
        <button type="button" id="button-copy" className="button is-primary" onClick={copy}>結果をコピー</button>
        <button type="button" id="button-clear" className="button" onClick={() => setConfirming(true)} disabled={!takes.length && level.totalTakes === 0}>記録を消す</button>
      </div>
      <p className="sheet-status" role="status">
        {copied === "ok" && "コピーしました。Claude などに貼り付けられます。"}
        {copied === "ng" && "コピーできませんでした。"}
      </p>
      {confirming && (
        <div className="confirm" role="alertdialog" aria-labelledby="confirm-clear-text">
          <p id="confirm-clear-text">テイクの記録（{takes.length} 件）と合格率を消します。設定と往復の遅れは残ります。</p>
          <div className="sheet-actions">
            <button type="button" id="button-clear-yes" className="button is-danger" onClick={() => { onClear(); setConfirming(false); setCopied(null); }}>消す</button>
            <button type="button" id="button-clear-no" className="button" onClick={() => setConfirming(false)}>やめる</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
