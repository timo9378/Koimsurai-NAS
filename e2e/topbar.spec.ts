import { expect, test, type Page } from "@playwright/test";

import { registerAndLogin } from "./helpers";

/**
 * TopBar：Spotlight（⌘K）、通知中心、控制中心、主題切換。
 *
 * ⚠️ 這四個都是 popover / 快捷鍵驅動的，單元測試連渲染都不會走到。
 * TopBar 有 584 行、覆蓋率 0%，而它是每個畫面都看得到的那條。
 */

/**
 * 等桌面真的掛好。
 *
 * ⚠️ `registerAndLogin` 只等到登入表單消失，而 Spotlight 的 ⌘K 監聽器是
 * `SpotlightSearch` 掛載時才註冊的 —— 登入後立刻按鍵有約 1/3 的機率落空
 * （實測連跑三次紅了兩次）。等 Dock 出現就代表桌面已經在了。
 */
async function desktopReady(page: Page) {
  await expect(page.getByRole("button", { name: "Finder", exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

test("⌘K 開 Spotlight，Esc 關掉", async ({ page }) => {
  await registerAndLogin(page, "tb1");
  await desktopReady(page);

  const input = page.getByPlaceholder(/Search files, apps/);
  await expect(input).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(input).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0, { timeout: 10_000 });
});

test("Spotlight 找得到 app，選了會開起來", async ({ page }) => {
  await registerAndLogin(page, "tb2");
  await desktopReady(page);

  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByPlaceholder(/Search files, apps/);
  await expect(input).toBeVisible({ timeout: 10_000 });

  await input.fill("terminal");
  await page.getByText("Terminal", { exact: true }).first().click();

  await expect(page.locator("[data-window-frame]")).toHaveCount(1, { timeout: 15_000 });
});

test("通知中心打得開，而且看得到稽核紀錄", async ({ page }) => {
  await registerAndLogin(page, "tb3");

  // 先做一件會留下紀錄的事。
  await page.evaluate(async () => {
    await fetch("/api/files/folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "", folder_name: `audit-${Date.now().toString(36)}` }),
    });
  });

  await page.getByRole("button", { name: "通知" }).click();
  await expect(page.getByText("Notifications")).toBeVisible({ timeout: 10_000 });

  // 建資料夾會寫一筆 create_folder —— 顯示名稱是 `desktop/audit-actions.ts` 給的。
  await expect(page.getByText("Create Folder").first()).toBeVisible({ timeout: 10_000 });
});

test("控制中心打得開，顯示 CPU 與 RAM", async ({ page }) => {
  await registerAndLogin(page, "tb4");

  await page.getByRole("button", { name: "控制中心" }).click();

  await expect(page.getByText("System", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("CPU", { exact: true })).toBeVisible();
  await expect(page.getByText("RAM", { exact: true })).toBeVisible();
});

test("主題切換會改變 <html> 的 class，而且重新整理後還在", async ({ page }) => {
  await registerAndLogin(page, "tb5");

  const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
  const before = await isDark();

  await page.getByRole("button", { name: before ? "切換到淺色模式" : "切換到深色模式" }).click();
  await expect.poll(isDark, { timeout: 10_000 }).toBe(!before);

  // next-themes 會存進 localStorage —— 重新整理之後要維持。
  await page.reload();
  await expect.poll(isDark, { timeout: 15_000 }).toBe(!before);
});
