// API 型別的單一入口。
//
// 絕大多數型別**由 Rust 產生**（`pnpm export:types` → `packages/api-types/index.ts`），
// 這裡只是轉出去，讓既有的 17 個 `from '@/types/api'` 匯入不必全部改寫。
// 此前這個檔是 225 行手寫、靠人工與 Rust 同步 —— 換掉的理由見下面那段。
export * from '@koimsurai/nas-api-types';

// ─────────────────────────────────────────────────────────────────────────────
// 以下是**後端沒有對應型別**的殘留，逐一標明狀態。
// 它們是人工同步時期留下的產物，每一個都代表一處前後端不一致，
// 不要當成「還沒搬過來的型別」直接沿用。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ 與後端不符。Rust 的 `WsServerMessage::DockerStats` payload 欄位是
 * `cpu_percent`（不是 `cpu_percentage`），而且還多了 network/block 四個欄位。
 * 目前 socket-provider 比對的訊息 type 也對不上（見該檔註解），這條路徑實際上沒在運作。
 * 修好協定之後應改用產生版的 `WsServerMessage`。
 */
export interface DockerStats {
  container_id: string;
  cpu_percentage: number;
  memory_usage: number;
  memory_limit: number;
}

/**
 * ⚠️ 與後端不符。`GET /api/docker/containers` 回的是產生版的 `ContainerSummary`：
 * `names: string[]`（複數、陣列）、`state`、`created`、`ports`，
 * **沒有** `name`、`cpu_usage`、`memory_usage` 這三個欄位。
 * 要改用 `ContainerSummary` 並調整取值處。
 */
export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'stopped' | 'paused' | 'exited';
  cpu_usage: string;
  memory_usage: string;
}

/**
 * ⚠️ 與後端不符。Rust 的 `AddTagRequest` 欄位叫 `tag_name`，不是 `name`。
 * 只有 `useFiles.ts` 的 `useAddTag` 在用（`use-tags.ts` 另有一份實作）。
 */
export interface TagRequest {
  name: string;
  color: string;
}

/**
 * 產生版對應 `LoginResponse`（`EmptyResponse | { requires_2fa, temp_token }`）。
 * 這份保留只是為了不動既有呼叫端；差別在 `requires_2fa` 產生版是 `boolean`、
 * 這裡是字面量 `true`。新程式碼請用 `LoginResponse`。
 */
export type LoginResult =
  | Record<string, never>
  | { requires_2fa: true; temp_token: string };

/** 後端沒有這個型別（認證走 cookie，不回 token body）。確認無人使用後即可刪。 */
export interface AuthResponse {
  token: string;
}
