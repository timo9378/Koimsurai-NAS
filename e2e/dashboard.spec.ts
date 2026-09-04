import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./helpers";

/**
 * 儀表板。
 *
 * `Dashboard.tsx` 有 819 行、覆蓋率 0%。圖表本身是視覺的（測了投報率低），
 * 但**分頁切換**與**數值呈現**測得到 —— 而數值那部分今天才修過：
 * 七處「used / total × 100」只有兩處防了除以零，記憶體那個在 `total_memory`
 * 是 0 時會印出 `NaN%`，進度條的 width 也是 `NaN%`。
 */
test("五個分頁都切得過去，而且不會出現 NaN 或 Invalid Date", async ({ page }) => {
  await registerAndLogin(page, "dash");
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.locator("[data-window-frame]").first()).toBeVisible({ timeout: 15_000 });

  const frameText = () => page.locator("[data-window-frame]").first().innerText();

  for (const tab of ["Overview", "CPU", "Memory", "GPU", "Storage"]) {
    await page.getByRole("button", { name: tab, exact: true }).first().click();
    // 每一頁都要真的畫出東西 —— 空白代表壞了。
    await expect
      .poll(async () => (await frameText()).length, { timeout: 10_000 })
      .toBeGreaterThan(20);

    const text = await frameText();
    expect(text, `${tab} 不該出現 NaN`).not.toMatch(/NaN/);
    expect(text, `${tab} 不該出現 Invalid Date`).not.toContain("Invalid Date");
    expect(text, `${tab} 不該出現 undefined`).not.toMatch(/\bundefined\b/);
  }
});

test("Overview 顯示得出 CPU 與記憶體的百分比", async ({ page }) => {
  await registerAndLogin(page, "dash2");
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.locator("[data-window-frame]").first()).toBeVisible({ timeout: 15_000 });

  // 至少要有一個像百分比的數字（`12.3%`）——「有畫面但全是佔位符」也算壞。
  await expect
    .poll(
      async () =>
        /\d+(\.\d+)?%/.test(await page.locator("[data-window-frame]").first().innerText()),
      { timeout: 15_000 },
    )
    .toBe(true);
});
