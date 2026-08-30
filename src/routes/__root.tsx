import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { SocketProvider } from "@/components/providers/socket-provider";
import { GlobalMiniPlayer } from "@/components/ui/global-mini-player";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { queryClient } from "@/router";

// 原本散在 src/app/layout.tsx 與 src/app/providers.tsx 的 provider 樹，合併於此。
//
// ⚠️ 合併時修掉一個既有 bug：layout.tsx 包了 <Providers>（其內已含 SocketProvider），
// 內層又自己包了一層 <SocketProvider> —— 兩層各自 new 一條 WebSocket，等於每個
// 分頁都對 /api/ws 開兩條連線、每則推播都被處理兩次。這裡只保留一層。
function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <SocketProvider>
          <Outlet />
          <GlobalMiniPlayer />
          <ServiceWorkerRegister />
          <Toaster position="top-right" richColors />
        </SocketProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
});
