// マイクを開けなかったときの説明（ハンドオフ文書 §5.5）。ページ内の帯に出す。
export function micErrorMessage(error: unknown): string {
  const name = error instanceof Error || (typeof error === "object" && error !== null && "name" in error)
    ? String((error as { name: unknown }).name)
    : "";
  switch (name) {
    case "NotAllowedError":
      return "マイクの使用が許可されていません。Safari のアドレスバーの「ぁあ」→「Web サイトの設定」→「マイク」を「許可」にして、ページを再読み込みしてください。";
    case "NotFoundError":
      return "マイクが見つかりません。イヤホンのマイクや外部マイクの接続を確認してください。";
    case "NotReadableError":
      return "マイクを使えません。ほかのアプリ（通話・録音）が使っていないか確認してください。";
    case "SecurityError":
      return "このページはマイクを使えない状態で開かれています（https で開いてください）。";
    default:
      return `マイクを開けませんでした（${name || "原因不明"}）。`;
  }
}
