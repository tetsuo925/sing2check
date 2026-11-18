// 1 ページ。状態は 準備 → 録音中 → 結果 の 3 つ。シートは「マイクの確認」「設定」「記録」。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CONFIG } from "./audio/config.ts";
import { engine } from "./audio/engine.ts";
import type { PlayGroup } from "./audio/engine.ts";
import { chordNotes, startTake } from "./audio/runTake.ts";
import type { TakeHandle, TakeOutcome } from "./audio/runTake.ts";
import { onPageHidden } from "./audio/session.ts";
import {
  MAX_LEVEL, MIN_LEVEL, levelName, makeExercise, newSeed, parseExerciseHash, resolveTempo, stepTempo, tempoKey, tempoLabel, tempoRange,
} from "./core/exercise.ts";
import { targetNotes } from "./judge/judge.ts";
import { addTakeToState, changeLevel, levelNudge, snoozeNudge } from "./judge/stats.ts";
import { SCHEDULE_LEAD_SEC, scheduleTake, toTakeRecord } from "./judge/take.ts";
import type { TakeSchedule } from "./judge/take.ts";
import { MAX_TAKES, clearRecords, loadSettings, loadState, loadTakes, saveSettings, saveState, saveTakes } from "./storage.ts";
import type { PersistedState, Settings } from "./storage.ts";
import { BeatDisplay } from "./ui/BeatDisplay.tsx";
import { LevelMeter } from "./ui/LevelMeter.tsx";
import { micErrorMessage } from "./ui/micError.ts";
import { PitchChart } from "./ui/PitchChart.tsx";
import type { LiveTrace } from "./ui/PitchChart.tsx";
import { Legend, ResultSummary } from "./ui/ResultSummary.tsx";
import { Score } from "./ui/Score.tsx";
import type { Playhead } from "./ui/Score.tsx";
import { MicCheckSheet } from "./ui/sheets/MicCheckSheet.tsx";
import { RecordsSheet } from "./ui/sheets/RecordsSheet.tsx";
import { SettingsSheet } from "./ui/sheets/SettingsSheet.tsx";
import { TakeControls } from "./ui/TakeControls.tsx";
import type { Phase } from "./ui/TakeControls.tsx";
import { useEngine } from "./ui/useEngine.ts";

type PlayKind = "chord" | "first" | "answer" | "mine";
type SheetName = "mic" | "settings" | "records";

const NO_HINTS = { tonicChord: false, firstNote: false };
/** 再生を予約するときの余裕（秒） */
const PLAY_LEAD_SEC = 0.06;
const FIRST_NOTE_SEC = 1.0;

/** 起動時の課題。URL のハッシュ（#e2e-Lv3-48213）があればそれを使う（テスト用） */
function initialExercise(): { state: PersistedState; seed: number } {
  const state = loadState();
  const fromHash = parseExerciseHash(window.location.hash);
  return fromHash ? { state: changeLevel(state, fromHash.level), seed: fromHash.seed } : { state, seed: newSeed() };
}

export function App() {
  const [initial] = useState(initialExercise);
  const [settings, setSettings] = useState(loadSettings);
  const [persist, setPersist] = useState(initial.state);
  const [takes, setTakes] = useState(loadTakes);
  const [seed, setSeed] = useState(initial.seed);
  const [phase, setPhase] = useState<Phase>("ready");
  const [schedule, setSchedule] = useState<TakeSchedule | null>(null);
  const [outcome, setOutcome] = useState<TakeOutcome | null>(null);
  const [hints, setHints] = useState(NO_HINTS);
  const [micError, setMicError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [playing, setPlaying] = useState<PlayKind | null>(null);
  const [playbackHead, setPlaybackHead] = useState<Playhead | null>(null);
  const [micGranted, setMicGranted] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const takeRef = useRef<TakeHandle | null>(null);
  const playRef = useRef<{ group: PlayGroup; timer: number } | null>(null);
  const { micState } = useEngine();

  const level = persist.level;
  const exercise = useMemo(() => makeExercise(level, seed), [level, seed]);
  const melody = exercise.melody;
  const meter = melody.rhythm.meter;
  const bpm = resolveTempo(persist.tempoByLevel[tempoKey(level, meter)], exercise.defaultTempo);
  const range = tempoRange(exercise.defaultTempo);
  const octaveShift = settings.playbackOctaveDown ? -12 : 0;

  // 記録（localStorage）。使えない状態でも動く
  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { saveState(persist); }, [persist]);
  useEffect(() => { saveTakes(takes); }, [takes]);

  // マイクが許可済みなら「歌うとマイクの使用を確認します。」を出さない
  useEffect(() => {
    let alive = true;
    try {
      navigator.permissions?.query({ name: "microphone" as PermissionName })
        .then((status) => { if (alive) setMicGranted(status.state === "granted"); }, () => { /* 分からなければ出す */ });
    } catch { /* 分からなければ出す */ }
    return () => { alive = false; };
  }, []);

  /* ---------- 再生（主和音・最初の音・正解・自分の歌） ---------- */
  const stopPlayback = useCallback(() => {
    const p = playRef.current;
    if (p) {
      p.group.stop();
      window.clearTimeout(p.timer);
      playRef.current = null;
    }
    setPlaying(null);
    setPlaybackHead(null);
  }, []);

  /** 押したら鳴らす。鳴っている間にもう一度押すと止める。play は終わりの時刻を返す */
  const togglePlay = (kind: PlayKind, play: (group: PlayGroup, t: number) => number) => {
    const wasPlaying = playing === kind;
    stopPlayback();
    if (wasPlaying) return;
    const ctx = engine.ensureContext(); // タップのハンドラの中で同期的に
    const group = engine.newGroup();
    const end = play(group, ctx.currentTime + PLAY_LEAD_SEC);
    const timer = window.setTimeout(() => {
      if (playRef.current?.group !== group) return;
      playRef.current = null;
      setPlaying(null);
      setPlaybackHead(null);
    }, (end - ctx.currentTime) * 1000 + 80);
    playRef.current = { group, timer };
    setPlaying(kind);
  };

  const playChord = () => {
    setHints((h) => ({ ...h, tonicChord: true }));
    togglePlay("chord", (group, t) => engine.chord(group, chordNotes(exercise, settings.playbackOctaveDown), t));
  };

  const playFirstNote = () => {
    setHints((h) => ({ ...h, firstNote: true }));
    togglePlay("first", (group, t) => {
      engine.tone(group, melody.notes[0].midi + octaveShift, t, FIRST_NOTE_SEC);
      return t + FIRST_NOTE_SEC + 0.06;
    });
  };

  /** 正解を聴く: カウント（テイクと同じ拍数）→ 旋律 + 課題中のクリック */
  const playAnswer = () => togglePlay("answer", (group, t) => {
    const s = scheduleTake(t - SCHEDULE_LEAD_SEC, melody, bpm, { chord: false });
    for (const c of s.countClicks) engine.click(group, s.t0 + c.t, c.accent);
    for (const b of s.beats) engine.click(group, s.t0 + b.t, b.accent);
    for (const n of targetNotes(melody, bpm)) engine.tone(group, n.midi + octaveShift, s.t0 + n.onSec, n.offSec - n.onSec);
    setPlaybackHead({ t0: s.t0, bpm });
    return s.t0 + s.totalSec + 0.1;
  });

  /** 自分の歌を聴く: カウントの 1 拍目から余韻の終わりまで（カウントのクリックも聞こえる） */
  const playMine = () => {
    const rec = outcome?.recording;
    if (!rec || !outcome) return;
    togglePlay("mine", (group, t) => {
      setPlaybackHead({ t0: t + (outcome.schedule.t0 - outcome.schedule.tCount), bpm });
      return engine.playPcm(group, rec.pcm, rec.rate, t);
    });
  };

  /* ---------- 課題 ---------- */
  const newExercise = () => {
    stopPlayback();
    setSeed(newSeed());
    setHints(NO_HINTS);
    setOutcome(null);
    setPhase("ready");
  };

  const goLevel = (next: number) => {
    if (next < MIN_LEVEL || next > MAX_LEVEL || phase === "recording") return;
    setPersist((p) => changeLevel(p, next));
    newExercise();
  };

  const changeTempo = (direction: 1 | -1) => {
    const next = stepTempo(bpm, direction, exercise.defaultTempo);
    setPersist((p) => ({ ...p, tempoByLevel: { ...p.tempoByLevel, [tempoKey(level, meter)]: next } }));
  };

  /* ---------- テイク ---------- */
  /** 「歌う」: タップのハンドラの中で呼ぶ（AudioContext と getUserMedia のため） */
  const sing = () => {
    if (takeRef.current) return;
    stopPlayback();
    setMicError(null);
    let handle: TakeHandle;
    try {
      handle = startTake(engine, exercise, bpm, settings);
    } catch (e) {
      setMicError(micErrorMessage(e));
      return;
    }
    takeRef.current = handle;
    setSchedule(null);
    setOutcome(null);
    setPhase("recording");
    void handle.scheduled.then((s) => { if (takeRef.current === handle) setSchedule(s); });
    handle.done.then((result) => {
      if (takeRef.current !== handle) return; // やめた・別のテイクが始まった
      takeRef.current = null;
      setSchedule(null);
      if (!result) { setPhase("ready"); return; }
      if (result.analysis.frameCount === 0) {
        setMicError("マイクから音が届きませんでした。「マイク」を開いて入力を確認してください。");
        setPhase("ready");
        return;
      }
      // 結果を出した時点でテイクを記録する
      const record = toTakeRecord(exercise, bpm, result.analysis.result, settings, hints, new Date());
      setTakes((prev) => [record, ...prev].slice(0, MAX_TAKES));
      setPersist((p) => addTakeToState(p, record));
      setOutcome(result);
      setPhase("result");
    }, (e: unknown) => {
      if (takeRef.current !== handle) return;
      takeRef.current = null;
      setSchedule(null);
      setMicError(micErrorMessage(e));
      setPhase("ready");
    });
  };

  const cancelTake = () => {
    takeRef.current?.cancel();
    takeRef.current = null;
    setSchedule(null);
    setPhase("ready");
  };

  // バックグラウンドに回ったら: テイクを捨て、再生を止め、マイクを閉じる。次のタップで取り直す
  useEffect(() => onPageHidden(() => {
    takeRef.current?.cancel();
    takeRef.current = null;
    stopPlayback();
    engine.closeMic();
    setSchedule(null);
    setPhase((p) => (p === "recording" ? "ready" : p));
  }), [stopPlayback]);

  // 状態が変わったら先頭から見せる（録音中に譜面を送った位置のままにしない）
  useEffect(() => { mainRef.current?.scrollTo(0, 0); }, [phase, seed]);

  /* ---------- 表示の準備 ---------- */
  const recordingHead = useMemo<Playhead | null>(() => (schedule ? { t0: schedule.t0, bpm } : null), [schedule, bpm]);
  const playhead = phase === "recording" ? recordingHead : playbackHead;

  const live = useMemo<LiveTrace | null>(() => {
    if (!schedule || !settings.showPitchWhileSinging || !takeRef.current) return null;
    return {
      frames: takeRef.current.frames,
      t0: schedule.t0,
      roundTripSec: (settings.roundTripMs ?? 0) / 1000,
      gateDb: settings.gateDb,
      minClarity: DEFAULT_CONFIG.minClarity,
      now: () => engine.currentTime,
    };
  }, [schedule, settings.showPitchWhileSinging, settings.roundTripMs, settings.gateDb]);

  const patchSettings = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const nudge = phase === "ready" ? levelNudge(persist, MAX_LEVEL) : null;
  const busy = phase === "recording";
  const result = phase === "result" && outcome ? outcome.analysis.result : null;

  return (
    <div className="app" data-phase={phase}>
      <header className="header">
        <h1 className="title">視唱チェッカー</h1>
        <nav className="header-actions" aria-label="メニュー">
          <button type="button" id="button-open-mic" className="button is-text" onClick={() => setSheet("mic")} disabled={busy}>マイク</button>
          <button type="button" id="button-open-records" className="button is-text" onClick={() => setSheet("records")} disabled={busy}>記録</button>
          <button type="button" id="button-open-settings" className="button is-text" onClick={() => setSheet("settings")} disabled={busy}>設定</button>
        </nav>
      </header>

      <main className="main" ref={mainRef}>
        {micError && (
          <div className="banner is-error" role="alert" id="mic-error">
            <p>{micError}</p>
            <button type="button" className="button is-text" onClick={() => setMicError(null)}>閉じる</button>
          </div>
        )}
        {nudge && (
          <div className="banner is-nudge" id="level-nudge">
            <p>{nudge.message}</p>
            <div className="banner-actions">
              <button type="button" id="button-nudge-accept" className="button is-primary" onClick={() => goLevel(nudge.targetLevel)}>{nudge.kind === "up" ? "進む" : "戻る"}</button>
              <button type="button" id="button-nudge-dismiss" className="button" onClick={() => setPersist(snoozeNudge)}>{nudge.kind === "up" ? "まだ続ける" : "このまま"}</button>
            </div>
          </div>
        )}

        <section className="exercise" aria-label="課題">
          {/* 録音中は譜面を広く見せる（レベルとテンポの行は隠す） */}
          <div className="level-switch" hidden={busy}>
            <button type="button" id="button-level-down" className="button is-square" onClick={() => goLevel(level - 1)} disabled={busy || level <= MIN_LEVEL} aria-label="前のレベル">‹</button>
            <p className="level" id="level-label">
              <span className="level-number">Lv {level}</span>
              <span className="level-name">{levelName(level)}</span>
            </p>
            <button type="button" id="button-level-up" className="button is-square" onClick={() => goLevel(level + 1)} disabled={busy || level >= MAX_LEVEL} aria-label="次のレベル">›</button>
          </div>

          <div className="meta" hidden={busy}>
            <span className="meta-id" id="exercise-id">{exercise.id}</span>
            <span className="meta-tonic">主音は{melody.tonicName}</span>
            <span className="meta-tempo">
              {phase === "ready" && (
                <button type="button" id="button-tempo-down" className="button is-square is-small" onClick={() => changeTempo(-1)} disabled={bpm <= range.min} aria-label="テンポを遅く">−</button>
              )}
              <span id="tempo-label" className="tempo">{tempoLabel(meter, bpm)}</span>
              {phase === "ready" && (
                <button type="button" id="button-tempo-up" className="button is-square is-small" onClick={() => changeTempo(1)} disabled={bpm >= range.max} aria-label="テンポを速く">＋</button>
              )}
            </span>
          </div>

          {/* 合否は譜面より上に置く（小さい画面でも、結果が出たらまず合否が見える） */}
          {phase === "result" && outcome && <ResultSummary outcome={outcome} roundTripMeasured={settings.roundTripMs !== null} />}

          <div className="score-card">
            <Score melody={melody} result={result} playhead={playhead} />
          </div>
          {phase === "result" && <Legend />}
        </section>

        {phase === "ready" && (
          <section className="aids" aria-label="基準の音">
            <div className="button-row">
              <button type="button" id="button-chord" className="button is-grow" onClick={playChord} aria-pressed={playing === "chord"}>{playing === "chord" ? "■ 停止" : "主和音"}</button>
              <button type="button" id="button-first-note" className="button is-grow" onClick={playFirstNote} aria-pressed={playing === "first"}>{playing === "first" ? "■ 停止" : "最初の音"}</button>
            </div>
            {!micGranted && micState !== "open" && !engine.micEverOpened && <p className="hint" id="mic-hint">歌うとマイクの使用を確認します。</p>}
          </section>
        )}

        {phase === "result" && outcome && (
          <>
            <PitchChart melody={melody} bpm={bpm} result={outcome.analysis.result} height={190} />
            <div className="button-row">
              <button type="button" id="button-play-mine" className="button is-grow" onClick={playMine} disabled={!outcome.recording} aria-pressed={playing === "mine"}>{playing === "mine" ? "■ 停止" : "自分の歌を聴く"}</button>
              <button type="button" id="button-play-answer" className="button is-grow" onClick={playAnswer} aria-pressed={playing === "answer"}>{playing === "answer" ? "■ 停止" : "正解を聴く"}</button>
            </div>
          </>
        )}
      </main>

      {/* 拍の表示は譜面の長さに関係なく、いつも見える所（下のボタンの上）に置く */}
      {phase === "recording" && (
        <section className="recording" aria-label="録音中">
          <BeatDisplay schedule={schedule} />
          {live ? <PitchChart melody={melody} bpm={bpm} live={live} height={96} /> : <LevelMeter />}
        </section>
      )}

      <TakeControls phase={phase} onSing={sing} onCancel={cancelTake} onRetry={sing} onNext={newExercise} />

      {sheet === "mic" && <MicCheckSheet settings={settings} onPatch={patchSettings} onClose={() => setSheet(null)} />}
      {sheet === "settings" && <SettingsSheet settings={settings} onPatch={patchSettings} onClose={() => setSheet(null)} onOpenMicCheck={() => setSheet("mic")} />}
      {sheet === "records" && (
        <RecordsSheet takes={takes} state={persist} onClose={() => setSheet(null)}
          onClear={() => { setPersist(clearRecords(persist)); setTakes([]); }} />
      )}
    </div>
  );
}
