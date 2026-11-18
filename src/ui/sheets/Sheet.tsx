// シート（画面の下から出る <dialog>）。Esc・背景のタップ・「閉じる」で閉じる。
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface Props {
  id: string;
  title: string;
  onClose(): void;
  children: ReactNode;
}

export function Sheet({ id, title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  return (
    <dialog
      ref={ref}
      id={id}
      className="sheet"
      aria-labelledby={`${id}-title`}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div className="sheet-panel">
        <header className="sheet-header">
          <h2 id={`${id}-title`} className="sheet-title">{title}</h2>
          <button type="button" className="button is-text" onClick={onClose}>閉じる</button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </dialog>
  );
}

/** −／＋ で値を変える部品 */
export function Stepper({ id, value, label, onStep, canDown, canUp }: {
  id: string; value: string; label: string; onStep(direction: 1 | -1): void; canDown: boolean; canUp: boolean;
}) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" id={`${id}-down`} className="button is-square" onClick={() => onStep(-1)} disabled={!canDown} aria-label={`${label}を下げる`}>−</button>
      <output id={id} className="stepper-value">{value}</output>
      <button type="button" id={`${id}-up`} className="button is-square" onClick={() => onStep(1)} disabled={!canUp} aria-label={`${label}を上げる`}>＋</button>
    </span>
  );
}
