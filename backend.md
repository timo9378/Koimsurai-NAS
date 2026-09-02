# Koimsurai NAS

這是一個使用 Rust 構建的高效能 NAS (Network Attached Storage) 後端系統，專注於速度、可靠性與豐富的媒體功能。

## ✨ 核心功能

### 📂 檔案管理

- **基本操作**: 支援檔案與資料夾的上傳、下載、刪除、重新命名。
- **批次處理**: 支援多檔案的批次刪除、移動與複製。
- **斷點續傳**: 支援大檔案分塊上傳 (Chunked Upload)，網路中斷可續傳。
- **版本控制**: 檔案覆蓋時自動備份舊版本，可隨時還原。
- **垃圾桶機制**: 刪除檔案進入垃圾桶，防止誤刪。

### 🏷️ 組織與搜尋

- **標籤系統**: 為檔案添加自定義標籤 (Tags) 與顏色。
- **我的最愛**: 快速標記常用檔案 (Star)。
- **全文搜尋**: 整合 Tantivy 搜尋引擎，支援檔名與內容搜尋。
- **進階篩選**: 支援依名稱、大小、修改時間排序與分頁。

### 🎬 媒體中心

- **即時串流**: 支援影片線上串流播放。
- **即時轉檔**: 整合 FFmpeg，支援不同解析度 (Transcoding) 的即時轉檔。
- **智慧時間軸**: 自動依據日期聚合照片與影片，呈現類似 Google Photos 的時間軸視圖。
- **縮圖生成**: 自動生成圖片與影片縮圖 (Small, Medium, Large)。

### 🛡️ 安全與權限

- **使用者認證**: 完整的註冊、登入、登出機制。
- **權限控制**: 基於使用者的資料夾讀寫權限管理。
- **分享連結**: 建立帶有密碼保護與過期時間的公開分享連結。
- **稽核日誌**: 記錄破壞性操作（刪除、批次移動／複製、清空垃圾桶、還原、
  版本還原），供管理員查詢。清單見下面的 API 章節。

### ⚙️ 系統與整合

- **WebDAV**: 完整支援 WebDAV 協定，可掛載為網路磁碟機 (Windows/Mac/Linux)。
- **背景任務**: 內建 Job Queue 處理耗時任務 (轉檔、縮圖、索引)，並透過 WebSocket 即時推送進度。
- **系統監控**: 提供 CPU、記憶體與磁碟使用率的即時狀態 API。

---

## 🚀 快速開始

### 前置需求

1. **Rust**: 最新穩定版。
2. **FFmpeg**: 需安裝並加入系統 PATH (用於媒體轉檔與縮圖)。
3. **SQLite**: (選用) 用於檢視資料庫，系統會自動建立。

### 安裝與執行

1. **複製專案**

   ```bash
   git clone https://github.com/yourusername/koimsurai-nas.git
   cd koimsurai-nas
   ```

2. **設定環境變數**
   複製 `.env.example` 為 `.env` 並依需求修改：

   ```bash
   cp .env.example .env
   ```

   關鍵設定：
   - `DATABASE_URL`: 資料庫路徑 (預設 `sqlite://nas.db`)
   - `STORAGE_PATH`: 檔案儲存根目錄 (預設 `storage`)
   - `SESSION_SECRET`: Session 加密金鑰

3. **執行伺服器**
   ```bash
   cargo run
   ```
   伺服器預設啟動於 `http://localhost:3000`。

---

## 📚 API 文件

所有 API 端點（除了 `/api/auth/*` 與公開的分享／上傳連結）均需透過 Cookie 進行身分驗證。

⚠️ `/webdav` **不是**例外。它以前確實完全沒有驗證 —— 任何人都能讀寫刪整個
NAS，路徑還能用 `..` 逃出儲存根。現在走 HTTP Basic（見下面的 WebDAV 一節）。

### 🧾 OpenAPI

| 方法 | 路徑      | 描述                                        |
| ---- | --------- | ------------------------------------------- |
| GET  | `/scalar` | 互動式 API 文件（Scalar UI，不是 JSON） |

⚠️ 這個路徑**不需要登入**就打得開，等於把完整的端點清單公開出去。

### 🔐 認證 (Authentication)

| 方法 | 路徑                 | 描述         | Body / Query                               |
| ---- | -------------------- | ------------ | ------------------------------------------ |
| POST | `/api/auth/register` | 註冊新使用者 | `{ "username": "...", "password": "..." }` |
| POST | `/api/auth/login`    | 使用者登入   | `{ "username": "...", "password": "..." }` |
| POST | `/api/auth/logout`   | 使用者登出   | -                                          |
| POST | `/api/auth/refresh`  | 換新的 access token | -                                   |

**兩步驟驗證（TOTP）**

| 方法 | 路徑                        | 描述                                   |
| ---- | --------------------------- | -------------------------------------- |
| GET  | `/api/auth/2fa/status`      | 是否已啟用、剩幾組 backup code          |
| POST | `/api/auth/2fa/setup`       | 產生密鑰與 otpauth URI（尚未啟用）      |
| POST | `/api/auth/2fa/verify-setup`| 驗證 6 位 code 並正式啟用，回 backup codes |
| POST | `/api/auth/2fa/login`       | 登入的第二步（帶 temp_token）           |
| POST | `/api/auth/2fa/disable`     | 停用（需要密碼 + code）                 |

⚠️ **啟用 2FA 之後 WebDAV 會立刻停止運作**（Basic 認證沒有輸入第二因素的地方）。
「立刻」是修過的：憑證快取原本掛在 2FA 檢查**前面**，所以最近用過 WebDAV 的
帳號開啟 2FA 之後仍然通行到快取過期（5 分鐘）為止。

### 📂 檔案操作 (File Operations)

| 方法   | 路徑                         | 描述                  | Body / Query                               |
| ------ | ---------------------------- | --------------------- | ------------------------------------------ |
| GET    | `/api/files`                 | 列出根目錄檔案        | `?sort_by=name&order=asc&page=1`           |
| GET    | `/api/files/*path`           | 列出指定目錄檔案      | `?sort_by=size&limit=50`                   |
| POST   | `/api/files/folder`          | 建立資料夾            | `{ "path": "dir/name" }`                   |
| GET    | `/api/download/*path`        | 下載檔案              | -                                          |
| PUT    | `/api/files/*path`           | 重新命名              | `{ "new_path": "new_name.ext" }`           |
| DELETE | `/api/files/*path`           | 刪除檔案 (移至垃圾桶) | 回 `{ "trash_name": "..." }`               |
| POST   | `/api/files/batch/delete`    | 批次刪除              | 回 `{ trashed: [{path, trash_name}], failed: [...] }` |
| POST   | `/api/files/batch/move`      | 批次移動              | 回 `{ moved: [...], failed: [...] }`       |
| POST   | `/api/files/batch/copy`      | 批次複製（排進佇列，回 202） | `{ "paths": [...], "destination": "dir" }` |

⚠️ **批次操作會說出哪些失敗了。** 這三條原本都是「失敗只進 log、一律回 200」
—— 全部刪不掉時前端拿到的也是成功，於是畫面顯示「已移至垃圾桶」而檔案還在原地。

⚠️ **移動與複製撞名不會覆蓋。** 目的地已有同名檔案時會存成 `名字 (1).ext`
（`utils::naming::available_path`，與垃圾桶還原共用）。`fs::rename` 與
`fs::copy` 在目的地存在時都是直接取代 —— 拖一個 report.pdf 進已經有
report.pdf 的資料夾，原本那份會**沒有任何提示地消失**。
| GET    | `/api/thumbnail/:size/*path` | 取得縮圖              | size: `small`, `medium`, `large`           |
| GET    | `/api/favorites`             | 列出我的最愛          | -                                          |

### ☁️ 上傳 (Upload)

| 方法  | 路徑                      | 描述                | Body / Query                                 |
| ----- | ------------------------- | ------------------- | -------------------------------------------- |
| ANY   | `/api/tus`（與 `/api/tus/*`） | **tus 1.0 可續傳上傳（主要路徑）** | 見下                        |
| POST  | `/api/upload`             | 簡單上傳 (根目錄)   | `multipart/form-data`                        |
| POST  | `/api/upload/*path`       | 簡單上傳 (指定目錄) | `multipart/form-data`                        |
| POST  | `/api/upload/init`        | 初始化分塊上傳      | `{ "file_path": "...", "total_size": 1024 }` |
| PATCH | `/api/upload/session/:id` | 上傳檔案分塊        | Binary Body                                  |
| GET   | `/api/upload/session/:id` | 查詢上傳狀態        | -                                            |

前端現在一律走 **tus**（`tus-js-client`）：分塊、可續傳，重新整理頁面之後靠
檔案指紋（存在 localStorage）接得回去，不需要先問伺服器傳到哪。
底下 `/api/upload/*` 那幾條是舊的手刻分塊實作，保留作為 fallback。

⚠️ **落地是「暫存檔 + 原子 rename」**，而且覆寫既有檔案之前會先存一份版本。
原本是 `File::create(dest)` 就地寫 —— 那是 truncate，從那一刻起 dest 就已經
壞了，寫到一半失敗（磁碟滿、I/O 錯誤）會留下殘缺或 0 byte 的檔案。
暫存檔刻意放在 dest 同一個目錄：跨檔案系統的 rename 不是原子的。

⚠️ tus 的兩個坑寫在 `backend/src/handlers/tus.rs` 裡：
「沒有 body」與「body 是空的」在協定上是**兩件不同的事**（用 Content-Type 判斷，
不能一律送 `RequestBody::empty()`）；而「傳完了沒」要看 HEAD，PATCH 只回
`Upload-Offset`、不回 `Upload-Length`。

### 🏷️ 標籤與收藏 (Tags & Favorites)

| 方法   | 路徑                               | 描述                               | Body / Query                             |
| ------ | ---------------------------------- | ---------------------------------- | ---------------------------------------- |
| GET    | `/api/tags`                        | 列出所有標籤                        | -                                        |
| GET    | `/api/tags/{tag_name}/files`       | 列出帶有某個標籤的檔案              | -                                        |
| POST   | `/api/tags/add/*path`              | 新增標籤到指定檔案/資料夾          | `{ "tag_name": "Work", "color": "#FF0000" }` |
| DELETE | `/api/tags/remove/:tag_name/*path` | 從指定檔案/資料夾移除標籤          | -                                        |
| POST   | `/api/star/file/*path`             | 切換指定檔案收藏狀態 (Star/Unstar) | -                                        |

### 🕒 版本控制 (Versioning)

| 方法 | 路徑                                | 描述                              | Body / Query |
| ---- | ----------------------------------- | --------------------------------- | ------------ |
| GET  | `/api/versions/file/*path`          | 列出指定檔案的歷史版本            | -            |
| POST | `/api/versions/restore/{version_id}/*path` | 還原指定版本 | -            |

⚠️ **兩個參數都是必要的**，順序也不能換（`matchit` 要求萬用參數在最後）。
`version_id` 是 `.versions/` 底下的檔名（`<timestamp>_<檔名>`），而它的父目錄
要從 `path` 推。這份文件原本只寫一個參數 —— 那是這個端點「路由、handler、
utoipa 標註三處互相矛盾」時期留下的第三種寫法，當時它永遠回 500。
還原是非破壞性的：後端會先把目前的內容存成新版本再覆寫。

### 🎬 媒體 (Media)

| 方法 | 路徑                       | 描述                     | Body / Query                       |
| ---- | -------------------------- | ------------------------ | ---------------------------------- |
| GET  | `/api/media/stream`        | 媒體串流                 | `?path=video.mp4&resolution=1080p` |
| GET  | `/api/media/timeline`      | 媒體時間軸               | `?group_by=day                     | month | year` |
| GET  | `/api/media/hls/status`    | 查詢 HLS 轉檔/串流狀態   | -                                  |
| GET  | `/api/media/hls/serve`     | 以 HLS 方式提供分段串流  | `?path=video.mp4`                  |
| GET  | `/api/media/hls/qualities` | 列出可用 HLS 解析度/品質 | -                                  |

⚠️ **公開連結的密碼有次數上限。** 分享連結與上傳連結**不需要登入**就打得到，
而密碼比對走 argon2（19 MiB / 次）。沒有節流的話有兩個後果：密碼可以無限次
暴力嘗試，而且每次嘗試都換走一次記憶體與 CPU —— `spawn_blocking` 的池預設
512 條執行緒，灌併發可以逼出接近 10 GB。

現在：**10 次 / 5 分鐘**（key 是連結 id 而不是來源 IP —— 這服務在反向代理
後面），超過回 **429**。額度檢查刻意放在 argon2 **之前**：擋在後面的話被擋掉
的請求仍然付了那個代價。另外 argon2 本身有併發閘門（上限＝CPU 數，夾在 2..8）。

### 🔗 分享 (Sharing)

| 方法 | 路徑         | 描述         | Body / Query                                                 |
| ---- | ------------ | ------------ | ------------------------------------------------------------ |
| POST | `/api/share` | 建立分享連結 | `{ "file_path": "...", "password": "...", "expires_in_seconds": 3600 }` |
| GET  | `/api/share/{id}/info`     | 連結資訊（**不驗密碼**，只說有沒有設） | (公開存取) |
| GET  | `/api/share/{id}/verify`   | 只檢查密碼、不產生內容 | `?pwd=...`（公開存取） |
| GET  | `/api/share/{id}/download` | 下載（資料夾會即時打包 zip） | `?pwd=...`（公開存取） |
| GET  | `/s/{id}`    | 分享頁（**SPA 路由**，不是 API；實際取資料走上面兩條） | (公開存取) |

### 🗑️ 垃圾桶 (Trash)

| 方法   | 路徑                   | 描述       | Body / Query |
| ------ | ---------------------- | ---------- | ------------ |
| GET    | `/api/trash`             | 列出垃圾桶     | -            |
| POST   | `/api/trash/{filename}`  | 還原檔案       | -            |
| DELETE | `/api/trash/{filename}`  | **永久**刪除   | -            |
| DELETE | `/api/trash`             | 清空垃圾桶     | -            |

⚠️ `{filename}` 是**垃圾桶裡的檔名**，不是原始路徑。`.trash` 是扁平的，撞名時
`move_to_trash` 會存成 `原名.<timestamp>` —— 所以 `DELETE /api/files/*path`
會把那個名字回給你（`{ "trash_name": "..." }`），還原與永久刪除都要用它。
拿原檔名去還原不會失敗，而是會**還原到上一次刪的那個同名檔案**。

### 🔍 搜尋與索引 (Search)

| 方法 | 路徑          | 描述     | Body / Query |
| ---- | ------------- | -------- | ------------ |
| GET  | `/api/search` | 全文搜尋 | `?q=keyword` |

### 🛡️ 系統與管理 (System)

| 方法 | 路徑                             | 描述                              | Body / Query                                        |
| ---- | -------------------------------- | --------------------------------- | --------------------------------------------------- |
| GET  | `/api/system/status`             | 系統狀態                          | CPU, RAM, Disk                                      |
| POST | `/api/system/verify-consistency` | 驗證資料庫與檔案一致性 (管理員用) | -                                                   |
| POST | `/api/system/rescan`             | 觸發資料重新掃描與索引 (管理員用) | -                                                   |
| GET  | `/api/tasks`                     | 背景任務列表                      | -                                                   |
| GET  | `/api/audit/logs`                | 稽核日誌                          | -                                                   |

**目前會被記錄的動作**（`state.audit.log(...)` 的呼叫點）：

    create_folder  rename_file  restore_version
    delete_file    batch_delete  batch_move  batch_copy
    restore_from_trash  permanent_delete  empty_trash

⚠️ 後面那六個是**補上的**。原本只有前三個加 `delete_file` —— 也就是批次刪除、
批次移動、永久刪除、清空垃圾桶、從垃圾桶還原**一件都沒有紀錄**，而那正是
「誰把我的檔案弄不見的」最需要查的幾件事。`batch_move` 與 `batch_copy` 當時
連 `user_id` 都沒有從請求裡取出來。

前端的顯示對應表在 `src/components/desktop/audit-actions.ts`，有一條測試釘住
「後端會產生的每個動作都要有顯示名稱」。
| POST | `/api/permissions`               | 設定權限                          | `{ "user_id": 1, "path": "...", "can_read": true }` |
| GET  | `/api/ws`                        | WebSocket                         | 即時通知連線                                        |

### 🌐 WebDAV

| 方法 | 路徑        | 描述            |
| ---- | ----------- | --------------- |
| ANY  | `/webdav/*` | WebDAV 協定入口（**HTTP Basic 認證**） |

- 認證用的是同一組帳號密碼，走 argon2 驗證。實測一次 verify 約 310ms，
  而 WebDAV 客戶端每個操作都會重送憑證 —— 所以有一層帶 TTL 的憑證快取，
  快取的是 (使用者名稱, SHA-256(密碼))，**不存明文**。那不是最佳化，是必要條件。
- ⚠️ **開了 2FA 的帳號一律拒絕**：Basic 沒有第二因素的位置。目前沒有
  app-specific password，所以那些帳號用不了 WebDAV。
- 401 一定帶 `WWW-Authenticate`，否則客戶端不會跳出輸入框。

### 🐳 Docker 管理 (Container Manager)

類似 Synology Container Manager，需設定 `ENABLE_DOCKER_MANAGER=true`。

⚠️ **這組端點等同主機 root。** 容器通常掛著 `/var/run/docker.sock`，能打到
`/api/docker/*` 就能起一個特權容器掛上宿主機的根目錄。所以除了開關之外還有
一個白名單：`DOCKER_MANAGER_USER_IDS=1,2`（逗號分隔的 user id）。
**沒設就全部拒絕**（fail-closed），不是全部放行。

不在白名單裡的帳號會拿到 403 —— 前端會顯示「這個帳號沒有 Docker 管理權限」
而不是一片空白（那是曾經的行為）。

| 方法   | 路徑                                 | 描述               | Body / Query                            |
| ------ | ------------------------------------ | ------------------ | --------------------------------------- |
| GET    | `/api/docker/status`                 | Docker 連線狀態    | -                                       |
| POST   | `/api/docker/connect`                | 連接 Docker daemon | -                                       |
| GET    | `/api/docker/containers`             | 列出所有容器       | `?all=true`                             |
| GET    | `/api/docker/containers/:id`         | 容器詳情           | -                                       |
| POST   | `/api/docker/containers/:id/start`   | 啟動容器           | -                                       |
| POST   | `/api/docker/containers/:id/stop`    | 停止容器           | `{ "timeout": 10 }`                     |
| POST   | `/api/docker/containers/:id/restart` | 重啟容器           | `{ "timeout": 10 }`                     |
| DELETE | `/api/docker/containers/:id`         | 刪除容器           | `?force=true`                           |
| GET    | `/api/docker/containers/:id/logs`    | 容器日誌           | `?tail=100&since=0`                     |
| GET    | `/api/docker/containers/:id/stats`   | 容器統計           | CPU, Memory, Network                    |
| GET    | `/api/docker/images`                 | 列出所有鏡像       | -                                       |
| POST   | `/api/docker/images/pull`            | 拉取鏡像           | `{ "image": "nginx", "tag": "latest" }` |
| DELETE | `/api/docker/images/:id`             | 刪除鏡像           | `?force=true`                           |

### 🤖 AI 圖片標籤 (AI Smart Tagging)

後端 AI 圖片標籤服務已在 `src/services/ai.rs` 實作（使用 CLIP，並以 Cargo feature `ai` 控制實際推理），資料表與索引（`image_ai_tags`, `ai_analysis_status`）在 DB migration 已建立。

內部可用的 service/函式:

- `AiService`：提供 `detect_tags`, `analyze_and_save`, `delete_tags`, `get_stats`, `retry_failed` 等方法，用以分析圖片並將結果寫入 DB。
- `services::search::search_by_ai_tag(pool, tag, min_confidence, limit)`：在 DB 中搜尋含指定 AI 標籤的圖片。
- `services::search::get_all_ai_tags(pool)`：取得熱門/現有的 AI 標籤（autocomplete）。

⚠️ 這一節混了「已經有的」與「只是提案的」，底下標清楚。四條裡**只有第一條
存在**，其餘三條沒有對應的 handler（`backend/src/handlers/` 底下沒有 ai.rs），
照著打會拿到 404。`AiService::retry_failed` 存在，但只是個沒有 HTTP 出口的
service 方法。

| 方法 | 路徑                       | 狀態 | 說明                                                                           |
| ---- | -------------------------- | ---- | ------------------------------------------------------------------------------ |
| GET  | `/api/search/ai-tags`      | ✅ 已實作 | 以關鍵字搜尋含指定 AI 標籤的圖片（Query: `q`, 可選 `min_confidence`, `limit`） |
| GET  | `/api/search/ai-tags/list` | ❌ 提案 | 取得所有已知 AI 標籤（自動完成用）                                             |
| POST | `/api/ai/analyze`          | ❌ 提案 | 針對單張圖片觸發即時分析並儲存結果（Body: `{ "path": "..." }`）                |
| POST | `/api/ai/retry-failed`     | ❌ 提案 | 重新分析失敗的圖片（回傳成功數量）                                             |

底下的 curl 範例除了第 1 個以外都是**提案的樣子**，現在打會 404。

簡單範例（curl）：

1. 以標籤搜尋圖片

```bash
curl -sG "http://localhost:3000/api/search/ai-tags" --data-urlencode "q=beach" --data "min_confidence=0.5&limit=20" \
   -b cookiefile
```

範例回應：

```json
[
  { "path": "/photos/2025/beach1.jpg", "name": "beach1.jpg", "tag": "beach", "confidence": 0.92 },
  { "path": "/photos/2025/beach2.jpg", "name": "beach2.jpg", "tag": "beach", "confidence": 0.87 }
]
```

2. 取得 AI 標籤清單（autocomplete）

```bash
curl "http://localhost:3000/api/search/ai-tags/list" -b cookiefile
```

範例回應：

```json
[
  ["beach", 124],
  ["cat", 98],
  ["person", 65]
]
```

3. 針對單張圖片觸發分析

```bash
curl -X POST "http://localhost:3000/api/ai/analyze" -H "Content-Type: application/json" -d '{"path":"/photos/2025/beach1.jpg"}' -b cookiefile
```

範例回應：

```json
{
  "file_path": "/photos/2025/beach1.jpg",
  "tags": [{ "name": "beach", "confidence": 0.92 }],
  "model_name": "openai/clip-vit-base-patch32",
  "duration_ms": 310
}
```

4. 重新分析失敗項目

```bash
curl -X POST "http://localhost:3000/api/ai/retry-failed" -b cookiefile
```

範例回應：

```json
{ "reprocessed": 12 }
```

啟用與設定：

- CLI（開發）啟用範例：

```bash
export ENABLE_AI_LABELLING=true
cargo run --features ai
```

- 環境變數（可在 `.env` 或系統環境設定）：
  - `AI_MODEL_NAME`（預設 `openai/clip-vit-base-patch32`）
  - `AI_MIN_CONFIDENCE`（預設 `0.3`）
  - `AI_MAX_CONCURRENT`（預設 `4`）
  - `AI_USE_GPU`（`true`/`false`）
  - `AI_MAX_TAGS`（回傳標籤數量上限）

備註：若不在 Cargo features 中啟用 `ai`，`AiService::detect_tags` 會以 stub 模式回傳空結果並記錄警告，資料庫相關查詢與管理函式仍可使用。

---

## 🏗️ 專案結構

```
src/
├── handlers/       # API 請求處理 (Controller)
├── models/         # 資料結構與資料庫模型
├── services/       # 核心業務邏輯 (Indexer, Search, Audit, AI, Docker)
├── utils/          # 工具函式 (Queue, Image, Versioning, FFmpeg)
├── middleware/     # 中介軟體 (Auth)
├── routes/         # 路由定義
├── db/             # 資料庫連線與遷移
└── main.rs         # 程式進入點
```

## 🛠️ 技術棧

- **語言**: Rust (Edition 2024)
- **Web 框架**: Axum 0.7
- **資料庫**: SQLite (SQLx) + WAL 模式
- **非同步執行**: Tokio
- **搜尋引擎**: Tantivy
- **媒體處理**: FFmpeg (GPU 加速), Image-rs
- **容器管理**: Bollard (Docker API)
- **AI 推理**: (預留) ort/candle (ONNX Runtime / Candle)
- **API 文件**: Utoipa (OpenAPI)

## 🔧 性能調優

本專案設計支援從低規格開發機到高性能伺服器的彈性配置。

### 開發環境 (低規格)

```env
DATABASE_MAX_CONNECTIONS=5
DATABASE_MMAP_SIZE_MB=64
SEARCH_INDEX_BUFFER_MB=50
MAX_CONCURRENT_TRANSCODES=2
ENABLE_DOCKER_MANAGER=false
ENABLE_AI_LABELLING=false
```

### 生產環境 (64GB RAM + RTX 5060 Ti)

```env
DATABASE_MAX_CONNECTIONS=50
DATABASE_MMAP_SIZE_MB=512
SEARCH_INDEX_BUFFER_MB=500
MAX_CONCURRENT_TRANSCODES=6
USE_GPU_TRANSCODE=auto
ENABLE_DOCKER_MANAGER=true
ENABLE_AI_LABELLING=true
AI_MAX_CONCURRENT=6
AI_USE_GPU=true

# ⚠️ 開了 Docker 管理就一定要設白名單 —— 沒設是全部拒絕，
# 而全部放行等於把主機 root 交給每一個能登入的帳號。
DOCKER_MANAGER_USER_IDS=1,2
```
