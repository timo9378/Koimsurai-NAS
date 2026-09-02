import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./helpers";

/**
 * 終端機的分頁。
 *
 * `Terminal.tsx` 覆蓋率 46%（唯一有元件測試的大元件），但那些測的是分頁狀態
 * 的轉換。「按了 + 真的多一個分頁、關掉真的少一個」沒有驗過 —— 而這裡曾經有
 * 一個 bug：`activeTabId` 留在空字串，於是初始化 terminal 的 effect 永遠不成立，
 * terminal 從來沒有連上過（見 `Terminal.tsx` 的註解）。
 */
test("終端機可以開新分頁，也關得掉", async ({ page }) => {
  await registerAndLogin(page, "term");

  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator("[data-window-frame]").first()).toBeVisible({ timeout: 15_000 });

  // 選單列的 Shell → New Tab（我先前把它接上的那個指令）。
  await page.getByRole("button", { name: "Shell", exact: true }).click();
  await page.getByRole("menuitem", { name: "New Tab" }).click();

  // 分頁列上會出現第二個分頁。
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.querySelectorAll('[data-window-frame] [role="tab"], [data-terminal-tab]')
              .length,
        ),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
});
