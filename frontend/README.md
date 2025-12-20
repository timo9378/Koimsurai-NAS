# Koimsurai NAS 前端介面 (Frontend)

這是一個基於 Next.js 構建的現代化 Web 桌面環境 (Web Desktop Environment)，專為 Koimsurai NAS 設計。它提供了一個類似 macOS 的直觀介面，讓使用者可以透過瀏覽器輕鬆管理伺服器、檔案和 Docker 容器。

## ✨ 主要特色

### 🖥️ 桌面環境 (Desktop Environment)
- **視窗管理系統**：支援多視窗開啟、拖曳、縮放、最小化與最大化。
- **Dock 工具列**：快速啟動應用程式，類似 macOS 的操作體驗。
- **全域搜尋 (Spotlight)**：快速搜尋檔案與應用程式。
- **主題切換**：支援深色 (Dark) 與淺色 (Light) 模式。

### 📂 檔案管理 (Finder)
- **完整檔案操作**：瀏覽、上傳、下載、刪除、重新命名、移動檔案。
- **進階上傳**：支援大檔案分塊上傳 (Chunked Upload) 與斷點續傳。
- **預覽功能**：支援圖片、影片與程式碼檔案預覽。
- **垃圾桶機制**：防止誤刪檔案，支援還原功能。
- **分享功能**：可建立檔案分享連結。

### 🐳 系統與容器管理
- **儀表板 (Dashboard)**：即時監控 CPU、記憶體 (RAM) 與儲存空間使用率，提供視覺化圖表。
- **Docker 管理器**：
  - 查看容器列表與狀態。
  - 啟動、停止、重啟與刪除容器。
  - 即時查看容器日誌 (Logs)。
  - 快速開啟 Web 服務連結。

### 🛠️ 其他工具
- **終端機 (Terminal)**：整合 xterm.js 的網頁版終端機。
- **系統設定**：客製化桌面體驗。

## 🚀 技術堆疊 (Tech Stack)

- **框架**: [Next.js 16](https://nextjs.org/) (App Router)
- **語言**: [TypeScript](https://www.typescriptlang.org/)
- **樣式**: [Tailwind CSS v4](https://tailwindcss.com/)
- **UI 組件**: [Radix UI](https://www.radix-ui.com/), [Lucide React](https://lucide.dev/) (Icons)
- **狀態管理**: [Zustand](https://github.com/pmndrs/zustand)
- **資料獲取**: [TanStack Query (React Query)](https://tanstack.com/query/latest)
- **圖表**: [Recharts](https://recharts.org/)
- **其他**: Framer Motion (動畫), Monaco Editor (程式碼編輯), xterm.js (終端機)

## 📦 安裝與執行

### 前置需求
- Node.js (建議 v18 或以上)
- pnpm (建議) 或 npm/yarn

### 開發模式

1. 安裝依賴套件：

```bash
pnpm install
# 或
npm install
```

2. 啟動開發伺服器：

```bash
pnpm dev
# 或
npm run dev
```

3. 開啟瀏覽器訪問 [http://localhost:3000](http://localhost:3000) (或 package.json 中設定的 3001 port)。

### 建置生產版本

```bash
pnpm build
pnpm start
```

## 📁 專案結構

```
frontend/
├── src/
│   ├── app/            # Next.js App Router 頁面與佈局
│   ├── components/     # React 組件
│   │   ├── apps/       # 應用程式組件 (Finder, Dashboard, Docker 等)
│   │   ├── desktop/    # 桌面環境組件 (Dock, Window, TopBar)
│   │   ├── ui/         # 通用 UI 組件 (Button, Input, Dialog 等)
│   │   └── ...
│   ├── features/       # 功能模組 (API hooks, 邏輯封裝)
│   ├── hooks/          # 自定義 Hooks
│   ├── lib/            # 工具函式庫 (API client, utils)
│   ├── store/          # Zustand 狀態管理
│   └── types/          # TypeScript 型別定義
├── public/             # 靜態資源
└── ...
```

## 🤝 貢獻

歡迎提交 Pull Request 或 Issue 來改進這個專案。

---
Powered by Next.js & React
