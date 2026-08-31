export const INVITE_CODE = process.env.E2E_INVITE_CODE ?? "e2e_invite";

/// 每個測試用不同帳號 —— 共用同一個 SQLite 檔，重跑時帳號會還在。
export function uniqueUser(prefix = "e2e"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
