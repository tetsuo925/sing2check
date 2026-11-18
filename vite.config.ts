import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// base は相対（"./"）。GitHub Pages のプロジェクトページでもユーザーサイト直下でも、設定を変えずに動く。
// iPhone 実機から開くとき: HTTPS=1 npm run dev:host （自己署名の HTTPS。README「iPhone 実機で試す」）
export default defineConfig({
  base: "./",
  plugins: [react(), ...(process.env.HTTPS ? [basicSsl()] : [])],
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 900, // abcjs が大きい（譜面の描画だけで約 250kB gzip）
    rolldownOptions: {
      // solfege-core.js の末尾の「module があれば module.exports に入れる」行への注意。ブラウザでは module が無いので通らない
      onLog(level, log, handler) {
        if (log.code === "COMMONJS_VARIABLE_IN_ESM" && log.id?.endsWith("solfege-core.js")) return;
        handler(level, log);
      },
    },
  },
  worker: { format: "es" },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // solfege-core.js は手を入れない。末尾の「module があれば module.exports に入れる」行が Vitest の
    // モジュール変換の中では失敗するので、変換せず Node にそのまま読ませる。
    server: { deps: { external: [/\/src\/core\/solfege-core\.js$/] } },
    testTimeout: 1_800_000,
    // 測定値（test/helpers/check.ts の info）は INFO=1 のときだけ出す。ふだんは失敗したテストの出力だけ
    silent: process.env.INFO ? false : "passed-only",
  },
});
