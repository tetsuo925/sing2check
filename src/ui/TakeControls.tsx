// 画面下の主ボタンの帯。準備 =「歌う」、録音中 =「やめる」、結果 =「同じ課題でもう一度」「次の課題」
export type Phase = "ready" | "recording" | "result";

interface Props {
  phase: Phase;
  onSing(): void;
  onCancel(): void;
  onRetry(): void;
  onNext(): void;
}

export function TakeControls({ phase, onSing, onCancel, onRetry, onNext }: Props) {
  return (
    <footer className="actionbar">
      {phase === "ready" && <button type="button" id="button-sing" className="button is-primary is-wide" onClick={onSing}>歌う</button>}
      {phase === "recording" && <button type="button" id="button-cancel" className="button is-wide" onClick={onCancel}>やめる</button>}
      {phase === "result" && (
        <>
          <button type="button" id="button-retry" className="button is-grow" onClick={onRetry}>同じ課題でもう一度</button>
          <button type="button" id="button-next" className="button is-primary is-grow" onClick={onNext}>次の課題</button>
        </>
      )}
    </footer>
  );
}
