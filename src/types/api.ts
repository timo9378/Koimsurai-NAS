// API 型別的單一入口。
//
// 絕大多數型別**由 Rust 產生**（`pnpm export:types` → `packages/api-types/index.ts`），
// 這裡只是轉出去，讓既有的 17 個 `from '@/types/api'` 匯入不必全部改寫。
// 此前這個檔是 225 行手寫、靠人工與 Rust 同步 —— 換掉的理由見下面那段。
export * from "@koimsurai/nas-api-types";

// ─────────────────────────────────────────────────────────────────────────────
// 人工同步時期的殘留只剩下面這一個。
//
// 原本還有四個（DockerStats、DockerContainer、TagRequest、AuthResponse），
// 每一個都標著「與後端不符」。逐一追過呼叫點之後全部是死的，已經刪掉 ——
// 留著一個標明「這是錯的」的型別，只會讓下一個人照它去追不存在的 bug。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 產生版對應 `LoginResponse`（`EmptyResponse | { requires_2fa, temp_token }`）。
 * 這份保留只是為了不動既有呼叫端；差別在 `requires_2fa` 產生版是 `boolean`、
 * 這裡是字面量 `true`。新程式碼請用 `LoginResponse`。
 */
export type LoginResult = Record<string, never> | { requires_2fa: true; temp_token: string };
