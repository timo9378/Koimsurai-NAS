import { expect, test, type Page } from "@playwright/test";

import { registerAndLogin } from "./helpers";

/**
 * 設定：外觀、Dock 位置、儲存空間、關於。
 *
 * `Settings.tsx` 有 813 行，目前只有 WebDAV 與 2FA 那兩段被 E2E 碰過。
 * 這裡補其餘的分頁 —— 重點不是「畫面長怎樣」，而是**設定真的生效而且留得住**
 * （主題與 Dock 位置都會寫進 localStorage，重新整理後要還在）。
 */

/** 從 TopBar 的  選單打開設定。Dock 上那顆「Settings」開的是 Dock 位置面板。 */
async function openSettings(page: Page) {
  await page.getByRole("button", { name: "" }).first().click();
  await page.getByRole("menuitem", { name: /系統設定/ }).click();
  await expect(page.getByRole("button", { name: "外觀", exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

test("主題選「深色」會生效，而且重新整理後還在", async ({ page }) => {
  await registerAndLogin(page, "setapp");
  await openSettings(page);

  const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));

  await page.getByRole("button", { name: "外觀", exact: true }).click();
  await page.getByText("深色", { exact: true }).click();
  await expect.poll(isDark, { timeout: 10_000 }).toBe(true);

  await page.reload();
  await expect.poll(isDark, { timeout: 15_000 }).toBe(true);

  // 再切回淺色，確認不是單向的。
  await openSettings(page);
  await page.getByRole("button", { name: "外觀", exact: true }).click();
  await page.getByText("淺色", { exact: true }).click();
  await expect.poll(isDark, { timeout: 10_000 }).toBe(false);
});

test("Dock 位置切到左邊會生效，而且重新整理後還在", async ({ page }) => {
  await registerAndLogin(page, "setdock");
  await openSettings(page);
  await page.getByRole("button", { name: "Dock", exact: true }).first().click();

  const dockPos = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("window-storage");
      if (!raw) return null;
      return (JSON.parse(raw) as { state?: { dockPosition?: string } }).state?.dockPosition ?? null;
    });

  await page.getByText("左側", { exact: true }).first().click();
  await expect.poll(dockPos, { timeout: 10_000 }).toBe("left");

  await page.reload();
  await expect.poll(dockPos, { timeout: 15_000 }).toBe("left");
});

test("儲存空間與關於兩頁畫得出來，沒有 NaN", async ({ page }) => {
  await registerAndLogin(page, "setmisc");
  await openSettings(page);

  for (const section of ["儲存空間", "關於"]) {
    await page.getByRole("button", { name: section, exact: true }).click();
    const text = await page.locator("[data-window-frame]").first().innerText();
    expect(text.length, `${section} 應該有內容`).toBeGreaterThan(20);
    expect(text, `${section} 不該出現 NaN`).not.toMatch(/NaN/);
  }
});
