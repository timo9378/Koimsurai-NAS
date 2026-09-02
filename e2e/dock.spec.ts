import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./helpers";

/**
 * Dock：執行中指示點、hover 出視窗預覽、右鍵選單、從預覽切換視窗。
 *
 * ⚠️ 這些全部是**只有真瀏覽器碰得到**的互動：hover 觸發的預覽、右鍵開的選單、
 * 靠 CSS 顯示的指示點。單元測試連渲染都不會走到。目前 Dock 只有一條 a11y
 * 測試（每顆圖示有名字、Enter 開得起視窗），互動一條都沒有。
 */

test("開了視窗的 app 會出現指示點，關掉之後消失", async ({ page }) => {
  await registerAndLogin(page, "dock1");

  const finderIcon = page.getByRole("button", { name: "Finder", exact: true });
  const dot = () =>
    finderIcon.locator("div.rounded-full.absolute, div.absolute.rounded-full").count();

  expect(await dot(), "還沒開視窗時不該有指示點").toBe(0);

  await finderIcon.click();
  await expect(page.locator("[data-window-frame]").first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(dot, { timeout: 10_000 }).toBeGreaterThan(0);

  await page.getByRole("button", { name: /^關閉/ }).click();
  await expect.poll(dot, { timeout: 10_000 }).toBe(0);
});

test("hover Dock 圖示會出現視窗預覽，點它可以切過去", async ({ page }) => {
  await registerAndLogin(page, "dock2");

  // 開兩個 Finder，預覽才有得選。
  const finderIcon = page.getByRole("button", { name: "Finder", exact: true });
  await finderIcon.click();
  await expect(page.locator("[data-window-frame]")).toHaveCount(1, { timeout: 15_000 });
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New Window" }).click();
  await expect(page.locator("[data-window-frame]")).toHaveCount(2, { timeout: 15_000 });

  // hover 出預覽 —— 每一個視窗一張縮圖，帶著「切換到 …」的名字。
  await finderIcon.hover();
  // ⚠️ regex 要帶空格：主題切換那顆是「切換到深色模式」，`/^切換到/` 會把它
  // 一起算進來（實測數到 3 而不是 2）。預覽的名字是「切換到 <視窗標題>」。
  const previews = page.getByRole("button", { name: /^切換到 / });
  await expect(previews.first()).toBeVisible({ timeout: 10_000 });
  await expect(previews).toHaveCount(2);

  // 點第一張 → 那個視窗要變成最上層。
  const zOf = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-window-frame]")].map((el) =>
        Number((el as HTMLElement).style.zIndex || "0"),
      ),
    );
  const before = await zOf();
  expect(before[1] ?? 0).toBeGreaterThan(before[0] ?? 0);

  await previews.first().click();
  await expect
    .poll(
      async () => {
        const [a = 0, b = 0] = await zOf();
        return a > b;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
});

test("右鍵 Dock 圖示會出選單，可以開新視窗，也可以強制結束整個 app", async ({ page }) => {
  await registerAndLogin(page, "dock3");

  const finderIcon = page.getByRole("button", { name: "Finder", exact: true });
  const windows = page.locator("[data-window-frame]");

  // ⚠️ 這個選單以前**打不開**：`DockItem` 的 onContextMenu 無條件
  // `preventDefault()`，而 `GlobalContextMenu` 的第一行是
  // `if (e.defaultPrevented) return` —— 於是那整段 `dock-icon` 分支
  // （連同元素上為它準備的 `data-context-type`）是死碼，右鍵只會直接開視窗。
  await finderIcon.click({ button: "right" });
  await expect(page.getByText("開啟", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("強制結束", { exact: true })).toBeVisible();

  await page.getByText("開啟", { exact: true }).click();
  await expect(windows).toHaveCount(1, { timeout: 15_000 });

  await finderIcon.click({ button: "right" });
  await page.getByText("開啟", { exact: true }).click();
  await expect(windows).toHaveCount(2, { timeout: 15_000 });

  // 強制結束：一次收掉這個 app 的所有視窗。
  await finderIcon.click({ button: "right" });
  await page.getByText("強制結束", { exact: true }).click();
  await expect(windows).toHaveCount(0, { timeout: 10_000 });
});
