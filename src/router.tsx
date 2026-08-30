import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// SPA：整個 app 只有一個 QueryClient（不像 SSR 需要每請求一個來避免跨請求資料洩漏）。
export const queryClient = new QueryClient();

export const router = createRouter({
  routeTree,
  context: { queryClient },
  scrollRestoration: true,
  // 滑過連結就預抓該路由的 chunk，讓分享頁/上傳頁的切換不等載入。
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
