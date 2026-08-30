# Koimsurai NAS — Monorepo 遷移計畫

Next.js 16 → Vite + TanStack Router（純 SPA），收攏後端成 monorepo，
工具鏈對齊 `sora-to-ki`（`/home/timo9378/Server/web`）**並補上它缺的 oxfmt**。

## 進度

| Phase | 狀態 |
|---|---|
| 0 · monorepo 收攏 | ✅ `829f069`（外加資安事件處理，見 §9）|
| 1 · Next → Vite SPA | ✅ `0f638a6` |
| 2 · 型別橋（specta）| ✅ `5b76798` + `2334724`（發現並修掉 5 處前後端不一致，見 §10）|
| 3 · 工具鏈落地 | ✅ 後端 clippy/-D warnings + rustfmt 全綠；前端 oxlint/oxfmt/vitest 就位；CI 三個 job 上線 |
| 4 · 部署 | ✅ ServeDir + Dockerfile + compose + nginx 切換 + GlitchTip（含 source map 上傳）全數上線 |
| 5 · 品質基準線 | 🔶 oxlint 存量歸零並改成真的擋；前端測試 76 條；cargo-mutants 接 Actions。覆蓋率門檻／E2E／knip 未接，見 §12 |

**Phase 3 已補完**：oxlint 存量從 594 清到 0（其中 177 個是 `no-unsafe-*` /
`no-explicit-any`，那批不是清理而是替 `catch (e: any)` 與未型別化 props 補型別的
型別化工程）。ci.yml 的 `continue-on-error` 已拿掉並補上 `--max-warnings 0` ——
後者不能省，因為最會抓到真 bug 的幾條規則（`no-unnecessary-condition`、
`exhaustive-deps`、`set-state-in-effect`）預設是 warning。

---

## 0. 現況體檢

| 項目 | 數字 |
|---|---|
| 前端 TS/TSX 檔案 | 73 |
| 標了 `'use client'` | 53 |
| Server Actions | **0** |
| 有資料抓取的 Server Component | **0** |
| 路由總數 | **4**（`/`、`/login`、`/s/:id`、`/u/:id`）|
| 後端 models | 289 行 / 27 個 derive 區塊 |
| 後端既有測試 | `auth` / `file` / `concurrency` / `proptest_security` |

Next.js 在這包的實際貢獻 = 一個 dev server + 一個 `/api` rewrite proxy。
SSR / RSC / streaming 一個都沒用到 —— `src/app/page.tsx` 開頭就是 `"use client"`
然後 `useEffect` 打 auth，這正是 Next 最不擅長的模式（送 HTML shell → hydrate →
才打 API，比純 SPA 多一整輪 round trip）。

### Next 專屬 API 的接觸面

| 現在 | 換成 | 影響檔案 |
|---|---|---|
| `next/font/google` (Geist) | `@fontsource-variable/*` | `src/app/layout.tsx` |
| `next/navigation` `useParams`/`useRouter` | TanStack Router hooks | 2 檔 |
| `next/dynamic` | `React.lazy` + `Suspense` | 2 檔 |
| `metadata` / `viewport` export | `index.html` `<head>` | 1 檔 |
| `manifest.ts` | 靜態 `public/manifest.webmanifest` | 1 檔 |
| `next.config` rewrites | Vite `server.proxy`（dev）+ nginx（prod，已存在）| — |
| `next-themes` | **原地留著**（不依賴 next，Vite 下正常跑）| — |

TanStack Query / Zustand / Radix / Tailwind v4 / framer-motion / xterm / recharts
—— 全部零改動。

---

## 1. 目標結構

`web` 把前端放 **repo 根目錄**、後端在 `backend/`、設定集中 `.config/`。照抄。

```
Koimsurai-NAS/                    # monorepo root（就是這個 repo）
├── Cargo.toml                    # [workspace] members = ["backend"]
├── pnpm-workspace.yaml
├── package.json                  # 前端在根，Node>=26 / pnpm@12
├── tsconfig.json
├── vite.config.ts                # SPA（見 §6 分歧 1）
├── vitest.config.ts + vitest.setup.ts
├── playwright.config.ts
├── index.html
├── .oxlintrc.json
├── .oxfmtrc.json                 # ★ web 沒有，這裡補上
├── .typos.toml
├── .cargo/
│   ├── audit.toml                # cargo-audit 豁免（每條要寫「走不到該路徑」的理由）
│   └── mutants.toml              # cargo-mutants（含「哪些檔值得跑」的判準）
├── .config/
│   ├── biome.json                # 只管 CSS，需 "root": false
│   ├── knip.json
│   ├── lighthouserc.cjs
│   ├── nextest.toml              # 必須在 workspace root，放 backend/ 讀不到
│   ├── schemathesis.toml
│   └── stryker.config.json       # ignorePatterns 要含 target/，否則吃掉整顆硬碟
├── .github/workflows/ci.yml
├── scripts/hooks/pre-commit
├── backend/                      # ← git subtree，保留完整 commit 歷史
│   ├── Cargo.toml
│   ├── rustfmt.toml
│   ├── migrations/ tests/
│   └── src/bin/export_types.rs   # specta 匯出
├── packages/api-types/           # Rust struct → TS 型別（產物）
├── src/
│   ├── routes/                   # TanStack Router file-based
│   ├── routeTree.gen.ts + router.tsx + main.tsx + index.css
│   └── components/ features/ store/ hooks/ lib/    # 原地不動
├── tests/e2e/
└── public/
```

---

## 2. 工具鏈盤點

### 2.1 前端

| 層 | 工具 | 備註 |
|---|---|---|
| 套件管理 | pnpm 12 workspace | `allowBuilds` + CVE `overrides` |
| Bundler | Vite 8 + `@vitejs/plugin-react` | |
| Router | TanStack Router 1.170（file-based）| |
| 資料層 | TanStack Query 5.101 | **已在用** |
| CSS | Tailwind v4 via `@tailwindcss/vite` | `postcss.config.mjs` 消失 |
| JS/TS **Lint** | oxlint 1.75 + `oxlint-tsgolint`（type-aware）+ `@eslint-react` | `.oxlintrc.json` 複製 |
| JS/TS **Format** | **★ oxfmt 0.65** | **`web` 缺這塊，見 §3** |
| CSS Format/Lint | biome 2.5 | `javascript`/`json` formatter 關掉 |
| TypeScript | 6.0 | |
| 單元測試 | vitest 4 + testing-library + jsdom + **fast-check** | property-based |
| 覆蓋率 | `@vitest/coverage-v8`、`v8-to-istanbul`、`@bcoe/v8-coverage` | 合併 dump 一定要用 `mergeScriptCovs` |
| 突變測試 | Stryker 9 | 本機工具，**不接 CI** |
| E2E | Playwright + `@axe-core/playwright` | |
| 效能預算 | `@lhci/cli` | |
| 死碼 | knip 6 | |

### 2.2 後端

| 層 | 工具 |
|---|---|
| 型別橋 | specta 2.0-rc.25 + specta-typescript + specta-serde |
| 格式 | `cargo fmt`（`rustfmt.toml`：`max_width=110`，**不帶** `use_small_heuristics`；見 §4.4）|
| Lint | `cargo clippy --locked --all-targets -- -D warnings` |
| 測試 | **`cargo nextest run --no-fail-fast`** |
| 覆蓋率 | `cargo llvm-cov nextest --fail-under-regions N` |
| 突變測試 | `cargo mutants --file <單檔>` |
| 未用相依 | `cargo shear` |
| 漏洞 | `cargo audit` |
| 錯字 | `typos` |
| API fuzz | schemathesis（吃 utoipa 的 OpenAPI）|

### 2.3 ⚠️ 不在 CI、但屬於工具鏈的（容易被漏掉的那半）

CI 只是把「每次都該過」的那些自動化。下面這些是**人主動跑的找洞工具**，
定位不同 —— 拿來找洞，不是門檻：

```bash
# Rust 突變測試：判準是「錯了會不會安靜地錯」
cargo mutants --file backend/src/handlers/<檔>.rs     # 約 4 分鐘/檔
#   ⚠️ 不要全 repo 跑（web 上是 3.5 小時，且分數被沒打算測的整合層稀釋到失去意義）
#   ⚠️ 必須 test_tool = "nextest"，否則 baseline 就失敗

# 前端突變測試（Stryker，只跑純邏輯層，不跑元件）
pnpm mutate
#   ⚠️ ignorePatterns 一定要含 target/：Stryker 不讀 .gitignore，
#      web 上實測一次跑完留下 115 GB，其中 114 GB 是 Rust 的 target/
#   ⚠️ cleanTempDir: "always"（預設只在成功時清，而中止留下的沙箱最大）

# 三道在 repo 根目錄跑、很容易漏的門檻
typos          # 會掃變數名，不只註解字串
cargo shear
cargo audit    # Cargo.lock 在 workspace root，在 backend/ 底下跑會找不到
```

**覆蓋率不等於測試有效** —— `web` 的 `handlers/vitals.rs` 覆蓋率 98.67%、
變異分數只有 43%，抓出「驗證鏈的 `&&` 全換成 `||` 測試照樣綠」。
NAS 這邊對應該跑的檔案（錯了會安靜地錯的）：

| 檔案 | 為什麼值得跑 |
|---|---|
| 權限 / 路徑檢查 | 守衛被削弱不會有任何症狀，只是安靜地放行 |
| `share` 的過期與密碼判定 | 邏輯反了 = 分享連結永不過期，功能「正常」 |
| 2FA 的 TOTP window / backup code 消耗 | 少消耗一次 = 可重放，測試不會紅 |
| 配額 / 分頁 offset 算式 | 不會 crash，只會永遠回錯的數字 |

---

## 3. ★ oxfmt —— 補上 `web` 的缺口

`web` 現在的狀態：oxlint 管 JS/TS 的 **lint**、biome 管 CSS 的 **format + lint**，
而 biome 的 `javascript.formatter` 與 `json.formatter` 都明確關掉了，
專案裡也沒有 prettier —— **JS/TS 根本沒有 formatter**。

格式漂移在 CSS 那邊是 error（biome 會讓 CI 紅），在 JS/TS 那邊卻無人看守。
oxfmt 正好補這塊，而且跟 oxlint 同一個 Oxc 工具鏈、同一份 AST，不會出現
「兩個工具對同一批檔案有矛盾意見」的老問題（那正是 `web` 當初不讓 biome
碰 JS/TS 的理由）。

```jsonc
// .oxfmtrc.json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json"
  // 預設就對齊 prettier，先不覆寫；有分歧再逐條加
}
```

```json
"format": "oxfmt .",
"format:check": "oxfmt --check .",
"format:css": "biome format --config-path=.config/biome.json --write ."
```

- CI 的 frontend job 加 `pnpm format:check`（格式漂移 = error，跟 CSS 那邊一致）
- `scripts/hooks/pre-commit` 的 ts/tsx 分支加一條 `oxfmt`
- 導入時官方有 `/migrate-oxfmt` skill 可以跑
- ⚠️ oxfmt 還在 **0.x**，跟 `web` 釘死 `vite` / `oxlint` 的理由一樣，**釘死版本**，
  升版要先跑一次 `--check` 看 diff 幅度
- ⚠️ 排除清單要跟 oxlint 對齊：`src/routeTree.gen.ts`、`packages/api-types/index.ts`
  （兩個都是**產生檔**，格式化了下次重產又漂）、`src/components/ui/**`（shadcn 產的）

> 這件事值得回頭補進 `web`。兩邊用同一份 `.oxfmtrc.json`。

---

## 4. Rust 撰寫規範（從你的 review 過程整理）

來源：`web/backend/STRANGLER.md` 的統一 audit（A/B/C/D 四級）、
AIForce 那條線的 `Rust框架規範.md`（§4.1 / §9.1 / §11.3）。
**這些是你已經裁示過的判準，新後端程式碼直接照這把尺寫，不要重新討論。**

### 4.1 併發四問（review checklist）

1. **跨 `.await` 持有 MutexGuard？**
   —— 用 `parking_lot` 的話 guard 是 `!Send`，持著跨 await **直接編不過**，
   規則由 rustc 擔保而非 review。
2. **CPU 重活在 async runtime 上同步跑？**
   —— NAS 的對應物：argon2 雜湊、縮圖產生、zip 壓縮、tantivy 索引。
   一律 `spawn_blocking`。刻意不包的要註明理由。
3. **每 request 重建 client / 連線池？**
   —— 一顆 `OnceLock<Client>` 共用，只設 `connect_timeout`；
   有界操作用 per-request `.timeout()`；**串流 / 大檔傳輸不設總 timeout**。
4. **迴圈內 `.await` 打 DB（N+1）？**
   —— 判準：資料「一次查得完」→ N+1（bug）；資料「本來就分批到達」→ streaming（正確形狀）。

加兩條：
- **鎖內不呼叫擴充點**（collect-then-emit）—— callback 是開放擴充點，
  鎖內呼叫等於把「這裡不可重入」交給未來每個改 callback 的人**記得**。
  三行的 collect-then-emit 把前提從「人要記得」變成「結構上不可能」。
- **非顯而易見的鎖策略要註解 why**。

### 4.2 已裁示的寫法（不建議 → 改寫成）

| 不建議 | 改成 | 理由 |
|---|---|---|
| `let _ = ...` 吞錯 | `tracing::warn!` / `error!` | 靜靜失敗沒人發現 |
| regex 每次呼叫重編譯 | `std::sync::LazyLock` | 熱路徑 |
| async 內 `std::fs` | `tokio::fs` 或 `spawn_blocking` | 卡 worker |
| `contains_key` 後 `get().unwrap()` | `if let` / `unwrap_or` 單一表達式 | 消除 guard-drift panic |
| `as` 截斷 | `try_from().unwrap_or(...)` | 靜默截斷 |
| `&String` / `&Vec<T>` 簽名 | `&str` / `&[T]` | |
| 複雜巢狀型別 | type alias | `clippy::type_complexity` |
| handler 內 `reqwest::Client::new()` | 走 `state.http` | |
| 硬編外部 URL | 注入點（`ExternalUrls` 之類）| **測試會真的打外網，結果取決於別人的服務今天有沒有掛** |
| 裸 `#[allow(...)]` | 一律帶 `reason = "..."` | |

### 4.3 測試慣例

```rust
// crate 檔頭：測試裡的 unwrap 是 assert 語意
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic,
    reason = "unit test 慣例使用 unwrap"))]
```

⚠️ **一律 `cargo nextest run --no-fail-fast`，不要用 `cargo test`。**
nextest 是一個測試一個行程；`cargo test` 同行程平行跑執行緒，
而測試會寫 process 全域的 `std::env::set_var` 與 static → 互相蓋。
症狀是「隨機幾條紅、每次紅的還不一樣」，看起來完全像測試本身會抖。
`web` 上為此誤判過三次、回報過三組不存在的「既有失敗」。
`--no-fail-fast` 也不是可選的：少了它，第一個失敗就中止，跑過的測試數每次不同，
那個變動又會被誤讀成不穩定。

⚠️ 會碰 SQL 的測試不要寫在 `src/**` 的 `#[cfg(test)]` 裡 —— schema 測試會掃 `src`
底下所有字面 SQL 拿去 prepare，認不得 `cfg(test)`。放 `backend/tests/`。

### 4.4 rustfmt —— `web` 的數值**不要照抄**（已實測）

`web/backend/rustfmt.toml` 的 `max_width=110` + `use_small_heuristics="Max"`
是**反推出來貼合它既有緊湊風格**的（單行 struct literal、對齊的中文註解），
檔頭寫的理由就是「讓 fmt gate 的重排幅度最小化」。
**那個前提在 NAS 不存在** —— 這包後端從來沒跑過 rustfmt。

實測（11546 行，`cargo fmt --check` 的 diff 區塊數）：

| 設定 | diff 區塊 |
|---|---|
| `max_width=100`（rustfmt 預設）| 598 |
| **`max_width=110`** | **590** ← 採用 |
| `max_width=120` | 582 |
| `max_width=110` + `use_small_heuristics="Max"`（web 那份）| 600 |
| `max_width=120` + `Max` | 608 |
| `max_width=100` + `Max` | 586 |

全部落在 582–608（差距 4%）—— 沒有既有風格可貼合，所以沒有哪個設定省得下來。
既然一次性重排的成本都一樣，就**按優劣選**而不是按 churn 選：

```toml
# backend/rustfmt.toml
# 只設寬度，與 web 對齊（讀兩包 repo 是同一把尺）。
# 實測行長 p99=109、超過 110 字元的只有 103 行 —— 這份 code 天然落在 110 以內。
# ⚠️ 刻意不設 use_small_heuristics="Max"：那是 web 為了保住它刻意寫緊湊的
#    struct literal 才加的，這包 code 寫得比較展開，加了反而多 10 個區塊去打架。
max_width = 110
```

⚠️ **那次一鍵重排（~590 區塊）要獨立成一個 commit**，在 fmt gate 進 CI 之前做完，
才不會混進任何功能性 diff。

---

## 5. 執行階段

### Phase 0 — monorepo 收攏
- `git tag pre-monorepo`（唯一不可逆步驟前的保險）
- `git subtree add --prefix=backend ../Koimsurai-NAS-backend main`
- 根 `Cargo.toml` workspace / `pnpm-workspace.yaml` / `packages/api-types` 空殼
- `engines.node >=26`、`packageManager: pnpm@12.1.0`

### Phase 1 — Next → Vite SPA
- 移除 `next`、`eslint-config-next`、`postcss.config.mjs`、`next-env.d.ts`、`next.config.ts`
- `index.html` / `src/main.tsx` / `src/router.tsx`（無 SSR 版，不掛 `router-ssr-query`）
- `src/app/*` → `src/routes/*`；Provider 樹 → `src/routes/__root.tsx`
- 字體 self-host、`next/dynamic` → `React.lazy`、manifest 靜態化
- dev proxy：Vite `server.proxy` `/api` → `127.0.0.1:3000`（**`ws: true`**）
- **路由/視窗級 code split**：Monaco、xterm、recharts、DockerManager 切出 entry chunk

### Phase 2 — 型別橋（specta）
現況 `src/types/api.ts` 是 **225 行手寫**、與 Rust struct 靠人工同步。
- backend 加 specta 三件組，27 個 struct 加 `#[derive(specta::Type)]`
- `backend/src/bin/export_types.rs` → `packages/api-types/index.ts`
- 前端刪 `src/types/api.ts`，改 import `@koimsurai/api-types`
- CI 加 **drift check**：重跑匯出後 `git diff --exit-code`

### Phase 3 — 工具鏈落地
§2 每一項獨立 commit。`.oxlintrc.json` 複製 `web` 那份只改 `ignorePatterns`。
oxfmt 用 `/migrate-oxfmt` 導入後釘死版本。
`scripts/hooks/pre-commit`：ts/tsx → oxfmt + tsc + oxlint；`backend/*.rs` → fmt + clippy。

### Phase 4 — 部署（已拍板：Rust ServeDir）
```rust
// backend/src/lib.rs, create_app 末端
let spa = ServeDir::new("static").not_found_service(ServeFile::new("static/index.html"));
app.fallback_service(spa)
```
`tower-http` 的 `fs` feature **已在 `Cargo.toml`**，零新依賴。
Dockerfile 改多階段（node build → COPY 進 rust image 的 `static/`）；
nginx `nas-koimsurai` 的 `location /` 由 `13001` 改指 `127.0.0.1:3000`；
刪掉前端 Node container。

---

## 6. 與 `sora-to-ki` 的刻意分歧

1. **不引入 TanStack Start / Nitro。**
   `web` 需要 SSR（部落格、SEO、OG、ISR）。NAS 全站在登入牆後，沒有 SEO 需求，
   且已拍板讓 Rust 送靜態檔 —— 引入 Start 等於把剛丟掉的 Node runtime 請回來。
   用 TanStack **Router** 純 SPA。這是唯一的架構分歧。
2. **`packages/` 只留 `api-types`**，不搬 `mdx-core` / `mcp-server`（`web` 專屬）。
3. **LHCI 拿掉 SEO 斷言**，留 a11y + 資源預算。
4. **★ 多一個 oxfmt**（見 §3），並建議回頭補進 `web`。
5. **GlitchTip：照搬**（已確認）。`web` 那套三件事全綁在建置裡，所以不存在
   「忘記傳」或「順序錯」：烙 debug id → 上傳 source map → 從映像刪 `.map`。
   token 走 BuildKit secret（`.env.sourcemaps.token`，不提交）。
   - ⚠️ **GlitchTip 掛著時 build 要失敗，這是刻意的** —— 靜靜跳過上傳等於
     錯誤追蹤白裝，而那不會有人發現。真要在它掛掉時部署就清空 token（走跳過分支）。
   - ⚠️ vite 的 `sourcemap: 'hidden'` **只拿掉 sourceMappingURL 註解，不阻止
     `.map` 被供應**（`web` 實測 `/assets/*.js.map` 直接 200）。
     Dockerfile 那步 `find ... -delete` 是必要的，不是清潔癖。
   - `VITE_RELEASE` 沒帶的話 issue 歸不到某次部署：
     `VITE_RELEASE=$(git rev-parse --short HEAD) docker compose …`
   - NAS 這邊多一個好處：它是私有服務，錯誤內容不會外流到第三方。

---

## 7. 效能預期

| 項目 | 現在 | 之後 |
|---|---|---|
| Production Node 進程 | 1 | **0** |
| 首屏 | HTML shell → hydrate → 打 auth | 直接打 auth（少一輪）|
| Entry bundle | Monaco/xterm/recharts 幾乎全塞一包 | 開哪個 app 才載哪包 |
| Dev HMR | Next 秒級 | Vite 毫秒級 |
| 部署單位 | 2 容器 | 1 顆 Rust binary |

---

## 8. 風險與回退

- 全程在 `main` 原地改造，任何 phase 可 `git revert`
- Phase 0 的 `git subtree` 不可逆 → 先 `git tag pre-monorepo`
- `Koimsurai-NAS-backend` 保留唯讀備份，CI 全綠後再封存
- Tailwind v4 換到 `@tailwindcss/vite` 是設定層改動，`globals.css` 內容不動

---

## 9. 附錄：Phase 0 期間處理的資安事件

驗證 subtree 結果時發現，不在原計畫內。

`backend/.env` 從 `init RustNAS project` 這個**初始 commit** 起就被追蹤，
而 `timo9378/Koimsurai-NAS-backend` 是**公開** repo —— `JWT_SECRET`（63 字元）、
`SESSION_SECRET`（64）、`REGISTRATION_INVITE_CODE`（23）全是真值，
在該 repo 的整個生命週期都是公開可讀的。

成因是 `.gitignore` 寫成 `! .env`，兩層都失效：
1. 驚嘆號後面有空格，不是有效的 gitignore 語法
2. 就算語法對，它是「取消忽略」—— 而前面根本沒有任何忽略 `.env` 的規則

### 已處理

| 項目 | 做法 |
|---|---|
| 金鑰輪替 | 三個金鑰換新值，其餘 20 個鍵逐字元不變（`.env.bak-pre-rotation-*` 留底）|
| 歷史清除 | `git filter-repo --invert-paths --path .env`，40 個 commit 全清後 force push |
| gitignore | 兩邊都修好；`.env.bak-*` 也一併擋掉（裡面是舊金鑰）|
| 備份 | `/home/timo9378/Server/backup-*-20260830-012053.git` 兩個 mirror |
| monorepo | subtree 重做一次，接的是清理後的後端歷史，`.env` 從未進入本 repo |

⚠️ **`git filter-repo` 會連工作區的檔案一起刪掉**（`.env` 當時是被追蹤的），
重跑類似操作前要先另存一份。

### 仍待執行

- **重啟後端容器套用新金鑰**。金鑰是建立容器時烙進 `Config.Env` 的，
  改 `.env` 不會自動生效 —— **在重啟之前，外洩的舊 `JWT_SECRET` 依然有效**：
  ```bash
  docker compose -f /home/timo9378/Server/docker-compose.yml \
    up -d --force-recreate koimsurai-nas-backend
  ```
  （會把所有使用者登出。）
- `REGISTRATION_INVITE_CODE` 公開過 → 查 users 表有無非預期帳號
- `docker-compose.yml` 的 `env_file: ./Koimsurai-NAS-backend/.env`
  在 Phase 4 要改指 `./Koimsurai-NAS/backend/.env`

---

## 10. 附錄：Phase 2 對拍出來的前後端不一致

手寫型別換成 specta 產生之後，`tsc` 立刻報出 18 個錯 —— 每一個都是真的不一致。
下面前四項**已在 `5b76798` 修掉**，第五項是**未解、需要你裁示**的。

### 已修

| # | 問題 | 影響 |
|---|---|---|
| 1 | `f32/f64` 實際是 `number \| null`（serde_json 把 NaN/Infinity 序列化成 null），手寫型別宣告成 `number` | `cpu_usage` 讀不到取樣時是 NaN → `.toFixed(1)` 當場拋錯。13 處補 `?? 0` |
| 2 | `InitUploadResponse.uploaded_size` 是 `Option<i64>` → 序列化成 **null 而非省略欄位** | `!== undefined` 永遠成立，斷點續傳的 `startOffset` 被設成 `null` |
| 3 | `LoginRequest` 只有 `username`/`password`，前端多送 `remember` | serde 靜默丟棄 → **登入頁的「記住我」從來沒作用過**。已停止送出並標 TODO |
| 4 | `JobUpdate` 沒有 `type` 欄位 | 手寫版憑空多宣告，toast 顯示 `undefined` |

### 已修：WebSocket 協定（`2334724`）

原本這條 socket 上有**兩種不相容的封包格式**，而且整條路徑壞掉卻毫無症狀：

| 來源 | 送出的形狀 |
|---|---|
| `queue.rs` 的 broadcast | 裸 `JobUpdate`，**沒有 `type` 欄位** |
| `WsServerMessage` | `{ "type": "DockerStats", "payload": … }`（PascalCase）|
| 前端比對的 | `'docker_stats'` / `'job_update'` / `'file_change'` |

三者互不相符 → `switch (msg.type)` 沒有分支命中 → 背景工作的進度與完成通知
從來沒有送達過。沒有錯誤、沒有 log。

解法是讓 **`WsServerMessage` 成為伺服器送出的唯一信封**：

- 新增 `JobUpdate(JobUpdate)` variant，broadcast 包進信封才送（`queue.rs` 不動）
- 兩個 enum 加 `rename_all = "snake_case"`，與 JSON 面其餘部分及既有的
  `JobStatus`（本來就 lowercase）一致 —— 產生的 tag 正好就是前端當初預期的名字
- 前端刪掉手刻的 `WebSocketMessage`，直接用產生的型別，並加 `never` 窮盡檢查
- 移除 `file_change` 分支（後端沒有任何送出點）
- 刪除 `src/hooks/use-socket.ts`（三個 export 全部零消費者）

⚠️ **`docker_stats` 仍然收不到，但那是另一回事**：後端要收到
`subscribe_docker_stats` 才會開始推，而前端目前沒有任何地方送這則訊息
（原本負責的 `useDockerStats` 是空殼且零呼叫端，已刪）。
協定本身是通的，缺的是呼叫端 —— 哪天 Docker 監控頁要即時數據時再接。

測試釘在 `backend/tests/ws_protocol_tests.rs`：型別由 specta 擔保，但
`rename_all` / `content` 鍵被改掉時型別檢查抓不到（兩邊產物會同時變，
看起來依然一致卻與舊客戶端不相容）。實測拿掉 `rename_all` 會讓 3/4 條紅。

---

## 11. Phase 4 部署：已完成與待辦

### 已上線

- `backend/src/lib.rs` 的 `attach_spa`：Rust 同時供應 `/api` 與前端靜態檔
- `Dockerfile`：三階段（node 建前端 → rust 建後端 → runtime 只留 binary + static/），
  取代原本前後端各一份
- `/home/timo9378/Server/docker-compose.yml`：`frontend` 服務移除，只剩 `backend`；
  build context 改 `./Koimsurai-NAS`、`env_file` 改 `./Koimsurai-NAS/backend/.env`
- 容器已重建 —— **輪替後的金鑰於此生效**（舊的外洩 `JWT_SECRET` 自此失效）

### ⚠️ 部署時發現並修掉的問題

`create_app` 原本 `await` 完 `initial_scan()` 才綁 port。遷移前這只是「掃描期間
API 不通」，UI 由獨立的前端容器供應還看得到；SPA 改由後端送之後，變成
**掃描期間整個站是掛的**。實測這台的 storage 有 320,380 個檔案，重新部署後
超過 90 秒仍未監聽。改成 `tokio::spawn` 之後是 **4 秒**。

### nginx 切換（已完成）

`location /` 已從舊的前端容器（127.0.0.1:13001）改指後端 127.0.0.1:3000，
整份設定裡不再有 13001。舊的 `koimsurai-nas-frontend` 容器已移除。

### GlitchTip（已完成）

`@sentry/browser`（具名解構載入，26 KB gzip）、`tunnel: "/api/_report"`、
build 時 `sentry-cli sourcemaps inject` + `upload`、`VITE_RELEASE` 版本標記、
上傳後刪 `.map` —— 整條都接上了，`sentry-token` 也已就位並生效。

---

## 12. 還沒接的（依重要性）

### ⚠️ 線上跑的不是最新版

目前部署的映像建於 `26dbb64`。之後的品質整頓（oxlint 594→0、前端測試 0→76）
裡修掉了好幾個**真的會影響使用的 bug**，那些都還沒上線：

| 修掉的 | 症狀 |
|---|---|
| Terminal 卸載不關 WebSocket | 每開關一次視窗就留一條連線與一個 xterm 實例 |
| Terminal 初始分頁 | （本輪自己弄壞又修好的）terminal 從來沒連上過 |
| 拖放上傳不檢查大小 | `handleDrop` 抓到初次 render 的閉包，`max_file_size` 整段跳過 |
| 切分頁後鍵盤／滑鼠側鍵作用在舊分頁 | setter wrapper 沒進 deps，抓到舊的 `activeTabId` |
| Dock 的視窗預覽縮圖 | 讀 `props.url`，但沒有人設過那個欄位——分支從沒渲染過 |
| 上傳連結頁的 `max_files: 0` | JSX 把 0 印在畫面上，且外層判斷把 0 當成「沒有限制」 |
| 分享／上傳連結的「永不過期」 | 手抄的型別寫成 `string \| undefined`，後端送的是 `null` |

重新部署：

```bash
cd /home/timo9378/Server
VITE_RELEASE=$(git -C Koimsurai-NAS rev-parse --short HEAD) \
  docker compose up -d --build backend
```

### 已安裝但完全沒接的工具

| 工具 | 現況 | 接上要做什麼 |
|---|---|---|
| `fast-check` | 已安裝，**0 條** property test | 前端目前只有定樁測試；路徑正規化、file-icons 的解析順序適合 property |
| `knip` | 已安裝，沒有 script 也沒進 CI | 加 `knip.json` + `pnpm knip` script |
| `@vitest/coverage-v8` | 有 `test:coverage`，但**沒有門檻也沒進 CI** | `--coverage.thresholds.*` + CI 一道 |
| `cargo llvm-cov` | 後端完全沒有覆蓋率 | `cargo llvm-cov nextest --fail-under-regions N` |

### 未安裝（工具鏈盤點列了但還沒引入）

Playwright + `@axe-core/playwright`（E2E 與自動化可及性檢查）、
Stryker（前端變異測試）、`@lhci/cli`（效能預算）、schemathesis（吃 utoipa
的 OpenAPI 做 API fuzz）。

### 程式面的已知債

- `Finder.tsx` 約 1400 行。上一頁/下一頁已抽成 `finder/history.ts`，
  其餘（選取、拖放、重新命名）仍在同一支裡。
- `window-store` 的 `newWindow as WindowState`：判別式聯集的關聯 TS 證不出來，
  呼叫端有泛型簽章擋著，理由寫在該行旁。
- 前端測試涵蓋 10 個檔案；`Finder` / `FileList` / `DesktopIcons` / `MobileLayout`
  這幾支大元件仍然沒有測試。
