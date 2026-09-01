import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./helpers";

/**
 * 頂端選單列。
 *
 * 為什麼要 E2E：這條選單列原本每一項都**沒有 handler** —— 約 40 個按下去
 * 完全沒有反應的項目。純函式那層（`desktop/menu-bar.test.ts`）測得到「哪些
 * 項目有 command」，但「按下去真的會發生事情」只有真瀏覽器證得了，而那正是
 * 這次改動的全部重點。
 */
test("選單列的項目真的會動，做不到的變灰", async ({ page }) => {
  await registerAndLogin(page, "menubar");

  // 開一個 Finder，選單列才會切成 Finder 的那組。
  await page.getByRole("button", { name: "Finder", exact: true }).first().click();
  // ⚠️ 要等**視窗**真的出現再數。用 getByText("Finder") 當條件是不夠的：
  // Dock 的 tooltip 與選單列的 app 名稱也叫 Finder，於是 before 可能在視窗
  // 還沒掛好時就是 0，接著把「第一個視窗終於出現」誤判成「New Window 成功」。
  const windowTitles = page.locator('[data-context-type="window-title"]');
  await expect(windowTitles.first()).toBeVisible({ timeout: 15_000 });

  const windowCount = () => windowTitles.count();
  const before = await windowCount();
  expect(before, "應該已經有一個 Finder 視窗").toBeGreaterThan(0);

  // File → New Window：開得出第二個 Finder 視窗。
  await page.getByText("File", { exact: true }).click();
  await page.getByRole("menuitem", { name: "New Window" }).click();
  await expect.poll(windowCount).toBe(before + 1);

  // Edit → Paste 有實作，但剪貼簿是空的 —— 這時候必須是停用的，
  // 不然按下去會靜靜什麼都不做，正是這條選單列原本的毛病。
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const paste = page.getByRole("menuitem", { name: "Paste" });
  await expect(paste).toBeVisible();
  await expect(paste).toHaveAttribute("data-disabled", "");
  // 「真的沒有實作」那類（as Columns、Docker 的容器操作……）由
  // `desktop/menu-bar.test.ts` 直接斷言設定裡沒有 command，不必在瀏覽器裡再驗一次。
});
