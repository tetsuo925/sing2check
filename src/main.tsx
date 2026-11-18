import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { setAudioSession } from "./audio/session.ts";
import "./styles/tokens.css";
import "./styles/app.css";

// iOS: 消音スイッチが入っていても鳴るように（練習帳と同じ）。マイクを開くときに切り替える（audio/engine.ts）
setAudioSession("playback");

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
