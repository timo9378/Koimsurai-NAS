import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./helpers";

/**
 * Finder 的分頁。
 *
 * `finder/tabs.ts` 有純函式測試（新增／關閉／切換的狀態轉換），但「分頁列真的
 * 多一個、切過去內容真的換、關掉之後回到剩下那個」沒有驗過 —— 而分頁狀態還會
 * 存進 localStorage 依 windowId 分開，那更是只有瀏覽器測得到。
 */
test("開新分頁之後關得掉", async ({ page }) => {
  await registerAndLogin(page, "tabs");
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  await expect(page.locator("[data-window-frame]").first()).toBeVisible({ timeout: 15_000 });

  const closeButtons = page.getByRole("button", { name: /^關閉分頁/ });
  // 只有一個分頁時不顯示關閉鈕。
  await expect(closeButtons).toHaveCount(0);

  await page.getByRole("button", { name: "New Tab" }).click();
  await expect(closeButtons).toHaveCount(2, { timeout: 10_000 });

  // ⚠️ 這裡**不能**驗「重新整理之後分頁還在」：視窗本身就不跨 reload 保存
  //（`window-store` 的 persist 只存 `windowHistory` 與 `dockPosition`），
  // 所以 reload 之後連 Finder 視窗都沒了，分頁自然無從談起。
  // 我的第一版寫了那個斷言，紅在「找不到關閉鈕」，看起來像分頁沒存 ——
  // 其實是整個視窗不見了。

  await page
    .getByRole("button", { name: /^關閉分頁/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: /^關閉分頁/ })).toHaveCount(0, {
    timeout: 10_000,
  });
});
