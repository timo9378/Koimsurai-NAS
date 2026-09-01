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
  // ⚠️ 等清單抓完再開始拖。`useFiles` 沒有設 staleTime，reload 之後那次
  // 重抓完成時會重新 render —— 拖曳序列如果跨在那個瞬間上，按鍵會落空。
  await page.waitForLoadState("networkidle");
  const before = await readPos();

  // 空白鍵拿起 → 方向鍵移動一格 → 空白鍵放下
  //
  // ⚠️ 只有**第一下**用 locator.press()（它會先聚焦），拿起之後改用
  // page.keyboard.press()。
  //
  // 原本整段都用 locator.press()，而它每次都重新聚焦 —— 實測有約 25% 的機率
  // 方向鍵不生效，拖曳以「位置沒變」收場。加了 aria-live 的觀測才看清楚：
  // 「Picked up」每次都出現，位置卻只在放下那一刻才變（拖曳期間 dnd-kit 用
  // transform，不動 inline style），所以壞掉的是中間的方向鍵。
  // dnd-kit 的 KeyboardSensor 在拖曳期間監聽的是 document，不需要再聚焦，
  // 而拖曳中重新 focus 同一個節點反而會打斷它。
  await icon.press("Space");
  await expect(page.getByText(/Picked up draggable item/)).toBeVisible();

  // ⚠️ 「Picked up」出現**不代表** KeyboardSensor 已經在處理方向鍵了。量出來的行為：
  //   - 拿起後立刻按 ArrowRight → 位移被丟掉（連按兩次也一樣，兩次都丟）
  //   - 等 400ms 再按一次 ArrowRight → 正常移動一格（4/4）
  // 所以這是**拿起之後的一小段時序窗口**，不是「第一個鍵被吃掉」。
  //
  // 真人從按空白鍵到伸手按方向鍵遠不止這段時間，所以這是測試端的問題而不是
  // 產品 bug —— 這也是為什麼原本這支會偶發紅：整段用 locator.press() 時，
  // 每次的 focus() 帶來的延遲有時剛好夠、有時不夠。
  //
  // 這裡用固定等待而不是輪詢「按到動為止」：實測後者更糟（連續快按會讓
  // 位移對不上，放下時 delta 是 0）。等待的長度有實測依據，不是猜的。
  await page.waitForTimeout(500);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");

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
