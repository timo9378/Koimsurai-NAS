import { defineConfig } from 'vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
// Tailwind v4 走專屬的 vite plugin 而不是 PostCSS 外掛：v4 自己處理 @import 與
// vendor prefix，postcss-import 與 autoprefixer 都不需要 —— postcss.config.mjs 因此消失。
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// 後端（axum）位址。dev 時由 vite 代理，prod 由 Rust 自己送靜態檔 + API，不經過這裡。
const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [
    // ⚠️ 必須排在 react() 之前：它產生 routeTree.gen.ts，react plugin 才有東西可轉譯。
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    port: 3002,
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true,
        // ⚠️ WebSocket 一定要開：/api/ws 走的是 upgrade，少了這個 socket-provider
        // 會在 dev 一直重連失敗，而畫面上只會表現成「即時更新沒動靜」。
        ws: true,
        // 大檔上傳/下載不設逾時（對齊 nginx 的 proxy_read_timeout 86400）。
        timeout: 0,
      },
    },
  },
  preview: { port: 3001 },
  build: {
    // 產物交給 Rust 的 ServeDir 送（見 backend/src/lib.rs 的 SPA fallback）。
    outDir: 'dist',
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // 重量級且只在特定視窗才開的套件各自成塊，讓首屏不必背它們。
        // ⚠️ 一定要用 function 形式：Vite 8 底層是 rolldown，它的 manualChunks
        //    只接受函式，給物件會在 build 尾端才炸 "manualChunks is not a function"
        //    （而且前面的 transform 全部照跑完，錯得很晚）。
        manualChunks(id) {
          if (id.includes('monaco-editor')) return 'monaco';
          if (id.includes('@xterm/')) return 'xterm';
          if (id.includes('/recharts/')) return 'charts';
        },
      },
    },
  },
});
