import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// ⚠️ 測試用獨立設定，不共用 vite.config.ts。
//
// 原因是 vite.config.ts 掛著 tanstackRouter plugin，它會在每次 build 時掃描
// src/routes/ 並重寫 routeTree.gen.ts —— 跑測試不需要那個副作用，而且會讓
// 工作目錄在測試期間出現非預期的檔案變動（CI 上就是 git diff 不乾淨）。
// 這裡只留測試真的需要的：JSX 轉譯與 `@/` 別名。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    // 預設 jsdom：元件測試需要，純邏輯測試也不會因此變慢到有感（整包 <1s）。
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
