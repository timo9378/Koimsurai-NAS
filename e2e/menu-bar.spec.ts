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
  await expect(page.getByText("Finder", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  const windowCount = () => page.locator('[data-context-type="window-title"]').count();
  const before = await windowCount();

  // File → New Window：開得出第二個 Finder 視窗。
  await page.getByText("File", { exact: true }).click();
  await page.getByRole("menuitem", { name: "New Window" }).click();
  await expect.poll(windowCount).toBe(before + 1);

  // Edit → Paste 沒有實作，必須是停用的（而不是按了沒事）。
  await page.getByText("Edit", { exact: true }).click();
  const paste = page.getByRole("menuitem", { name: "Paste" });
  await expect(paste).toBeVisible();
  await expect(paste).toHaveAttribute("data-disabled", "");
});
