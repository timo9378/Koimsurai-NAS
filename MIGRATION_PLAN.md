# Koimsurai NAS — Monorepo 遷移計畫

Next.js 16 → Vite + TanStack Router（純 SPA），收攏後端成 monorepo，
工具鏈對齊 `sora-to-ki`（`/home/timo9378/Server/web`）**並補上它缺的 oxfmt**。

## 進度

| Phase                | 狀態                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| 0 · monorepo 收攏    | ✅ `829f069`（外加資安事件處理，見 §9）                                                                      |
| 1 · Next → Vite SPA  | ✅ `0f638a6`                                                                                                 |
| 2 · 型別橋（specta） | ✅ `5b76798` + `2334724`（發現並修掉 5 處前後端不一致，見 §10）                                              |
| 3 · 工具鏈落地       | ✅ 後端 clippy/-D warnings + rustfmt 全綠；前端 oxlint/oxfmt/vitest 就位；CI 三個 job 上線                   |
| 4 · 部署             | ✅ ServeDir + Dockerfile + compose + nginx 切換 + GlitchTip（含 source map 上傳）全數上線                    |
| 5 · 品質基準線       | 🔶 oxlint 存量歸零並改成真的擋；前端測試 76 條；cargo-mutants 接 Actions。覆蓋率門檻／E2E／knip 未接，見 §12 |

**Phase 3 已補完**：oxlint 存量從 594 清到 0（其中 177 個是 `no-unsafe-*` /
`no-explicit-any`，那批不是清理而是替 `catch (e: any)` 與未型別化 props 補型別的
型別化工程）。ci.yml 的 `continue-on-error` 已拿掉並補上 `--max-warnings 0` ——
後者不能省，因為最會抓到真 bug 的幾條規則（`no-unnecessary-condition`、
`exhaustive-deps`、`set-state-in-effect`）預設是 warning。

---

## 0. 現況體檢

| 項目                          | 數字                                                  |
| ----------------------------- | ----------------------------------------------------- |
| 前端 TS/TSX 檔案              | 73                                                    |
| 標了 `'use client'`           | 53                                                    |
| Server Actions                | **0**                                                 |
| 有資料抓取的 Server Component | **0**                                                 |
| 路由總數                      | **4**（`/`、`/login`、`/s/:id`、`/u/:id`）            |
| 後端 models                   | 289 行 / 27 個 derive 區塊                            |
| 後端既有測試                  | `auth` / `file` / `concurrency` / `proptest_security` |

Next.js 在這包的實際貢獻 = 一個 dev server + 一個 `/api` rewrite proxy。
SSR / RSC / streaming 一個都沒用到 —— `src/app/page.tsx` 開頭就是 `"use client"`
然後 `useEffect` 打 auth，這正是 Next 最不擅長的模式（送 HTML shell → hydrate →
才打 API，比純 SPA 多一整輪 round trip）。

### Next 專屬 API 的接觸面

| 現在                                      | 換成                                              | 影響檔案             |
| ----------------------------------------- | ------------------------------------------------- | -------------------- |
| `next/font/google` (Geist)                | `@fontsource-variable/*`                          | `src/app/layout.tsx` |
| `next/navigation` `useParams`/`useRouter` | TanStack Router hooks                             | 2 檔                 |
| `next/dynamic`                            | `React.lazy` + `Suspense`                         | 2 檔                 |
| `metadata` / `viewport` export            | `index.html` `<head>`                             | 1 檔                 |
| `manifest.ts`                             | 靜態 `public/manifest.webmanifest`                | 1 檔                 |
| `next.config` rewrites                    | Vite `server.proxy`（dev）+ nginx（prod，已存在） | —                    |
| `next-themes`                             | **原地留著**（不依賴 next，Vite 下正常跑）        | —                    |

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

| 層               | 工具                                                           | 備註                                                                                                                                          |
| ---------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 套件管理         | pnpm 12 workspace                                              | `allowBuilds` + CVE `overrides`                                                                                                               |
| Bundler          | Vite 8 + `@vitejs/plugin-react`                                |                                                                                                                                               |
| Router           | TanStack Router 1.170（file-based）                            |                                                                                                                                               |
| 資料層           | TanStack Query 5.101                                           | **已在用**                                                                                                                                    |
| CSS              | Tailwind v4 via `@tailwindcss/vite`                            | `postcss.config.mjs` 消失                                                                                                                     |
| JS/TS **Lint**   | oxlint 1.75 + `oxlint-tsgolint`（type-aware）+ `@eslint-react` | `.oxlintrc.json` 複製                                                                                                                         |
| JS/TS **Format** | **★ oxfmt 0.65**                                               | **`web` 缺這塊，見 §3**                                                                                                                       |
| CSS Format/Lint  | biome 2.5                                                      | `javascript`/`json` formatter 關掉                                                                                                            |
| TypeScript       | 6.0                                                            |                                                                                                                                               |
| 單元測試         | vitest 4 + testing-library + jsdom + **fast-check**            | property-based                                                                                                                                |
| 覆蓋率           | `@vitest/coverage-v8` ✅ 已接 CI                               | ⚠️ `v8-to-istanbul` / `@bcoe/v8-coverage` **沒有安裝** —— 它們只有在要把 E2E 的覆蓋率併進單元測試報告時才需要，而那個沒做（見下）             |
| 突變測試         | Stryker 10                                                     | ✅ `mutation.yml`（dispatch + 每週）。⚠️ 盤點原本寫「本機工具，不接 CI」—— 反過來了：開發機就是 NAS 本體，**不能**在本機跑，只能在 Actions 上 |
| E2E              | Playwright + `@axe-core/playwright`                            | ✅ `e2e.yml`（push / PR）                                                                                                                     |
| 效能預算         | `@lhci/cli`                                                    | ✅ `e2e.yml` 的第二個 job                                                                                                                     |
| 死碼             | knip 6                                                         | ✅ 已接 CI                                                                                                                                    |

### 2.2 後端

| 層       | 工具                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| 型別橋   | specta 2.0-rc.25 + specta-typescript + specta-serde                                      |
| 格式     | `cargo fmt`（`rustfmt.toml`：`max_width=110`，**不帶** `use_small_heuristics`；見 §4.4） |
| Lint     | `cargo clippy --locked --all-targets -- -D warnings`                                     |
| 測試     | **`cargo nextest run --no-fail-fast`**                                                   |
| 覆蓋率   | `cargo llvm-cov nextest --fail-under-regions N`                                          |
| 突變測試 | `cargo mutants --file <單檔>`                                                            |
| 未用相依 | `cargo shear`                                                                            |
| 漏洞     | `cargo audit`                                                                            |
| 錯字     | `typos`                                                                                  |
| API fuzz | schemathesis（吃 utoipa 的 OpenAPI）                                                     |

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

| 檔案                                  | 為什麼值得跑                              |
| ------------------------------------- | ----------------------------------------- |
| 權限 / 路徑檢查                       | 守衛被削弱不會有任何症狀，只是安靜地放行  |
| `share` 的過期與密碼判定              | 邏輯反了 = 分享連結永不過期，功能「正常」 |
| 2FA 的 TOTP window / backup code 消耗 | 少消耗一次 = 可重放，測試不會紅           |
| 配額 / 分頁 offset 算式               | 不會 crash，只會永遠回錯的數字            |

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
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
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

| 不建議                              | 改成                              | 理由                                                   |
| ----------------------------------- | --------------------------------- | ------------------------------------------------------ |
| `let _ = ...` 吞錯                  | `tracing::warn!` / `error!`       | 靜靜失敗沒人發現                                       |
| regex 每次呼叫重編譯                | `std::sync::LazyLock`             | 熱路徑                                                 |
| async 內 `std::fs`                  | `tokio::fs` 或 `spawn_blocking`   | 卡 worker                                              |
| `contains_key` 後 `get().unwrap()`  | `if let` / `unwrap_or` 單一表達式 | 消除 guard-drift panic                                 |
| `as` 截斷                           | `try_from().unwrap_or(...)`       | 靜默截斷                                               |
| `&String` / `&Vec<T>` 簽名          | `&str` / `&[T]`                   |                                                        |
| 複雜巢狀型別                        | type alias                        | `clippy::type_complexity`                              |
| handler 內 `reqwest::Client::new()` | 走 `state.http`                   |                                                        |
| 硬編外部 URL                        | 注入點（`ExternalUrls` 之類）     | **測試會真的打外網，結果取決於別人的服務今天有沒有掛** |
| 裸 `#[allow(...)]`                  | 一律帶 `reason = "..."`           |                                                        |

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

| 設定                                                       | diff 區塊      |
| ---------------------------------------------------------- | -------------- |
| `max_width=100`（rustfmt 預設）                            | 598            |
| **`max_width=110`**                                        | **590** ← 採用 |
| `max_width=120`                                            | 582            |
| `max_width=110` + `use_small_heuristics="Max"`（web 那份） | 600            |
| `max_width=120` + `Max`                                    | 608            |
| `max_width=100` + `Max`                                    | 586            |

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

| 項目                 | 現在                               | 之後                  |
| -------------------- | ---------------------------------- | --------------------- |
| Production Node 進程 | 1                                  | **0**                 |
| 首屏                 | HTML shell → hydrate → 打 auth     | 直接打 auth（少一輪） |
| Entry bundle         | Monaco/xterm/recharts 幾乎全塞一包 | 開哪個 app 才載哪包   |
| Dev HMR              | Next 秒級                          | Vite 毫秒級           |
| 部署單位             | 2 容器                             | 1 顆 Rust binary      |

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

| 項目      | 做法                                                                         |
| --------- | ---------------------------------------------------------------------------- |
| 金鑰輪替  | 三個金鑰換新值，其餘 20 個鍵逐字元不變（`.env.bak-pre-rotation-*` 留底）     |
| 歷史清除  | `git filter-repo --invert-paths --path .env`，40 個 commit 全清後 force push |
| gitignore | 兩邊都修好；`.env.bak-*` 也一併擋掉（裡面是舊金鑰）                          |
| 備份      | `/home/timo9378/Server/backup-*-20260830-012053.git` 兩個 mirror             |
| monorepo  | subtree 重做一次，接的是清理後的後端歷史，`.env` 從未進入本 repo             |

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

## 9-bis. 附錄：路徑逃逸與 `StorageRoot`

### 起因

Phase 5 討論「哪些手刻 code 該換成套件」時，`cap-std` 排在第二順位 ——
它的價值是把路徑漏洞從「靠測試守」變成「寫不出來」。實際評估後**沒有採用**：

- `cap-std` 只有同步 API；`cap-tokio` 在 crates.io 上是 `0.0.0` 的空殼
- 這包後端有 40 處 `tokio::fs`，全包進 `spawn_blocking` 的風險遠大於收益

改成自己實作它的核心想法（`src/storage.rs`）。

### 問題的形狀

在此之前修過的五個路徑漏洞，**沒有一個是 `validate_path` 寫錯** ——
全部都是 handler 根本沒呼叫它。兩種寫法的型別一模一樣：

```rust
let p = validate_path(&state.storage_path, &user)?;   // 對
let p = state.storage_path.join(&user);               // 錯，長得一樣
```

`batch_copy` 甚至就緊接在**有**驗證的 `batch_move` 正下方，還是漏了。

### 做法

`StorageRoot` 把根路徑收成私有欄位，不實作 `Deref`／`AsRef<Path>`，也沒有
`join`。`AppState.storage_path` 換成它之後，那些寫法**編譯不過**。

| 方法                                | 用途                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `resolve(&str)`                     | 唯一的正規入口，會驗證                                                                   |
| `resolve_under(&'static str, &str)` | 內部目錄底下的使用者路徑（`.trash/<檔名>`）；`&'static str` 讓使用者輸入放不進第一個參數 |
| `internal(&'static str)`            | 純字面常數的內部目錄                                                                     |
| `relativize(&Path)`                 | 轉回相對路徑                                                                             |
| `as_path()`                         | 逃生口，只給不涉及使用者輸入的地方（`WalkDir`／WebDAV／`strip_prefix`）                  |

換型別後編譯器報了 **46 個錯誤**，那份清單就是這次的稽核結果。

### 因此發現的漏洞

| 位置                                    | 攻擊                                         | 需要什麼       | 後果                                                                                                        |
| --------------------------------------- | -------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| `share.rs` 建立＋存取                   | `file_path: "../../.."`                      | 一個一般帳號   | `/api/share/<id>/download` 讓**未登入者**下載／打包整棵上層目錄 —— SQLite（密碼雜湊）、`.env`（JWT secret） |
| `upload_link.rs` 上傳                   | multipart `filename="../../../x"`            | **不需要帳號** | 以 server 身分任意寫檔（本機容器掛 docker.sock + `pid: host`）                                              |
| `upload_link.rs` 建立                   | `target_path: ".."`                          | 一個一般帳號   | 同上                                                                                                        |
| `file.rs` `batch_copy`                  | `paths` / `destination` 帶 `..`              | 一個一般帳號   | worker 端任意複製                                                                                           |
| `trash.rs` `permanent_delete`           | `..%2F..%2Fx`（axum 的 `Path` 會解碼 `%2F`） | 一個一般帳號   | 任意刪檔                                                                                                    |
| `trash.rs` `restore_file`               | 同上                                         | 一個一般帳號   | 把儲存根外的檔案搬進自己的目錄                                                                              |
| `version.rs` `restore_version`          | `version_id` 直接 join                       | ——             | 目前被路由參數數量不符擋住（見下），修了以防日後打通                                                        |
| `tag.rs` / `file.rs:409` / `indexer.rs` | DB 欄位直接 join                             | 低             | 索引器寫入的路徑不該當可信輸入                                                                              |

全部有 `backend/tests/path_escape_tests.rs` 的 PoC，且逐一**反向驗證**過
（拆掉修正確認會紅）。

⚠️ 兩支 trash 的測試第一次寫出來是**假綠**的 —— `.trash` 目錄不存在時，
`<storage>/.trash/../../x` 的 stat 在走到穿越之前就先失敗、handler 回 404。
這是本輪第 5 次踩到「綠得毫無理由」，也是反向驗證唯一一次真的救到。

### 已知的邊界

- `as_path()` 仍然拿得到 `&Path`，拿到就能 `join`。它從「預設行為」降級成
  「要顯式寫出來的動作」，全專案 28 個呼叫點可以 grep 出來，目前無一接使用者輸入。
- `StorageRoot` 只保護**根**。從 `resolve()` 拿到的 `PathBuf` 還是有 `join` ——
  `version.rs` 的 `.versions/<parent>/<version_id>` 就是這樣漏的。

### 順帶發現：`restore_version` 從來沒能用過

路由是 `/versions/restore/:version_id`（一個參數），handler 卻抽
`Path<(String, String)>`。實測：

```
POST /api/versions/restore/abc
→ 500  Wrong number of path arguments for `Path`. Expected 2 but got 1
```

前端 `useFiles.ts:328` 有在叫它。修它需要決定 API 形狀（檔案路徑要從哪來），
且要一併改前端，所以**沒有在這次動**。

---

## 10. 附錄：Phase 2 對拍出來的前後端不一致

手寫型別換成 specta 產生之後，`tsc` 立刻報出 18 個錯 —— 每一個都是真的不一致。
下面前四項**已在 `5b76798` 修掉**，第五項是**未解、需要你裁示**的。

### 已修

| #   | 問題                                                                                                   | 影響                                                                     |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 1   | `f32/f64` 實際是 `number \| null`（serde_json 把 NaN/Infinity 序列化成 null），手寫型別宣告成 `number` | `cpu_usage` 讀不到取樣時是 NaN → `.toFixed(1)` 當場拋錯。13 處補 `?? 0`  |
| 2   | `InitUploadResponse.uploaded_size` 是 `Option<i64>` → 序列化成 **null 而非省略欄位**                   | `!== undefined` 永遠成立，斷點續傳的 `startOffset` 被設成 `null`         |
| 3   | `LoginRequest` 只有 `username`/`password`，前端多送 `remember`                                         | serde 靜默丟棄 → **登入頁的「記住我」從來沒作用過**。已停止送出並標 TODO |
| 4   | `JobUpdate` 沒有 `type` 欄位                                                                           | 手寫版憑空多宣告，toast 顯示 `undefined`                                 |

### 已修：WebSocket 協定（`2334724`）

原本這條 socket 上有**兩種不相容的封包格式**，而且整條路徑壞掉卻毫無症狀：

| 來源                    | 送出的形狀                                              |
| ----------------------- | ------------------------------------------------------- |
| `queue.rs` 的 broadcast | 裸 `JobUpdate`，**沒有 `type` 欄位**                    |
| `WsServerMessage`       | `{ "type": "DockerStats", "payload": … }`（PascalCase） |
| 前端比對的              | `'docker_stats'` / `'job_update'` / `'file_change'`     |

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

| 修掉的                             | 症狀                                                          |
| ---------------------------------- | ------------------------------------------------------------- |
| Terminal 卸載不關 WebSocket        | 每開關一次視窗就留一條連線與一個 xterm 實例                   |
| Terminal 初始分頁                  | （本輪自己弄壞又修好的）terminal 從來沒連上過                 |
| 拖放上傳不檢查大小                 | `handleDrop` 抓到初次 render 的閉包，`max_file_size` 整段跳過 |
| 切分頁後鍵盤／滑鼠側鍵作用在舊分頁 | setter wrapper 沒進 deps，抓到舊的 `activeTabId`              |
| Dock 的視窗預覽縮圖                | 讀 `props.url`，但沒有人設過那個欄位——分支從沒渲染過          |
| 上傳連結頁的 `max_files: 0`        | JSX 把 0 印在畫面上，且外層判斷把 0 當成「沒有限制」          |
| 分享／上傳連結的「永不過期」       | 手抄的型別寫成 `string \| undefined`，後端送的是 `null`       |

重新部署：

```bash
cd /home/timo9378/Server
VITE_RELEASE=$(git -C Koimsurai-NAS rev-parse --short HEAD) \
  docker compose up -d --build backend
```

### 已安裝但完全沒接的工具

| 工具                  | 現況                                                         | 接上要做什麼                                         |
| --------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| `fast-check`          | ✅ 已用（5 個純函式模組各有 property test）                  | 見下                                                 |
| `knip`                | ✅ 已接 CI（`knip.json` + `pnpm knip`）                      | 導入時掃出 4 個沒人 import 的檔案與 5 個沒用到的套件 |
| `@vitest/coverage-v8` | ✅ 已接 CI，門檻 statements/lines 8、functions 7、branches 6 | 見下                                                 |

**⚠️ 前端覆蓋率的數字差了 5.6 倍，取決於怎麼設定。**

v8 預設只把**被測試碰到的檔案**列入分母 —— 那樣顯示 **51.84%**，也就是
「已測檔案的品質」。當棘輪用毫無意義：新增一整支沒有測試的檔案，分母根本不會動。

加上 `all: true` **還不夠**，必須同時給 `coverage.include`，否則它仍然只列出
被 import 到的那些（實測少了 `components/desktop`、`components/mobile`、
`features`、`hooks` 整整四個目錄）。兩者都設定之後的誠實數字是 **9.26%**
（statements 408/4402）。

該看的是分佈而不是總數：有測的集中在抽出來的純邏輯（`finder` 的
history / selection / marquee、`chunk-plan`、`errors`、`file-icons`、`a11y`、
兩個 store）與三支元件；`Finder` / `FileList` / `DesktopIcons` / `MobileLayout`
這四支（合計約 3600 行）仍然沒有測試，而那正是分母的大宗。
| `cargo llvm-cov` | ✅ 已接 CI，門檻 `--fail-under-regions 46` | — |

### 工具鏈盤點的完成度

盤點表列的工具**全部引入並接上 CI**，只有兩項例外，兩項都是刻意的：

| 未做                                   | 為什麼                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v8-to-istanbul` / `@bcoe/v8-coverage` | 這兩個只有在要把 **E2E 的覆蓋率併進單元測試報告**時才需要（盤點的備註「合併 dump 一定要用 `mergeScriptCovs`」講的就是那件事）。合併需要對 production bundle 做 instrumentation、從 Chromium 的 CDP 收 v8 dump、再合併 —— 而目前真正有用的訊號（**哪些檔案一條測試都沒有**）逐檔表已經看得到了。要一個「合併後比較好看的數字」不值得這些工。 |
| `dnd-kit` 只用在桌面圖示               | Finder 的檔案拖放仍是 HTML5 原生 DnD，因為它跟「從 OS 拖檔進來上傳」交織在一起，後者需要 `dataTransfer.files`，dnd-kit 拿不到。硬換會弄壞上傳。要做得先把「內部搬移」與「OS 上傳」兩條路徑拆開，那是獨立的一次重構。                                                                                                                        |

### 工具鏈盤點列的東西已全部引入

| 工具                   | 接在哪                            | 導入當天抓到什麼                                                                  |
| ---------------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| Playwright             | `e2e.yml`（push / PR）            | SPA fallback 的兩半（深層路由回 index.html、`/api` 不被接走）先前只有後端測試守著 |
| `@axe-core/playwright` | 同上                              | **兩個 critical**，見下                                                           |
| Stryker                | `mutation.yml`（dispatch + 每週） | **7 個真的斷言缺口**，見下                                                        |
| `@lhci/cli`            | `e2e.yml` 的第二個 job            | 基準線見下                                                                        |
| schemathesis           | `api-fuzz.yml`                    | 28 個 panic + 4 個使用者會踩到的 bug（先前記錄）                                  |

#### axe 抓到的兩個 critical

- `aria-allowed-attr`（桌面，3 個節點）：`PopoverTrigger asChild` 包在純
  `<div>` 上。Radix 會把 `aria-controls` / `aria-expanded` 掛到子元素，而 `div`
  不允許那些屬性。**更要緊的是那三顆按鈕根本 Tab 不到** —— 控制中心、通知、
  Dock 的設定鍵，鍵盤使用者全都按不到。改成 `<button type="button">`。
- `button-name`（登入頁）：icon-only 的送出鈕沒有可讀名稱，螢幕閱讀器唸出來
  只有「按鈕」。補 `aria-label`。

修完兩頁都是 0 個 serious/critical，`e2e/a11y.spec.ts` 把它當棘輪守著。

#### Stryker 抓到的斷言缺口

第一次跑 **89.02%**（248 個突變、25 個存活）。補完測試後 **100%**
（226 killed / 0 survived），測試從 140 條變成 163 條。

最值得記的一個：

> `icon-grid.ts` 的 `snapToGrid` 把 `- DESKTOP_PADDING` 改成 `+` 之後，
> **property test 照樣過** —— 因為那條 property 是
> `snapToGrid ∘ gridToPixels = id`，而兩個方向共用同一組常數，**錯誤互相抵消**。
>
> 這是往返型 property test 的固有盲點：它驗的是兩個函式互為反函式，不是驗
> 任何一個是對的。要釘住常數只能放絕對座標的死值。

其餘的缺口都同一個形狀：**property test 驗「關係」，而關係在算術被改壞時
往往仍然成立**。`marquee.ts` 的 `available - GRID_PADDING * 2`、
`cellWidth + GRID_GAP` 被改掉之後，「索引遞增」「框變大選取只增不減」全都還是真的。

另外三個是純粹沒測到的分支：

- `errors.ts` 三處 `err.response?.data` 的 `?.` 被拿掉後存活 —— 代表**沒有任何
  測試餵過「沒有 response 的 axios 錯誤」**，而那正是斷網，也正是這幾支最需要
  撐住的情況（少了 `?.` 就是 TypeError）。
- `overlaps` 的註解寫著「含邊界相接」，但沒有測試讓兩個邊剛好相等。
- `selection.ts` 的 `if (name !== undefined)`：錨點比清單長時（在第 5 項設錨點、
  檔案被刪到剩 3 項、再 Shift+Click）會把 `undefined` 放進選取集合，
  之後送給 API 就是檔名 `"undefined"`。

有 9 個突變是**等價突變**（數學上打不死），已在 `marquee.ts` 用
`// Stryker disable next-line` 標註並附證明 —— 例如 `available > 0` 之後
`cellWidth` 恆 ≥ 100 或等於 `available`，所以 `if (cellWidth <= 0)` 那行是死碼。
標註而不是硬湊測試，是因為為了打死等價突變寫出來的測試沒有任何意義。

#### dnd-kit：桌面圖示的拖曳

原本是手刻的 `mousedown` / `mousemove` / `mouseup`（`DraggableDesktopIcon`
裡約 60 行狀態機）。換掉它修好三件事：

| 問題                         | 原本                               | 現在                                               |
| ---------------------------- | ---------------------------------- | -------------------------------------------------- |
| **鍵盤完全不能移動圖示**     | 只聽滑鼠事件                       | 空白鍵拿起、方向鍵一格一格移、空白鍵放下、Esc 取消 |
| **觸控裝置完全不能移動圖示** | `mousedown` 在觸控上不會觸發       | `PointerSensor` 一次涵蓋滑鼠／觸控／觸控筆         |
| **落點用游標而不是圖示位置** | `snapToGrid(e.clientX, e.clientY)` | `movePositionBy(位置, 位移)`                       |

第三個是真的 bug：抓著圖示的**右下角**拖，放手時它會跳到游標所在的格子，
而不是它看起來所在的格子 —— 偏移將近一格。用位移就跟「抓在哪裡」無關了。
純函式抽在 `icon-grid.ts`，有定樁也有 property test。

兩個接線上的坑（都寫進程式碼註解）：

1. **`{...listeners}` 裡就有一個 `onKeyDown`**。自己的 `onKeyDown` 寫在後面會
   把它整個蓋掉，鍵盤拖曳完全不會啟動，而且**沒有任何錯誤** —— 只是功能不存在。
   要顯式串起來。順帶把鍵位分工釐清：Enter 開啟、空白拿起／放下
   （dnd-kit 預設兩個都吃，這裡刻意只留空白）。
2. **`attributes` 也帶 `aria-pressed`**（表示「已拿起」），跟原本用來表示
   「已選取」的撞在一起。TS 直接擋下（TS2783）。讓 dnd-kit 擁有拖曳語意，
   選取狀態改寫進 `aria-label` —— 對一個「按下去會開啟檔案」的 button 來說，
   `pressed` 本來就不是「已選取」的正確語意。

⚠️ **`Finder` 的檔案拖放沒有換。** 那裡是 HTML5 原生 DnD（`draggable` +
`dataTransfer`），而且跟「從 OS 拖檔進來上傳」交織在一起 —— 後者需要
`dataTransfer.files`，dnd-kit 拿不到。硬換的話會把上傳功能弄壞，
換到的只是同一批鍵盤可及性。要做的話得先把「內部搬移」與「OS 上傳」
兩條路徑拆開，那是獨立的一次重構。

驗證用 E2E（`e2e/desktop-icons.spec.ts`）而不是單元測試：dnd-kit 的
`KeyboardSensor` 讀 `event.code`、量元素矩形、靠真正的 focus，jsdom 撐不住。
而且要驗的是「一個原本不存在的功能現在存在」—— 那本來就沒有單元測試蓋得到。

#### tus 1.0.0（可續傳上傳）

前置是 axum 0.7 → 0.8（見對應的 commit）。

**只用 `tus-protocol`，不用 `tus-axum` / `tus-server`。** 後兩者
`cargo add` 下去會拖進 **67 個 crate** —— `opendal`、`aws-lc-sys`（要 cmake 的
C/組語密碼庫）、`jni`（Java Native Interface）、`clap`、`figment`。為了續傳上傳
把那些放進建置相依完全不成比例，而且 `tus-axum` 當時是 **92 次下載、單一版本、
六週前發布**。`tus-protocol` 單獨加只多**一個** crate、零傳遞相依：
它是「自帶儲存」的純協定核心。

代價是 `backend/src/handlers/tus.rs`（HTTP 動詞 → 協定呼叫的轉接）。
換到的是**落地流程仍然在我們手上**：檔案要落到哪走的是
`StorageRoot::resolve`，不是第三方 crate 的 storage 抽象。

| 端點                   |                                     |
| ---------------------- | ----------------------------------- |
| `OPTIONS /api/tus`     | 能力探索                            |
| `POST /api/tus`        | 建立上傳（含 creation-with-upload） |
| `HEAD /api/tus/{id}`   | 問傳到哪                            |
| `PATCH /api/tus/{id}`  | 續傳；補完最後一塊時觸發落地        |
| `DELETE /api/tus/{id}` | 放棄                                |

前端 `tus-js-client`。除了「用套件而不是手刻」之外的實際差別：

- **關掉瀏覽器再打開也能續傳。** 舊版的 `upload_id` 只活在 zustand 的 store
  裡（記憶體），重新整理就沒了，只能整份重傳。
- **offset 由伺服器說了算**：每次續傳前先 HEAD。舊版由客戶端自己算，
  而那個不一致正是先前那個「續傳重送已傳位元組」的 bug。

⚠️ 舊的 `/api/upload/*` **後端端點保留**（仍有測試、89.5% 覆蓋率），
前端已不再呼叫。留著是為了萬一 tus 在正式環境出問題時還有東西可以退回，
確認穩定之後再下線。前端的死碼（`planChunks` 與兩個 hook）已經刪掉。

##### 接線時踩到的四個坑

1. **`RequestBody::empty()` 不等於 `absent()`。** axum 的 `Bytes` 抽取器在
   沒有 body 時給空 `Bytes`，我一律傳 `from_bytes` → 協定把單純的建立當成
   creation-with-upload → 要求 `Content-Type: application/offset+octet-stream`
   → 每個 `POST` 都是 **415**。要靠 Content-Type 分辨。
2. **CORS layer 會吃掉所有 OPTIONS。** `tower-http` 的 `CorsLayer` 對
   **每一個** OPTIONS 都短路（不是只有真的 preflight），所以 tus 的能力探索
   永遠送不出 `Tus-Version` / `Tus-Extension`。tus 的路由因此刻意掛在
   `.layer(cors)` **之後**。代價是零：那個 CORS 設定是 `allow_origin(Any)`
   且無 credentials，而本 API 是 cookie 認證 —— 跨來源呼叫本來就不成立。
3. **PATCH 的回應不帶 `Upload-Length`。** 我原本拿 PATCH 的標頭判斷「傳完了沒」，
   於是落地**永遠不會發生**。而這個 bug 差點溜過去：兩支路徑逃逸的測試
   「通過」了 —— 檔案根本沒被寫出去，當然也沒逃出去。是「檔案應該落在儲存根」
   那兩條把它揪出來的，之後再用拆掉 `resolve` 的方式反向驗證了逃逸測試。
4. **`page.evaluate` 裡不能 `import("tus-js-client")`** —— bare specifier
   瀏覽器解析不了。改用 `addScriptTag` 注入 node_modules 裡同一版的 dist。

##### 變異測試又抓到兩個

- `normalizeParentPath` 開頭的 `if (path === "/" || path === "") return ""`
  是**冗餘**的（六個突變全部存活）—— 那兩個輸入經過後面兩個 `replace`
  本來就會變成 `""`。刪掉。
- `/^\/+/` 的 `^` 錨點拿掉之後測試照樣過。有開頭斜線時第一個匹配剛好就是它，
  結果一樣；**沒有**開頭斜線時就會咬掉中間那個分隔符，`"Documents/2026"`
  變成 `"Documents2026"` —— 檔案落到錯的目錄。補了一條測試釘住。

`startTusUpload` 本體用 `// Stryker disable all` 排除並附理由：它只是把
`tus-js-client` 的三個呼叫串起來，由 `e2e/tus-upload.spec.ts` 守著，
在 vitest 裡硬湊 mock 只會測到 mock 本身。

#### ⚠️ 本機跑 E2E 的注意事項

在**這台機器**上，`pnpm e2e` 緊接在 CPU 吃重的指令之後（`pnpm build`、
`pnpm mutate`）有機率紅一條，重跑就過。三次失敗的共同點都是前一個指令
把 CPU 榨滿，而 Playwright 的 timeout（測試 30s、斷言 10s）在機器忙的時候
不夠 —— 這台就是跑著實際服務的 NAS 本體。

CI 有獨立的 runner，不受影響（實測本機紅、同一個 commit 在 CI 綠）。

**不要為了這個放寬 timeout** —— 那會讓真正的逾時問題也被蓋掉。
本機要連跑的話，中間讓機器喘一下。

#### Lighthouse 基準線

2026-08-31 在開發機量（三次中位數，量 `/login`）：

| performance | accessibility | best-practices | seo | FCP    | LCP    | TBT | CLS | 總傳輸   |
| ----------- | ------------- | -------------- | --- | ------ | ------ | --- | --- | -------- |
| 86          | 93            | 100            | 92  | 1144ms | 2168ms | 0ms | 0   | 2288 KiB |

⚠️ **只有不受機器速度影響的項目設成 error**（可及性分數、CLS）。GitHub 的
runner 慢得多，把 FCP/LCP/TBT 設成 error 會變成隨機紅燈，而一個會隨機紅的
門檻等於沒有門檻。

#### 導入時踩到的三個坑

1. **Stryker 卡在 "Creating test runner process(es)" 不動**：它把
   `node_modules` 一起算進專案（實測 54031 個檔案）然後複製到 sandbox。
   要顯式給 `ignorePatterns`。
2. **Stryker 找不到 vitest runner**：pnpm 的嚴格 `node_modules` 下自動掃不到，
   要在設定裡顯式列 `plugins`。
3. **lhci 整份報告 `FAILED_DOCUMENT_REQUEST`**：`scripts/e2e-server.sh` 原本把
   `RUST_LOG` 預設成 `warn`，而 lhci 的 `startServerReadyPattern` 等的
   `"running on"` 是一行 `tracing::info!` —— 被濾掉了，於是 lhci 在伺服器還沒
   listen 時就開始抓頁面。另外 `/` 會 client-side 導到 `/login`，Lighthouse 把
   那當 redirect 並 abort 主文件請求，所以直接量 `/login`。

### 後端覆蓋率的分佈

導入當下（2026-08-31）是 **25.19%**，補完幾批「壞了不會有症狀」的區塊、
再加上路徑逃逸那輪之後是 **48.50%**（functions 43.21 / lines 48.38），
CI 門檻 `--fail-under-regions 46`。

仍為 0% 的：`tag.rs`、`version.rs`、`permission.rs`、`job.rs`、`ws.rs`、
`system.rs`、`docker.rs`、`webdav.rs`、`utils/metadata.rs`。
其中 **`version.rs` 的 0% 不是「沒人測」** —— `restore_version` 永遠 500，
根本進不了函式本體（見 §9-bis）。`trash.rs` 只有 5.24%：路徑逃逸的測試
只碰到提早 return 的分支。

| 檔案                      | 覆蓋率         | 備註                                    |
| ------------------------- | -------------- | --------------------------------------- |
| `handlers/share.rs`       | 0 → **91.9%**  | 密碼與過期判定；邏輯反了 = 連結永不過期 |
| `handlers/upload_link.rs` | 0 → **88.7%**  | 唯一免身分就能寫檔案的端點              |
| `middleware/auth.rs`      | 48 → **94.6%** | 補測試時抓到一個 CSRF 繞過，見下        |
| `utils/jwt.rs`            | 52 → **90.0%** | 含金鑰輪替後舊 token 失效               |
| `handlers/terminal.rs`    | 0 → **64.3%**  | 白名單 + cd／補全；抓到五個逃逸，見下   |
| `handlers/upload.rs`      | 0 → **87.4%**  | 分塊續傳；抓到一個 IDOR，見下           |
| `utils/image.rs`          | 0 → **63.4%**  | magic bytes 判斷那半                    |
| `handlers/media.rs`       | 0 → **27.8%**  | 路徑處理那半；抓到三個路徑漏洞，見下    |

**補測試時抓到的 CSRF 繞過**：`middleware/auth.rs` 原本用
`origin_host.starts_with(host_val)` 比對 Origin 與 Host。Host 是
`nas.koimsurai.com` 時，攻擊者只要註冊 `nas.koimsurai.com.evil.com`，
送出的 Origin 就「以 Host 開頭」而通過檢查——那個網域完全由攻擊者控制。
改成 `eq_ignore_ascii_case`。相等比 `starts_with` 嚴格，但嚴格掉的**只有**
這種「Host + 後綴」的情形；合法的同源請求兩者本來就一字不差。

**補測試時抓到的受限 shell 逃逸**：白名單只檢查 `parts[0]`，但名單上有幾個
命令的**工作就是執行別的程式** —— `env bash`、`ls | xargs sh`、
`find . -exec bash -c id {} +`、`awk 'BEGIN{system("id")}'` 四個都實測可用。
這台容器掛著 `/var/run/docker.sock` 且 `pid: host`，逃出受限 shell 拿到的是
**宿主機的 root**。

處置分兩種，差別在「檢查得可靠嗎」：

- `env` / `xargs` / `find -exec` 的危險部分是**未加引號的獨立 token**
  （程式名、旗標），`split_whitespace` 切得開 → 加 `check_process_spawning` 擋掉。
- `awk` / `sed` 的危險部分藏在**引號裡的腳本本體**，而 `is_command_safe` 拿到的
  是未經 shell 拆解的字串，切不開也就擋不住（`system ("id")` 多一個空格就繞過
  字串比對）→ **整個從白名單移除**。做一個擋不住的檢查比沒有檢查更糟。

要把它們拿回來的話有兩條路：命令解析改成 quote-aware（shlex 之類），
或改用容器層級的隔離（seccomp／唯讀 rootfs）而不是命令白名單。

**第五個逃逸（`cd` 的路徑包含檢查）**：`canonical.starts_with(storage_base)`
用的是**字串**前綴。storage 是 `/data/storage` 時，`/data/storage-backup`
也「以它開頭」而被判定為在範圍內 —— 跟 CSRF 那次 `starts_with` 完全同一類錯誤，
在同一個 codebase 裡出現第二次。改用 `Path::starts_with`（比對路徑元件）。
terminal.rs 裡有三處同樣的寫法，一起抽成 `is_within_storage`。

目前的容器設定下還不可利用（`/data` 底下沒有同前綴的兄弟目錄），
但只要有人掛一個 `/data/storage-backup` 就成立了。

**補測試時抓到的 IDOR**：`upload_chunk` 與 `get_upload_status` 只用
`WHERE id = ?` 查工作階段，沒有比對 `user_id`。兩者都在 `require_auth` 後面，
所以攻擊者必須是**已登入**的使用者 —— 但那正是這個 app 的情境（邀請碼註冊，
本來就設計成多使用者）。後果是讀得到別人上傳中的檔名與目標路徑，
以及把內容摻進別人的檔案裡。`upload_id` 是 UUID 猜不到，但「猜不到」不是授權：
id 會出現在日誌、瀏覽器歷史、使用者自己貼出來的錯誤訊息裡。
改成 `WHERE id = ? AND user_id = ?`，並回 404 而不是 403 —— 不存在與不屬於你
對外表現要一樣，否則等於提供一個「這個 id 存在嗎」的探測器。

**`starts_with` 稽核抓到的三個路徑漏洞**（既然同一個模式已經出事兩次，
把後端所有 `starts_with` 與「把使用者輸入 join 到 storage 後面」的地方掃了一遍）：

| 端點                                   | 問題                                 | 嚴重度 |
| -------------------------------------- | ------------------------------------ | ------ |
| `GET /api/media/hls/serve`             | **任意檔案讀取**                     | 高     |
| `POST /api/upload/init`                | **任意檔案寫入**（`file_name` 沒驗） | 高     |
| `GET /api/media/stream`、`/hls/status` | 檔案存在性探測                       | 中     |

`hls_serve` 那個最嚴重：`cache.join(file)` 之後用 `Path::starts_with` 檢查包含
關係，但**那是純字面比對，不解析 `..`**——

    "/s/.hls_cache/abc/../../secret.txt".starts_with("/s/.hls_cache/abc") == true

元件是 `[…, abc, ParentDir, ParentDir, secret.txt]`，確實以 cache 的元件開頭。
檢查通過，`fs::read` 才由 OS 解析 `..`，而這個端點會把內容直接回給呼叫端。
已登入使用者只要那部影片轉過一次 HLS（快取目錄存在），就能讀走後端讀得到的
任何檔案——包括 `/data/db` 底下的 SQLite 資料庫。

這是 `starts_with` 在這包裡第三次出事。前兩次是「字元前綴 ≠ 元件前綴」
（CSRF 的 Origin、terminal 的 cd），這次是「元件前綴 ≠ 解析後的包含關係」。
處置：字面層只接受 `Normal` 元件，再 `canonicalize` 確認一次（擋符號連結）。
`stream_media` / `hls_status` 改走既有的 `validate_path`；`upload` 的
`file_name` 要求必須是單一 `Normal` 元件。

還是 **0%** 的（都是一般 CRUD，優先度低於上面那批）：
`handlers/trash.rs`、`tag.rs`、`version.rs`、`media.rs`、`audit.rs`、
`search.rs`、`permission.rs`。

### API 文件與 spec 匯出

`/scalar` 原本掛在 router 根層、沒有 `require_auth` —— `https://<host>/scalar`
對任何人都是 200，完整的端點清單、參數、schema 全部攤開。已移到
`require_auth` 後面（登入才看得到），並補一條測試釘住。

⚠️ 那份 spec **本身**仍然在 binary 裡，這道 layer 擋的是「不用登入就讀得到」。
真的要讓 production 完全沒有這份文件，得改成 feature flag 在編譯期拿掉。

`cargo run --bin export_openapi -- openapi.json` 把 spec 寫成檔案，
schemathesis 之後可以直接吃它，不必先起伺服器也不必偽造登入。

### 三條上傳路徑都沒有 flush

`tokio::fs::File` 有自己的緩衝，而它的文件明講：drop 時**不保證**資料已經
寫出去，drop 過程中的寫入錯誤會被**直接吞掉**。三條上傳路徑
（`upload.rs` 分塊續傳、`upload_link.rs` 匿名上傳、`file.rs` 一般 multipart）
都只 `write_all` 就結束，兩個後果：

1. 回應送出時檔案可能還沒完整落地 —— 客戶端上傳完立刻列目錄／下載會拿到
   截斷或不存在的檔案
2. 磁碟滿了之類的錯誤完全看不到，上傳回報成功而檔案是壞的

`upload.rs` 那條尤其嚴重：完成時會 rename 再讀 metadata 拿大小，而 rename 是
目錄操作 —— 資料還在緩衝裡的話，記進 `files` 資料表的大小會是錯的。

⚠️ 這個是**測試偶發紅一次**才發現的（機器忙碌時，`anonymous_upload_lands_in_the_target_folder`
斷言檔案存在失敗）。當下很容易當成 flaky test 重跑帶過 —— 那樣就會錯過它。

用 `flush` 而不是 `sync_all`：前者把緩衝推給 OS，之後任何讀取都看得到正確
內容也拿得到錯誤；後者還要 fsync 到實體磁碟（防斷電），對 10GB 級的上傳
代價太大，那是另一個層次的取捨。

### schemathesis（API fuzz）目前狀態

2026-08-31 最後一次：**50 個 operation、1610/1610 通過，綠燈。**
（接 tus 之前是 44 個 operation、1427 個案例。）

#### 讓 fuzz 真的打進去

綠燈不等於打進去了。schemathesis 自己的警告說得很清楚：

    Missing test data: 9 operations repeatedly returned 404 Not Found,
    preventing tests from reaching your API's core logic

「有被測到」跟「測進去了」是兩件事，而報告上看起來一樣。兩個原因、兩個修法：

1. **tus 的請求標頭不在 spec 裡。** schemathesis 不知道要送 `Tus-Resumable`，
   五個 operation 打出來幾乎全是 412，一次都沒進到 handler 本體。
   補上標頭參數，並且**用單一變體的 enum** 讓 spec 產出 `enum: ["1.0.0"]` ——
   標成自由字串的話它會亂產版本號，結果一樣全 412。
   **spec 要說出真正的約束，fuzz 才打得進去。**

2. **路徑參數是 UUID 與檔名，隨機產的一律不存在。**
   `scripts/fuzz_seed.py` 用真的 API 建出資源，把 ID 寫成 schemathesis 的
   `[dictionaries.*]` + `[[operations]] parameters`。
   破壞性的 operation（restore / delete / terminate）第一次呼叫就把資源消耗掉，
   所以每一種種 **25 份**（`--max-examples 20` 用得完）。

|                   | 之前 | 之後      |
| ----------------- | ---- | --------- |
| 產生的案例        | 1427 | **1610**  |
| fuzzing 階段耗時  | 6.9s | **19.1s** |
| schema 約束對不上 | 16   | 13        |
| 拿不到有效資料    | 9    | 8         |

⚠️ **剩下的 8 個是有狀態 fuzz 的固有上限，不打算再追。** fuzzer 自己會用
DELETE/restore/terminate 把種好的資源打壞，之後的案例就一路 404。要歸零得在
各階段之間重新種資料或做逐 operation 的隔離，schemathesis CLI 做不到，
而投入報酬已經明顯遞減 —— 耗時翻近三倍代表真正進到 handler 的量已經上去了。

#### 種子腳本導入當天抓到的 bug

`POST /api/tags/add/{path}` 重複加同一個標籤 → **500**，而且把 SQLite 的原始
錯誤字串原封不動送出去：

    {"error":"... UNIQUE constraint failed: file_tags.user_id, ..."}

狀態碼是錯的（客戶端造成的，不是伺服器壞了），還洩漏資料表與欄位名稱。
而重複加標籤是使用者一定會做的事（點兩下、兩個分頁各點一次）。
改成 `ON CONFLICT DO NOTHING` —— 「把標籤加上去」本來就該是冪等的。
`tag.rs` 先前是 0% 覆蓋率，一併補了 `tests/tag_tests.rs`。

補上 tus 的 utoipa 標註之後第一次跑就打出兩個 `status_code_conformance`
失敗，兩個都是**標註寫錯**不是伺服器 bug：

- `OPTIONS /api/tus` 實際回 200，標成 204。tus 規格說 SHOULD 回 204 **或**
  200，而 `tus-protocol` 選了 200 —— 標註要照**實際行為**寫，不是照規格抄。
- `DELETE /api/tus/{id}` 會回 412（缺 `Tus-Resumable`），漏標了。

這正是把端點放進 spec 的理由：spec 與實作對不上的地方，只有拿 spec 去打
實作才看得出來。

另外 `scripts/schemathesis_hooks.py` 把 `application/offset+octet-stream`
alias 到內建的 `application/octet-stream` —— 沒有它，tus 的兩個吃 body 的
operation 會直接報 `Serialization not possible` 而不是被 fuzz。

⚠️ 先前那兩個原因不明的 `Network Error` 這次**沒有出現**。它們是間歇性的，
不代表已經解決。

### schemathesis（API fuzz）第一次跑的結果

用 `export_openapi` 產的 spec，對一個**獨立的測試實例**（PORT=3099、
自己的 temp DB 與 storage）跑。⚠️ 絕對不要對 production 跑 —— 它會發
DELETE、清垃圾桶、刪檔。

第一次跑就撞出 **28 個 panic**（3 種）：

| 位置          | 觸發                       | 說明                                                                                                                                                    |
| ------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit.rs:38` | `page` 或 `limit` 是大整數 | `(page - 1) * limit`：`page=i64::MIN` 時減法先 underflow，大 page 時乘法 overflow。limit 這裡還**完全沒有上限**（file.rs 早先修過同一件事，這支被漏掉） |
| `file.rs:385` | 同上                       | `.max(0)` 在減法**之後**才執行，救不到 underflow                                                                                                        |
| `chrono`      | `expires_in_seconds` 很大  | `Duration::seconds` 超範圍是 **panic** 不是回 Err，而那個值直接來自 body。這條 release build 也會 panic                                                 |

⚠️ 前兩個在 release build 的整數溢位預設是 **wrapping** —— 不會 panic，
只是算出一個荒謬的 offset。那比 panic 更難查。

修完 panic 之後剩下兩個真的問題：

- **`GET /api/search?q="` → 500**，而且錯誤訊息原封不動回給客戶端
  （`{"error":"Syntax Error: ..."}`）。tantivy 把輸入當**查詢語言**解析，
  `"` `(` `)` `+` `-` `:` 都是運算子 —— 使用者在搜尋框打一個引號就 500。
  改用 `parse_query_lenient`。
- **`GET /api/thumbnail/{size}/{path}` 對目錄會讓連線中斷**。目錄也「存在」，
  交給 `ServeFile` 之後會宣告 chunked encoding 卻送不出任何 chunk。
  改成檢查 `is_file`。

剩下的 failure 幾乎都是 **spec 漂移**（沒有記載的狀態碼 43、`Allow` header
不符 7、宣告了伺服器不支援的方法 6）——那是文件品質問題，不是 bug，
之後補 utoipa 的 `responses(...)` 標註即可。

**已接 CI**（`.github/workflows/api-fuzz.yml`）：workflow_dispatch + 每週日
20:00 UTC + PR 動到 `backend/` 時。

CI 上守著的檢查：`server_error`（5xx / panic）、`not_a_server_error`、
`status_code_conformance`、`ensure_resource_availability`。

**`status_code_conformance` 已經放回來了**（原本 45 個失敗）。做法不是逐支補
`responses(...)` —— 46 個 operation 裡只有 6 個記載 401、**0 個記載 500**，而
那些不是各端點特有的行為，是共用機制的產物（`require_auth` 可以讓任何受保護的
端點回 401／403、`AppError` 可以讓任何 handler 回 400／404／500、axum 的路由器
產生 405、`Json<T>` extractor 產生 422）。逐支複製只會變成 46 份會各自走鐘的
重複。改用 `routes/mod.rs` 的 `CommonErrorResponses` modifier 一次補上，再修掉
三處真的標錯的碼（share 與 upload/init 寫 201 但實際回 200、batch/copy 寫 200
但實際回 202、upload/init 漏了 409）。現在 1380 個測試案例全過。

⚠️ 那份共用清單是**超集**：公開端點（登入、註冊、分享連結）其實不會回 401。
接受這個不精確是因為反方向的代價比較大 —— schemathesis 檢查的是「收到了文件
沒寫的狀態碼」，多寫不會誤報，少寫會讓 45 個真實回應被當成失敗而淹掉真問題。
要更精確得在 modifier 裡維護一份公開路徑清單，那份清單本身又會跟路由走鐘。

**`response_schema_conformance` 也放回來了**（原本 3 個失敗）。三個是同一個根因：
`NaiveDateTime` 序列化成 `"2026-08-31T04:53:47"` —— 沒有時區，不符合 spec 標的
`format: date-time`（RFC 3339）。

⚠️ 那不只是文件問題。JS 的 `new Date()` 對「有 T、無位移」的字串是按**本地時間**
解析的（ES2015 起的規範），所以稽核紀錄的時間在畫面上整個偏一個時區
（這台是 Asia/Taipei，差 8 小時）。而 `TopBar.tsx` 裡本來就有一段針對這個症狀的
workaround —— 它比對 `"YYYY-MM-DD HH:mm:ss"`（空格分隔）然後補 Z，但後端送的是
**T 分隔**，那個 regex **從來沒有命中過**。也就是有人發現過這個問題、寫了補救，
而補救打偏了。

處置：`AuditLog` / `Job` / `UploadSession` / `User` 的時間欄位全部改成
`DateTime<Utc>`（一律送帶 Z 的 RFC 3339），前端的 workaround 直接刪掉。
後端補一條測試釘住「送出去的時間戳一定解析得動且帶時區」。

還關著的五條（每清完一條就從 workflow 拿掉一個）：`positive_data_acceptance`（8）、
`negative_data_rejection`（3）、`unsupported_method`（6）、
`allow_header_conformance`（7，伺服器誠實列出 PUT 但 spec 少了那個 operation）、
`missing_required_header`。

⚠️ **已知的間歇性紅燈**：偶爾（不是每次）會有 1 個 `Network Error`，出現在
Coverage 階段對 `QUERY` 這種非常規方法的探測上。本機逐一試過並排除：
schemathesis 給的重現指令、keep-alive 連線重用、`Transfer-Encoding: chunked`、
`Expect: 100-continue` —— 全部拿到乾淨的 405；server log 也沒有任何 panic，
同一輪 1348 個案例全過。**沒有結論。**

留著不抑制的理由：「伺服器關閉連線但不回應」正是 panic 會有的表徵，抑制掉
就等於把最該知道的那種故障一起蓋住。判讀看 job summary 印出來的 panic 次數。

⚠️ **stateful 階段暫時關掉**，理由與上面同一條：它產生 420 個
「Connection aborted. Remote end closed connection without response」——
連線層級而不是回應層級的錯誤。本機用同樣的請求（含 schemathesis 給的
`curl -X QUERY` 重現指令）打不出來、伺服器回乾淨的 405、server log 的 panic
數是 0、同一輪有 13,095 個案例通過。看起來是持續高頻請求下的 keep-alive／
連線池行為，**但沒有證實**，只是排除了幾種可能。要重新調查把 `--phases` 那行
拿掉即可；stateful 測的是 API link 的串接順序，本身有價值。

第一次在 CI 上跑又抓到一個：`POST /api/upload` 帶 `filename=""`（multipart
的合法編碼）→ `target_dir.join("")` 等於目錄本身 → `File::create` 對目錄執行
→ `500 {"error":"Is a directory (os error 21)"}`。狀態碼錯，而且把 OS 錯誤
字串送給客戶端。

### 續傳的客戶端算錯位置（而伺服器的防護從沒被觸發過）

補前端測試時抽出 `features/files/chunk-plan.ts` 才發現的，兩個問題互相掩蓋：

1. **客戶端從來沒送過 `X-Upload-Offset`。** 後端有一道「位移對不上就回 409」
   的檢查（`handlers/upload.rs`），而且有測試蓋著 —— 但正式環境的前端不送那個
   header，所以那道防護**從未被觸發過**。
2. **續傳會退回分塊邊界。** 原本是
   `Math.floor(startOffset / CHUNK_SIZE)` 之後從 `i * CHUNK_SIZE` 開始送，
   而那個位置早於 `startOffset`。`startOffset` 不是分塊大小整數倍時
   （也就是**上一次剛好斷在分塊中間**，正是續傳會發生的情境），已經寫進
   伺服器的那段會被**重送一次**。伺服器是 append 模式，結果是一個比原檔更長、
   內容錯位的檔案，而上傳回報成功。

有 (1) 的話 (2) 就是靜默的。修法：`planChunks` 從 `startOffset` 這個**位元組**
開始切，並且每一塊都帶上自己的 offset 送出去。

順帶修掉空檔案：`planChunks(0)` 會回一塊空的 chunk。不送的話伺服器的
`new_size >= total_size` 永遠不成立，工作階段一直開著、檔案卡在
`.temp_uploads`，而畫面上顯示上傳成功。前後端各有一條測試蓋這個。

### Property testing（fast-check / proptest）

⚠️ 這兩個工具**先前是裝了但沒用**（`fast-check` 0 次、`proptest` 只有 1 處），
而這輪抽出的五個純函式模組每一個都是 property 的教科書題目。最諷刺的是
`chunk-plan.test.ts` 裡那條「每一塊都不超過分塊大小、首尾相接沒有洞」——
那本來就是一個 property，卻只餵了一組輸入。

現在補上的不變式（定樁測試很難蓋到的那種，因為它們是「輸入空間全體」或
「兩次呼叫之間的關係」）：

| 模組                 | 不變式                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `chunk-plan`         | 分塊剛好鋪滿 `[offset, size)`，不重疊也沒有洞；續傳不重送任何已傳的位元組                                    |
| `finder/history`     | `index` 永遠落在 `entries` 範圍內（破了就是 `/files/undefined`）；上一頁再下一頁回到原位；邊界回傳同一個物件 |
| `finder/selection`   | 選取內容永遠是清單裡真實存在的檔名；`anchorIndex` 不越界；Ctrl+Click 兩次自我反轉；Shift 只增不減            |
| `finder/marquee`     | **框變大時選取只增不減**（單調性）；兩角互換結果相同；索引遞增不重複                                         |
| `desktop/icon-grid`  | `snapToGrid ∘ gridToPixels = id`；永不回負值；不同 index 不落同格                                            |
| 後端 `validate_path` | 回 Ok 就一定在 base 底下且結果不含 `ParentDir`；任何含 NUL 一律拒絕；一般相對路徑一定通過                    |

後端那組是針對這輪五個路徑類漏洞補的 —— 它們的共同特徵是「只有特定形狀的
輸入才會破」（同前綴的兄弟目錄、元件前綴通過但解析後跑出去、NUL 要碰檔案
系統才炸），定樁測試只蓋得到想得到的那幾種。NUL 那條有反向驗證過
（退回修正之前會紅）。

### 程式面的已知債

- 已抽出四塊純邏輯並各自有測試：`finder/history.ts`（上一頁/下一頁）、
  `finder/selection.ts`（點擊選取）、`finder/marquee.ts`（框選幾何）、
  `desktop/icon-grid.ts`（桌面圖示的網格座標）。剩下的（拖放、重新命名、
  虛擬清單的整合、`MobileLayout`）仍在元件裡。
- `MobileLayout.tsx` 約 975 行，還沒抽也還沒測。
- `window-store` 的 `newWindow as WindowState`：判別式聯集的關聯 TS 證不出來，
  呼叫端有泛型簽章擋著，理由寫在該行旁。
- 前端測試涵蓋 17 個檔案；`MobileLayout` 仍然沒有測試。
