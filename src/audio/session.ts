// iOS Safari の音声セッション・画面消灯の防止・バックグラウンド移行（ハンドオフ文書 §16）。
// どれも機能検出して使い、失敗は無視する。実機での挙動は README のチェックリストで確かめる。

type AudioSessionType = "auto" | "playback" | "play-and-record";

/** navigator.audioSession.type を設定する（Safari のみ） */
export function setAudioSession(type: AudioSessionType): void {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (!session) return;
  try { session.type = type; } catch { /* 無視 */ }
}

interface WakeLockSentinelLike { release(): Promise<void> }
let lock: WakeLockSentinelLike | null = null;

/** 録音中の画面消灯を防ぐ */
export async function keepAwake(on: boolean): Promise<void> {
  try {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } }).wakeLock;
    if (on && wakeLock && !lock) lock = await wakeLock.request("screen");
    if (!on && lock) {
      const l = lock;
      lock = null;
      await l.release();
    }
  } catch { /* 無視 */ }
}

/** ページが隠れたとき（別のアプリ・タブへ）に呼ぶ。戻り値で解除 */
export function onPageHidden(handler: () => void): () => void {
  const listener = () => { if (document.visibilityState === "hidden") handler(); };
  document.addEventListener("visibilitychange", listener);
  window.addEventListener("pagehide", handler);
  return () => {
    document.removeEventListener("visibilitychange", listener);
    window.removeEventListener("pagehide", handler);
  };
}
