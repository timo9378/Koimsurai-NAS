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
    coverage: {
      provider: "v8",
      // ⚠️ `all: true` 是關鍵。v8 預設只把**被測試碰到的檔案**列入分母，
      // 於是數字變成「已測檔案的品質」而不是「整包測了多少」——實測差距是
      // 52% vs 13%。當棘輪用的話前者毫無意義：新增一整支沒測試的檔案，
      // 分母根本不會動。
      all: true,
      // ⚠️ `all: true` 單獨不夠 —— 還要 `include` 明確指出「哪些檔案算在分母裡」，
      // 否則它只會列出被 import 到的那些（實測：少了 components/desktop、
      // components/mobile、features、hooks 整整四個目錄）。
      include: ["src/**/*.{ts,tsx}"],
      // ⚠️ 這些門檻是**棘輪**不是目標，跟後端的 --fail-under-regions 同一個用法：
      // 加一段還沒測到的新功能不該當場擋下，但「刪掉一批測試」會被抓到。
      // 補了測試就把數字往上調。
      //
      // ⚠️ 實測 13.87%（statements 627/4520）。這個數字看起來很低，但它是**誠實**
      // 的那個 —— 不加 `all` + `include` 的話會顯示 51.84%，那是「已測檔案的
      // 品質」，差了 5.6 倍。
      //
      // 該看的是分佈而不是總數：有測的集中在**抽出來的純邏輯** —— finder 的
      // history / selection / marquee / sorting / tabs / rename / move、
      // paths、format、chunk-plan、errors、file-icons、a11y、tus-upload、
      // trash、new-folder、upload-progress、mobile 的 sheets 與 actions，
      // 加上四支元件（ShareDialog、Terminal、socket-provider、u.$id）。
      // Finder / FileList / DesktopIcons / MobileLayout 這四支大元件
      // （合計約 3600 行）仍然沒有測試，而那正是分母的大宗 ——
      // 今天找到的 bug 幾乎都在那四支裡面，方法是「抽出來再測」而不是直接測它們。
      thresholds: { lines: 13, functions: 13, branches: 12, statements: 13 },
      // 不列入分母的：型別定義、產生的檔案、入口、以及 shadcn 的 vendored UI
      exclude: [
        "src/routeTree.gen.ts",
        "src/main.tsx",
        "src/router.tsx",
        "src/types/**",
        "src/components/ui/**",
        "src/test/**",
        "**/*.test.{ts,tsx}",
      ],
    },
  },
});
