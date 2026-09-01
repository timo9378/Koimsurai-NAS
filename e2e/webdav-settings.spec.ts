import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./helpers";

/**
 * 設定裡的 WebDAV 說明。
 *
 * 為什麼要測：WebDAV 功能是完整的，但**整個 UI 之前沒有一處提到它** ——
 * 使用者不會知道有這個東西。而且它與 2FA 互斥：開了 2FA 之後 WebDAV 客戶端
 * 只會顯示「密碼錯誤」，沒有任何地方會告訴他原因。這條釘住那個因果關係
 * 有被寫在使用者看得到的地方。
 */
test("設定裡看得到 WebDAV 網址，也講明了它與 2FA 互斥", async ({ page }) => {
  await registerAndLogin(page, "dav");

  // ⚠️ 從 TopBar 的  選單開，不是 Dock 的 Settings 圖示 —— 那顆開的其實是
  // 「Dock 位置」的小面板，跟這個設定 app 是兩回事。
  await page.getByRole("button", { name: "" }).first().click();
  await page.getByRole("menuitem", { name: /系統設定/ }).click();

  await page.getByRole("button", { name: "WebDAV", exact: true }).click();

  // 掛載網址要是完整可用的
  await expect(page.getByText(/https?:\/\/[^\s]+\/webdav\//)).toBeVisible({ timeout: 15_000 });

  // 沒開 2FA 時是「啟用之後會停止運作」的預先警告
  await expect(page.getByText(/WebDAV 會停止運作/)).toBeVisible();

  // 安全性那頁在啟用之前也要講
  await page.getByRole("button", { name: "安全性", exact: true }).click();
  await expect(page.getByText(/WebDAV 會停止運作/)).toBeVisible();
});
