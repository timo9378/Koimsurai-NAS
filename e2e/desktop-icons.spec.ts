import { expect, test } from "@playwright/test";

import { createDesktopFolder, registerAndLogin } from "./helpers";

/**
 * 桌面圖示的鍵盤拖曳。
 *
 * 這條測試存在的理由：改用 dnd-kit **之前**，桌面圖示只聽 `mousedown` /
 * `mousemove`，所以
 *   - 完全不能用鍵盤移動
 *   - 觸控裝置上完全不能移動
 * 兩者都不會有任何錯誤訊息，只是功能不存在。而「不存在的功能」正是單元測試
 * 抓不到的東西 —— 沒有人會替一個沒寫的分支寫測試。
 *
 * dnd-kit 的 KeyboardSensor 需要真的瀏覽器（它讀 `event.code`、量元素矩形、
 * 靠 focus），所以這條只能是 E2E。
 */
test("桌面圖示可以用鍵盤移動", async ({ page }) => {
  await registerAndLogin(page, "icons");
  const folder = await createDesktopFolder(page, "keyboard");
  await page.reload();

  const icon = page.getByRole("button", { name: new RegExp(`^${folder}`) });
  await expect(icon).toBeVisible({ timeout: 15_000 });

  const readPos = () =>
    icon.evaluate((el) => ({
      left: (el as HTMLElement).style.left,
      top: (el as HTMLElement).style.top,
    }));
  const before = await readPos();

  // 空白鍵拿起 → 方向鍵移動一格 → 空白鍵放下
  //
  // ⚠️ 用 locator.press() 而不是 page.keyboard.press()：前者每次都重新解析
  // 元素並先聚焦。桌面的檔案清單會因為 react-query 重新抓取而重新渲染，
  // 用 page.keyboard 的話按鍵可能落在 body 上，整個序列靜靜地沒有作用
  // （實測偶發過一次）。dnd-kit 的拖曳狀態在 DndContext 裡而不是 DOM 節點上，
  // 所以中途重新聚焦同一個元素是安全的。
  await icon.press("Space");
  await icon.press("ArrowRight");
  await icon.press("ArrowDown");
  await icon.press("Space");

  await expect.poll(readPos, { message: "鍵盤拖曳之後圖示的位置應該改變" }).not.toEqual(before);

  // 位置要存進 localStorage，重新整理後留在原地
  const moved = await readPos();
  await page.reload();
  const iconAgain = page.getByRole("button", { name: new RegExp(`^${folder}`) });
  await expect(iconAgain).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () =>
      iconAgain.evaluate((el) => ({
        left: (el as HTMLElement).style.left,
        top: (el as HTMLElement).style.top,
      })),
    )
    .toEqual(moved);
});

test("圖示帶著可拖曳的語意，而且 Enter 仍然是開啟", async ({ page }) => {
  await registerAndLogin(page, "semantics");
  const folder = await createDesktopFolder(page, "semantics");
  await page.reload();

  const icon = page.getByRole("button", { name: new RegExp(`^${folder}`) });
  await expect(icon).toBeVisible({ timeout: 15_000 });

  // dnd-kit 會補這個 —— 螢幕閱讀器才唸得出「這東西可以拖」
  await expect(icon).toHaveAttribute("aria-roledescription", "draggable");

  // ⚠️ Enter 不該被 dnd-kit 的鍵盤拖曳吃掉。dnd-kit 的 KeyboardSensor 預設
  // 用 Space + Enter 啟動拖曳，這裡刻意只留 Space，Enter 留給「開啟」。
  await icon.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: folder }).or(page.getByText(folder).nth(1)),
  ).toBeVisible({
    timeout: 10_000,
  });
});
