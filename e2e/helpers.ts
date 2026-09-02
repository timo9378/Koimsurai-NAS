import { expect, type Page } from "@playwright/test";
import type * as TusJsClient from "tus-js-client";

type TusClient = typeof TusJsClient;

declare global {
  interface Window {
    tus: TusClient;
  }
}

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

/**
 * 把 `tus-js-client` 的 UMD build 注入頁面，掛在 `window.tus`。
 *
 * ⚠️ 不能在 `page.evaluate` 裡寫 `import("tus-js-client")` —— 那是一個 bare
 * specifier，瀏覽器解析不了（應用程式的 bundle 已經把它打包進去，但沒有以
 * 那個名字對外暴露）。用 node_modules 裡**同一版**的 dist 檔注入。
 */
export async function loadTusClient(page: Page): Promise<void> {
  await page.addScriptTag({ path: "node_modules/tus-js-client/dist/tus.min.js" });
  await page.waitForFunction(() => typeof window.tus.Upload === "function");
}

/**
 * 在 Finder 裡選到某個檔案。
 *
 * ⚠️ 一定要先用搜尋框篩過再點。E2E 的儲存根是**所有測試共用**的，跑到後面
 * 那裡已經堆了幾十個檔案，而檔案清單是虛擬捲動的 —— 目標可能根本沒有被
 * 渲染出來，`click()` 就只是等到逾時。這個症狀看起來像「點不到」，
 * 實際上是「不在 DOM 裡」。
 */
export async function selectInFinder(page: Page, name: string): Promise<void> {
  const search = page.getByRole("searchbox", { name: "搜尋這個資料夾" });
  await search.fill(name);
  await page.getByText(name, { exact: true }).first().click({ timeout: 15_000 });
}
