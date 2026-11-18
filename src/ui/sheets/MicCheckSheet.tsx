// マイクの確認シート（ハンドオフ文書 §12）: 入力レベル・チューナー・自己点検・ループバック試験
import { useEffect, useRef, useState } from "react";
import { DEFAULT_CONFIG } from "../../audio/config.ts";
import type { Frame } from "../../audio/dsp.ts";
import { engine } from "../../audio/engine.ts";
import type { LoopbackResult } from "../../audio/loopback.ts";
import { TUNER_TAKE_ID, unpackFrames } from "../../audio/messages.ts";
import { cancelLoopbackTest, runLoopbackTest } from "../../audio/runTake.ts";
import { signed } from "../../judge/stats.ts";
import type { Settings } from "../../storage.ts";
import { GATE_MAX_DB, GATE_MIN_DB, GATE_STEP_DB } from "../../storage.ts";
import { dbLabel, groupDigits, noteNameOf, shortDateTime } from "../format.ts";
import { LevelMeter } from "../LevelMeter.tsx";
import { micErrorMessage } from "../micError.ts";
import { useEngine } from "../useEngine.ts";
import { Sheet, Stepper } from "./Sheet.tsx";

interface Props {
  settings: Settings;
  /** 設定の一部を書き換える */
  onPatch(patch: Partial<Settings>): void;
  onClose(): void;
}

const TUNER_FRAMES = 5;
const EARPHONE_NOTE = "イヤホンでは測れません（判定では全体の時間ずれとして自動で合わせます）。";

function median(a: number[]): number {
  const s = a.slice().sort((x, y) => x - y), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** 検出中の音名とセント。最新 5 フレームの中央値。無声なら — */
function Tuner({ gateDb }: { gateDb: number }) {
  const [reading, setReading] = useState<{ name: string; cents: number; hz: number } | null>(null);
  const recent = useRef<Frame[]>([]);

  useEffect(() => {
    recent.current = [];
    return engine.subscribe((msg) => {
      if (msg.type !== "frames" || msg.takeId !== TUNER_TAKE_ID) return;
      const frames = recent.current.concat(unpackFrames(msg.data)).slice(-TUNER_FRAMES);
      recent.current = frames;
      const voiced = frames.filter((f) => f.f0 !== null && f.clarity >= DEFAULT_CONFIG.minClarity && f.rmsDb >= gateDb).map((f) => f.f0 as number);
      if (voiced.length < 3) { setReading(null); return; }
      const hz = median(voiced);
      setReading({ ...noteNameOf(hz), hz });
    });
  }, [gateDb]);

  return (
    <div className="tuner" aria-live="off">
      <span className="tuner-name">{reading ? reading.name : "—"}</span>
      <span className="tuner-cents">{reading ? `${signed(reading.cents)} セント` : "声を出すと音名が出ます"}</span>
      {reading && <span className="tuner-hz">{reading.hz.toFixed(1)}Hz</span>}
    </div>
  );
}

function loopbackText(r: LoopbackResult): { main: string; warnings: string[]; usable: boolean } {
  if (r.roundTripMs === null) return { main: "測れませんでした。", warnings: [EARPHONE_NOTE], usable: false };
  const warnings: string[] = [];
  const pitch = r.detectedHz === null || r.centsError === null ? "高さは検出できず" : `検出 ${r.detectedHz.toFixed(1)}Hz（${signed(r.centsError)} セント）`;
  if (r.pitchAbnormal && r.centsError !== null) {
    warnings.push(`高さが ${Math.round(Math.abs(r.centsError))} セントずれて聞こえています。入力のサンプルレートが合っていない可能性があります。判定が正しく出ません。`);
  }
  if (r.unstable) warnings.push("4 回の遅れが 10ms 以上ばらつきました。測り直してください。");
  return { main: `${pitch}／往復の遅れ ${Math.round(r.roundTripMs)}ms`, warnings, usable: !r.pitchAbnormal && !r.unstable };
}

export function MicCheckSheet({ settings, onPatch, onClose }: Props) {
  const { micState, micInfo, rateCheck } = useEngine();
  const [error, setError] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [loopback, setLoopback] = useState<LoopbackResult | null>(null);

  // シートを閉じたら、測っている途中のループバック試験をやめる
  useEffect(() => cancelLoopbackTest, []);

  // マイクが開いている間だけ解析する。閉じたら止める
  useEffect(() => {
    if (micState !== "open") return;
    engine.post({ type: "analyze", on: true });
    return () => engine.post({ type: "analyze", on: false });
  }, [micState]);

  const openMic = () => {
    setError(null);
    engine.openMic().catch((e: unknown) => setError(micErrorMessage(e)));
  };

  const measure = () => {
    engine.ensureContext();
    setMeasuring(true);
    setLoopback(null);
    runLoopbackTest(engine)
      .then((r) => {
        setLoopback(r);
        if (r.roundTripMs !== null && !r.pitchAbnormal && !r.unstable) {
          onPatch({ roundTripMs: Math.round(r.roundTripMs * 10) / 10, roundTripMeasuredAt: new Date().toISOString() });
        }
      })
      .catch(() => setLoopback({ roundTripMs: null, perBeepMs: [], detectedHz: null, centsError: null, pitchAbnormal: false, unstable: false }))
      .finally(() => setMeasuring(false));
  };

  const info = micInfo;
  const result = loopback ? loopbackText(loopback) : null;

  return (
    <Sheet id="sheet-mic" title="マイクの確認" onClose={onClose}>
      {error && <p className="banner is-error" role="alert">{error}</p>}

      {micState !== "open" ? (
        <section className="record-section">
          <p className="sheet-text">マイクを開いて、声が入っているか・音の高さが正しく取れているかを確かめます。</p>
          <button type="button" id="button-mic-open" className="button is-primary" onClick={openMic} disabled={micState === "opening"}>
            {micState === "opening" ? "マイクを開いています…" : "マイクを使う"}
          </button>
        </section>
      ) : (
        <>
          <section className="record-section">
            <h3 className="record-heading">入力レベル</h3>
            <LevelMeter gateDb={settings.gateDb} />
            <div className="meter-scale" aria-hidden="true"><span>−70</span><span>ゲート {dbLabel(settings.gateDb)}</span><span>0dBFS</span></div>
            <div className="setting is-plain">
              <span className="setting-text"><span className="setting-label">入力のゲート</span>
                <span className="setting-note">黙っているときのメーターより右、歌っているときより左に置きます。</span></span>
              <Stepper id="mic-gate" label="入力のゲート" value={dbLabel(settings.gateDb)}
                canDown={settings.gateDb > GATE_MIN_DB} canUp={settings.gateDb < GATE_MAX_DB}
                onStep={(d) => onPatch({ gateDb: Math.min(GATE_MAX_DB, Math.max(GATE_MIN_DB, settings.gateDb + d * GATE_STEP_DB)) })} />
            </div>
          </section>

          <section className="record-section">
            <h3 className="record-heading">検出中の音</h3>
            <Tuner gateDb={settings.gateDb} />
          </section>

          <section className="record-section">
            <h3 className="record-heading">入力の点検</h3>
            <p className="record-line" id="mic-rate">
              {rateCheck
                ? <>実効サンプルレート {groupDigits(rateCheck.measuredRate)}Hz（想定 {groupDigits(rateCheck.nominalRate)}Hz）
                  <span className={rateCheck.ok ? "judge-text-good" : "judge-text-wrong"}> {rateCheck.ok ? "◯" : "✕"}</span></>
                : "実効サンプルレート 測定中…"}
            </p>
            {rateCheck && !rateCheck.ok && (
              <p className="banner is-warn">
                {rateCheck.dropped ? "マイクの入力が途切れています。" : "マイクの入力の速さが想定と合っていません。"}判定が正しく出ないことがあります。ページを再読み込みするか、イヤホンやマイクをつなぎ直してください。
              </p>
            )}
            {info && (
              <p className="record-caption" id="mic-settings">
                エコー除去 {info.echoCancellation === null ? "不明" : info.echoCancellation ? "ON" : "OFF"}
                ・{info.sampleRate === null ? "サンプルレート不明" : `${groupDigits(info.sampleRate)}Hz`}
                ・{info.channelCount === null ? "チャンネル数不明" : `${info.channelCount}ch`}
                {info.label && `・${info.label}`}
              </p>
            )}
          </section>

          <section className="record-section">
            <h3 className="record-heading">往復の遅れ（スピーカーで使うとき）</h3>
            <p className="sheet-text">440Hz の音を 4 回鳴らしてマイクで拾い、スピーカーからマイクまでの遅れを測ります。測った値は時刻の補正に使います。</p>
            <button type="button" id="button-loopback" className="button" onClick={measure} disabled={measuring}>
              {measuring ? "測っています…" : "スピーカーで測る"}
            </button>
            <p className="record-line" id="loopback-result" role="status">
              {result ? result.main : settings.roundTripMs !== null
                ? `保存した値: ${Math.round(settings.roundTripMs)}ms${settings.roundTripMeasuredAt ? `（${shortDateTime(settings.roundTripMeasuredAt)} に測定）` : ""}`
                : "未測定"}
              {result?.usable && "（保存しました）"}
            </p>
            {result?.warnings.map((w) => <p key={w} className="banner is-warn">{w}</p>)}
            {!result && <p className="record-caption">{EARPHONE_NOTE}</p>}
          </section>
        </>
      )}

      <p className="sheet-note">Bluetooth イヤホンは、マイクを使うと通話用の接続に切り替わり、遅れと音質が悪くなりやすいです。有線イヤホンか本体のスピーカーを使ってください。</p>
    </Sheet>
  );
}
