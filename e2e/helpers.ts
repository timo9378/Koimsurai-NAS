import { expect, type Page } from "@playwright/test";

export const INVITE_CODE = process.env.E2E_INVITE_CODE ?? "e2e_invite";

/** 每個測試用不同帳號 —— 共用同一個 SQLite 檔，重跑時帳號會還在。 */
export function uniqueUser(prefix = "e2e"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 註冊一個新帳號、登入，停在桌面。 */
export async function registerAndLogin(page: Page, prefix = "e2e"): Promise<string> {
  const user = uniqueUser(prefix);
  await page.goto("/");

  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByPlaceholder("Username").fill(user);
  await page.getByPlaceholder("Password", { exact: true }).fill("password123");
  await page.getByPlaceholder("Confirm Password").fill("password123");
  await page.getByPlaceholder("Invite Code").fill(INVITE_CODE);
  await page.getByPlaceholder("Invite Code").press("Enter");
  await expect(page.getByText("Registration successful!")).toBeVisible();

  await page.getByPlaceholder("Username").fill(user);
  await page.getByPlaceholder("Password", { exact: true }).fill("password123");
  await page.getByPlaceholder("Password", { exact: true }).press("Enter");
  await expect(page.getByPlaceholder("Username")).toBeHidden({ timeout: 15_000 });

  return user;
}

/**
 * 在桌面上建一個資料夾，回傳它的名字。
 *
 * ⚠️ 桌面圖示讀的是 `/Desktop` 而不是儲存根目錄（見 DesktopIcons 的
 * `useFiles({ path: "/Desktop" })`）—— 建在根目錄的話桌面上永遠看不到。
 */
export async function createDesktopFolder(page: Page, prefix: string): Promise<string> {
  const origin = new URL(page.url()).origin;
  // ⚠️ cookie 認證的寫入請求需要 Origin，否則是 403（見 middleware/auth.rs 的 CSRF 檢查）
  const headers = { Origin: origin };

  // Desktop 可能已經存在（新帳號登入時前端會建），已存在時回 409，忽略即可
  await page.request.post("/api/files/folder", {
    headers,
    data: { path: "", folder_name: "Desktop" },
  });

  const name = `${prefix}-${Date.now().toString(36)}`;
  const res = await page.request.post("/api/files/folder", {
    headers,
    data: { path: "Desktop", folder_name: name },
  });
  expect(res.ok(), `在 Desktop 底下建資料夾失敗：${res.status()}`).toBe(true);
  return name;
}
