# Koimsurai NAS

自架 NAS 的 Web 介面與後端：一個 Rust 伺服器負責檔案、搜尋、媒體轉檔與
Docker 管理，前端是一個仿 macOS 的網頁桌面。兩邊在同一個 repo，也編成
**同一個執行檔**部署 —— 後端在 `/api` 底下提供 API，其餘路徑供應打包好的 SPA。

> ⚠️ 這份 README 之前寫的是「基於 Next.js 構建」。專案早就換成 Vite +
> TanStack Router 了，而且它只描述前端、完全沒提到後端。這裡是照著現況重寫的。

## 這個專案實際上有什麼

### 檔案

- 瀏覽、上傳、下載、重新命名、移動（拖放）、**複製／剪下／貼上**、刪除。
  ⚠️ 移動與複製撞名時會存成 `名字 (1).ext`，不會覆蓋。`fs::rename` 與
  `fs::copy` 在目的地存在時都是直接取代 —— 那曾經讓拖放變成靜默的資料遺失。
- 上傳走 **tus 1.0**（`tus-js-client` ↔ `tus-protocol`）：分塊、可續傳，
  重新整理頁面之後仍然接得回去（指紋存在 localStorage）。
- **垃圾桶**：刪除是移到 `.trash`，可以還原或永久刪除。
  ⚠️ 垃圾桶是扁平的，撞名時存成 `原名.<timestamp>` —— 還原與永久刪除吃的是
  **垃圾桶裡的檔名**，不是原始路徑。
- **版本**：檔案被覆寫時自動存一份到 `.versions/`，可以列出與還原。
  還原是非破壞性的（會先把目前的內容存成新版本）。
- **標籤**、**我的最愛**、以 tantivy 建的全文搜尋。
  ⚠️ 桌面 Finder 的搜尋框查的是 DB（`/api/files?search=`），手機的查的是
  tantivy 索引（`/api/search`）—— 剛上傳的檔案桌面搜得到、手機要等索引跟上。
- **分享連結**與**上傳連結**：公開網址，可設密碼與到期時間。
  資料夾的分享會即時打包成 zip。
  ⚠️ 密碼有次數上限（10 次 / 5 分鐘，超過回 429）。那兩條端點不需要登入，
  而每次密碼比對都是一次 argon2（19 MiB）—— 沒有節流的話既可以暴力破解，
  也可以拿來把記憶體吃光。
- **WebDAV**（`/webdav`）：Basic 認證。⚠️ 開了 2FA 的帳號用不了 WebDAV
  （Basic 沒有第二因素的位置），目前沒有 app-specific password。

### 媒體

- 圖片／影片／音訊／PDF／文字（Monaco）的預覽，影片支援 Range 串流與 HLS 轉檔。
- Photos：依日期分組的時間軸。
- 縮圖與影片 proxy 由背景佇列產生。

### 系統

- 儀表板：CPU／記憶體／儲存／GPU。
- Docker 管理：容器、映像、網路、日誌、容器內終端機。
  ⚠️ 這個功能等同**主機 root**（容器掛著 `docker.sock`），所以由兩個環境變數
  控制：`ENABLE_DOCKER_MANAGER` 與 `DOCKER_MANAGER_USER_IDS`（**沒設就全部拒絕**）。
- 網頁終端機（xterm.js）、稽核紀錄、背景工作進度。

### 桌面

多視窗（拖曳、縮放、邊緣 snap、最小化／最大化／還原、顯示桌面）、Dock
（執行中指示點、hover 出視窗預覽、右鍵開啟／強制結束）、頂端選單列
（每個 app 一組選單，做不到的項目變灰）、Spotlight（⌘K）、通知中心
（稽核紀錄 + 背景工作進度）、控制中心、深淺色主題。
行動裝置（`max-width: 767px`）走另一套版面。

⚠️ **Escape 只在沒有別的東西在等它的時候才關視窗** —— 有選單／對話框開著、
或焦點在輸入框裡時不關。原本是無條件關閉，所以「用 Escape 取消」的每一個動作
（關右鍵選單、取消重新命名、關對話框）都會順便把視窗關掉。

## 技術堆疊

**後端**（`backend/`）
Rust · axum 0.8 · tokio · sqlx + SQLite · tantivy（搜尋）· dav-server（WebDAV）·
bollard（Docker）· tus-protocol · argon2 + jsonwebtoken（認證）· zip · image ·
utoipa（OpenAPI）· specta（型別匯出）

**前端**（`src/`）
TypeScript · Vite 8 · React 19 · TanStack Router + Query · Tailwind CSS v4 ·
Radix UI · zustand · framer-motion · react-virtuoso · Monaco · xterm.js ·
recharts · tus-js-client

### 型別是**產生**的，不要手抄

跨 API 邊界的 Rust 型別同時掛 `utoipa::ToSchema` 與 `specta::Type`，
由 `pnpm export:types` 產生到 `packages/api-types/`，前端一律從 `@/types/api` 匯入。

⚠️ 這條規則是踩過坑才有的：手抄的 `TimelineGroup` 把欄位寫成 `items`
（後端送的是 `files`），Photos 因此從來沒有顯示過任何東西；手抄的
`ShareLinkResponse` 把 `expires_at` 寫成 `string | undefined`，而「永不過期」
走的正是 `null` 那條路。CI 有一個 job 專門檢查產生出來的型別是不是最新的。

## 開發

需要 Node.js（CI 用 26）、pnpm、Rust stable。

```bash
pnpm install

# 後端（:3000。設了 STATIC_DIR 的話同時供應那個目錄的 SPA）
cargo run --manifest-path backend/Cargo.toml

# 前端開發伺服器（proxy `/api` 到 :3000，WebSocket 也一起 —— 見 vite.config.ts）
pnpm dev
```

### 常用指令

| 指令 | 做什麼 |
| --- | --- |
| `pnpm build` | `tsc --noEmit` 之後 vite build |
| `pnpm test` / `pnpm test:coverage` | vitest（jsdom）；覆蓋率門檻是**棘輪**，見 `vitest.config.ts` |
| `pnpm lint` / `pnpm format` | oxlint（type-aware）／oxfmt。⚠️ CSS 由 biome 管，用 `pnpm lint:css`；**不要**直接跑 `oxfmt`，會繞過排除設定 |
| `pnpm knip` | 死碼與未使用的相依 |
| `pnpm e2e` / `pnpm e2e:ui` | Playwright（30 支 spec、57 條；含 axe 的可及性檢查） |
| `pnpm export:types` | 從 Rust 重新產生 API 型別 |
| `cargo nextest run` | 後端測試（24 個測試檔、278 條） |
| `cargo clippy --all-targets -- -D warnings` | 後端 lint |

`pnpm mutate`（Stryker）與 `cargo mutants` **不要在這台機器上跑** —— 它們同時
起很多 worker，而這台機器就是 NAS 本身，上面跑著正式服務。CI 上有排程 job。

## CI

| Workflow | 內容 |
| --- | --- |
| `CI` | 前端 tsc／oxfmt／oxlint／biome／vitest＋覆蓋率／knip／build；後端 typos／fmt／clippy／nextest＋覆蓋率／specta 漂移／cargo-audit／cargo-shear；workflow 本身的 actionlint＋zizmor |
| `E2E` | Playwright + `@axe-core/playwright` |
| `API Fuzz` | schemathesis 照 OpenAPI 產請求打後端 |
| `Mutation (frontend)` / `Mutants` | Stryker / cargo-mutants |

## 專案結構

```
.
├── backend/            Rust 伺服器
│   ├── src/
│   │   ├── handlers/   HTTP 處理器（依領域分檔）
│   │   ├── middleware/ 認證、CSRF、Basic 認證、Docker 權限
│   │   ├── services/   索引器、搜尋、媒體
│   │   ├── utils/      佇列、版本、縮圖、命名
│   │   └── storage.rs  ⚠️ StorageRoot —— 路徑的唯一正規入口，見下
│   └── tests/          整合測試
├── src/                前端
│   ├── components/     apps/（Finder、Photos、Docker…）、desktop/、mobile/、ui/
│   ├── features/       API hooks 與純邏輯模組
│   ├── lib/            paths、format、errors、a11y…（抽出來、有測試的那些）
│   ├── routes/         TanStack Router 的檔案式路由
│   └── store/          zustand
├── packages/api-types/ 由 Rust 產生，不要手改
├── e2e/                Playwright
└── scripts/            E2E 伺服器、fuzz 種子
```

### `StorageRoot`

後端所有使用者給的路徑都必須經過 `storage.rs` 的 `StorageRoot::resolve()`。
那個型別**沒有** `Deref`、`AsRef<Path>` 或 `join` —— 想拿到底層路徑只能呼叫
有名字、可以 grep 的 `as_path()`。這是刻意的：換成這個型別的那一次改動產生了
46 個編譯錯誤，而那 46 個地方就是需要人看過的地方。

⚠️ 背景 job 的 worker 沒有 `AppState`，它用 `StorageRoot::from_env()` 自己重建根
路徑 —— 所以驗證的邊界在 enqueue 的那個 handler 裡，不能省。

## 部署

編成單一容器：前端 build 進 `dist/`，後端供應它。

```bash
cd /home/timo9378/Server
VITE_RELEASE=$(git -C Koimsurai-NAS rev-parse --short HEAD) \
  docker compose up -d --build backend
```

之後照例確認 `/health`（200）、`/api/files`（未登入要 401）、
`/webdav/`（未登入要 401），以及 `docker compose logs backend` 沒有 panic。

## 慣例

- **註解寫「為什麼」**，尤其是「這裡曾經是什麼樣子、為什麼不能改回去」。
  這個 repo 的註解密度偏高是刻意的。
- **邏輯抽成純函式再測**。四支大元件（Finder／FileList／DesktopIcons／
  MobileLayout）很難直接測，所以做法是把判斷抽到 `lib/` 或 `features/` 底下
  的小模組，那裡的覆蓋率才是有意義的。
- **覆蓋率門檻是棘輪不是目標**：加一段還沒測到的新功能不該當場擋下，
  但「刪掉一批測試」要被抓到。補了測試就把數字往上調。
- 有疑慮的行為要寫**反向驗證**：把修好的地方改回去，確認測試會紅。

  ⚠️ 反向驗證本身也會失敗，而且失敗時看起來跟成功一模一樣。實際踩過的坑：
  改回去之後 build 因為未使用的 import 失敗了（測到的是上一份 bundle）；
  字串替換沒命中（`cargo fmt` 早就把那行折行了）；`scripts/e2e-server.sh`
  **不會重編後端**（改了路由直接跑 E2E，測到的是舊 binary）；
  以及「改了東西但沒改到會被觀察的東西」（只換了 snapState 的名字，幾何沒變）。
  **沒有真的看到紅燈的反向驗證等於沒做。**

- 斷言要**分辨得出來**。寫完先問「如果這個功能壞掉，這條會紅嗎」。
  實例：驗 snap 用「寬度介於畫面的 40%～75%」—— 而預設視窗本來就是 57%，
  停用 snap 照樣綠；驗「復原送的是垃圾桶檔名」但沒有製造撞名 ——
  沒撞名時兩者相等，送哪個都過。
