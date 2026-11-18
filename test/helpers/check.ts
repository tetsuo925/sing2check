// 参照実装のテスト道具（harness.ts）の Vitest 版。
import { expect } from "vitest";

/** 条件が偽なら、その場でテストを失敗させる */
export function check(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

/** 合否に数えない測定値（文書に載せる数字）。INFO=1 のときだけ出す */
export function info(name: string, value: string): void {
  if (process.env.INFO) console.log(`  INFO ${name}: ${value}`);
}
