// 設定シート（ハンドオフ文書 §13）
import type { Settings } from "../../storage.ts";
import { GATE_MAX_DB, GATE_MIN_DB, GATE_STEP_DB } from "../../storage.ts";
import { dbLabel, shortDateTime } from "../format.ts";
import { Sheet, Stepper } from "./Sheet.tsx";

interface Props {
  settings: Settings;
  /** 設定の一部を書き換える */
  onPatch(patch: Partial<Settings>): void;
  onClose(): void;
  onOpenMicCheck(): void;
}

function Toggle({ id, label, note, checked, onChange }: { id: string; label: string; note?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="setting" htmlFor={id}>
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        {note && <span className="setting-note">{note}</span>}
      </span>
      <input id={id} type="checkbox" className="switch" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function SettingsSheet({ settings, onPatch, onClose, onOpenMicCheck }: Props) {
  const set = onPatch;
  return (
    <Sheet id="sheet-settings" title="設定" onClose={onClose}>
      <div className="setting-list">
        <Toggle id="setting-chord" label="歌う前に主和音を鳴らす" checked={settings.chordBeforeTake} onChange={(v) => set({ chordBeforeTake: v })} />
        <Toggle id="setting-clicks" label="課題中のクリック音" note="切っても拍の表示は出ます。カウントのクリックは常に鳴ります。"
          checked={settings.clicksDuringTake} onChange={(v) => set({ clicksDuringTake: v })} />
        <Toggle id="setting-live-pitch" label="歌っている間ピッチの軌跡を表示" checked={settings.showPitchWhileSinging} onChange={(v) => set({ showPitchWhileSinging: v })} />
        <div className="setting">
          <label className="setting-text" htmlFor="setting-octave"><span className="setting-label">再生する高さ</span>
            <span className="setting-note">主和音・最初の音・正解の旋律。譜面と判定は変わりません。</span></label>
          <select id="setting-octave" className="select" value={settings.playbackOctaveDown ? "down" : "written"}
            onChange={(e) => set({ playbackOctaveDown: e.target.value === "down" })}>
            <option value="written">表記どおり</option>
            <option value="down">1 オクターブ下</option>
          </select>
        </div>
        <div className="setting">
          <span className="setting-text"><span className="setting-label">入力のゲート</span>
            <span className="setting-note">これより小さい音は声として扱いません。「マイク」のメーターを見て決めます。</span></span>
          <Stepper id="setting-gate" label="入力のゲート" value={dbLabel(settings.gateDb)}
            canDown={settings.gateDb > GATE_MIN_DB} canUp={settings.gateDb < GATE_MAX_DB}
            onStep={(d) => set({ gateDb: Math.min(GATE_MAX_DB, Math.max(GATE_MIN_DB, settings.gateDb + d * GATE_STEP_DB)) })} />
        </div>
        <div className="setting">
          <span className="setting-text"><span className="setting-label">往復の遅れ</span>
            <span className="setting-note">
              {settings.roundTripMs === null
                ? "未測定（判定では全体の時間ずれとして自動で合わせます）"
                : `${Math.round(settings.roundTripMs)}ms${settings.roundTripMeasuredAt ? `（${shortDateTime(settings.roundTripMeasuredAt)} に測定）` : ""}`}
            </span></span>
          {settings.roundTripMs === null
            ? <button type="button" id="setting-roundtrip-measure" className="button" onClick={onOpenMicCheck}>測る</button>
            : <button type="button" id="setting-roundtrip-clear" className="button" onClick={() => set({ roundTripMs: null, roundTripMeasuredAt: null })}>消す</button>}
        </div>
      </div>
      <p className="sheet-note">
        音が出ないときは、本体の消音モードと音量を確認してください。Bluetooth イヤホンは遅れと音質が悪くなりやすいので、有線イヤホンか本体のスピーカーを使ってください。
      </p>
    </Sheet>
  );
}
