// しきい値と定数をすべてここに集める。
// 値は「実際の歌声で調整する初期値」。合成信号のテストでは確認済み（sing2check-handoff.md「合成信号での検証結果」）。

export interface Sing2CheckConfig {
  // ---- 前処理 ----
  /** ハイパスの遮断周波数 Hz（2 次バターワース） */
  hpfHz: number;
  /** ローパスの遮断周波数 Hz（2 次バターワースを lpfSections 段重ねる） */
  lpfHz: number;
  /** ローパスの段数（1 段 = 2 次）。3 段 = 6 次 */
  lpfSections: number;
  /** 間引き率（48k → 24k） */
  decimation: number;

  // ---- YIN ----
  /** 1 フレームのサンプル数（間引き後） */
  frameSize: number;
  /** ホップ（間引き後のサンプル数） */
  hopSize: number;
  /** 累積平均正規化差分の絶対しきい値（最初に下回った谷を採る） */
  yinThreshold: number;
  /** 探索範囲 Hz */
  minHz: number;
  maxHz: number;

  // ---- 有声の条件 ----
  /** clarity = 1 − d′ の下限 */
  minClarity: number;
  /** RMS の下限 dBFS（設定で調整可） */
  gateDb: number;
  /** セント値の中央値フィルタの長さ（フレーム数、奇数） */
  medianFrames: number;

  // ---- クリックのマスク ----
  /** クリック音の長さ ms */
  clickDurMs: number;
  /** マスクの前側の余白 ms（クリック予定時刻 + 遅延 より前） */
  clickMaskPreMs: number;
  /** マスクの後側の余白 ms（クリック終了より後） */
  clickMaskPostMs: number;

  // ---- 判定 ----
  /** 全体の時間ずれ Δ の探索範囲と刻み ms */
  deltaMinMs: number;
  deltaMaxMs: number;
  deltaStepMs: number;
  /** Δ 合わせで「合っている」とみなす |中央値のずれ| の上限（セント） */
  deltaMatchCents: number;
  /** Δ の得点の山の頂上とみなす範囲（最大値からの割合）。その範囲の中点を Δ にする */
  deltaPlateauRatio: number;
  /** 窓の前側: max(windowHeadMinMs, 音価 × windowHeadRatio) */
  windowHeadMinMs: number;
  windowHeadRatio: number;
  /** 窓の後側: 音価 × windowTailRatio を削る */
  windowTailRatio: number;
  /** 窓内の有効フレームがこれ未満なら窓全体（on〜off）を使う */
  minWindowFrames: number;
  /** 被覆率（有声フレームの割合）の下限。これ未満は silent */
  minCoverage: number;
  /** |中央値 dev| がこれ以下で good */
  goodCents: number;
  /** |中央値 dev| がこれ以下で ok（これを超えると wrong） */
  okCents: number;

  // ---- 実行時の自己点検 ----
  /** 受けたサンプル数 / 経過時間 と sampleRate の差がこの割合以上で警告 */
  sampleRateTolerance: number;
}

export const DEFAULT_CONFIG: Readonly<Sing2CheckConfig> = Object.freeze({
  hpfHz: 60,
  lpfHz: 1500,
  lpfSections: 3,
  decimation: 2,

  frameSize: 1024,
  hopSize: 256,
  yinThreshold: 0.15,
  minHz: 60,
  maxHz: 900,

  minClarity: 0.80,
  gateDb: -50,
  medianFrames: 5,

  clickDurMs: 30,
  clickMaskPreMs: 10,
  clickMaskPostMs: 10,

  deltaMinMs: -150,
  deltaMaxMs: 400,
  deltaStepMs: 10,
  deltaMatchCents: 50,
  deltaPlateauRatio: 0.02,
  windowHeadMinMs: 40,
  windowHeadRatio: 0.20,
  windowTailRatio: 0.10,
  minWindowFrames: 2,
  minCoverage: 0.30,
  goodCents: 25,
  okCents: 50,

  sampleRateTolerance: 0.05,
});

export function makeConfig(overrides: Partial<Sing2CheckConfig> = {}): Sing2CheckConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
