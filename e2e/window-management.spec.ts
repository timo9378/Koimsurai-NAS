import { expect, test, type Page } from "@playwright/test";

import { registerAndLogin } from "./helpers";

/**
 * 視窗管理：關閉／最小化／最大化／還原、拖曳移動、調整大小、邊緣 snap、
 * 疊放順序、顯示桌面往返。
 *
 * ⚠️ 這是這個專案「桌面 OS」之所以成立的部分，而它原本**一條 E2E 都沒有**。
 * `window-store` 有 12 條單元測試，但蓋的全是 store 的狀態轉換
 * （「開窗會取消顯示桌面」「聚焦提到最上層」）—— 那些證明不了畫面上真的動了。
 * 今天在 DesktopIcons 的鍵盤拖曳上就看過一次：store 狀態全對，位置完全沒變。
 */

/** 開一個 Finder 視窗，回傳它的外框。 */
async function openFinder(page: Page) {
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  const title = page.locator('[data-context-type="window-title"]').first();
  await expect(title).toBeVisible({ timeout: 15_000 });
  return title;
}

/** 視窗外框。用明確的標記，不要「往上找第一個有 style 的祖先」—— 那會抓到內層元素。 */
function frame(page: Page) {
  return page.locator("[data-window-frame]").first();
}

/** 量一個元素的矩形；拿不到就直接失敗（比一路 `!` 清楚）。 */
async function boxOf(locator: ReturnType<typeof frame>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("量不到元素的位置與大小");
  return box;
}

test("紅綠燈：關閉、最小化、最大化與還原", async ({ page }) => {
  await registerAndLogin(page, "wm1");
  await openFinder(page);

  const titles = page.locator('[data-context-type="window-title"]');
  await expect(titles).toHaveCount(1);

  // 最大化 → 按鈕語意變成「還原」
  await page.getByRole("button", { name: /^最大化/ }).click();
  await expect(page.getByRole("button", { name: /^還原/ })).toBeVisible();

  // 還原 → 又變回「最大化」
  await page.getByRole("button", { name: /^還原/ }).click();
  await expect(page.getByRole("button", { name: /^最大化/ })).toBeVisible();

  // ⚠️ 最小化**不會**把視窗從 DOM 拿掉：它是 `scale: 0 / opacity: 0` 的動畫，
  // 元素還在。所以這裡斷言的是「看不見」而不是「不存在」——
  // 關閉才是真的從 DOM 移除，兩者要分得清楚。
  await page.getByRole("button", { name: /^最小化/ }).click();
  await expect(titles.first()).toBeHidden({ timeout: 10_000 });
  // 最小化不該把視窗銷毀
  await expect(titles).toHaveCount(1);

  // 從 Dock 點回來
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  await expect(titles.first()).toBeVisible({ timeout: 10_000 });

  // 關閉 —— 這個才是真的移除
  await page.getByRole("button", { name: /^關閉/ }).click();
  await expect(titles).toHaveCount(0, { timeout: 10_000 });
});

test("拖標題列會移動視窗，拖到左緣會 snap 成半螢幕", async ({ page }) => {
  await registerAndLogin(page, "wm2");
  const title = await openFinder(page);

  const before = await boxOf(frame(page));

  // 往右下拖 120px —— 位置要真的變。
  await title.hover();
  await page.mouse.down();
  await page.mouse.move(before.x + 200, before.y + 140, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () => (await frame(page).boundingBox())?.x ?? -1, { timeout: 10_000 })
    .not.toBe(before.x);

  // 拖到左緣會 snap 成左半螢幕。斷言的是**精確的幾何契約**：
  // `{x: 12, y: 48, width: 畫面寬/2 - 24, height: 畫面高 - 96}`。
  //
  // ⚠️ 為什麼要這麼精確：這個專案一度有**兩份** snap 實作同時掛在
  // `window-drag-end` 上，幾何不一樣（另一份是 `{0, 0, 寬/2, 高}`，沒有邊距），
  // 最終狀態取決於監聽器註冊順序。我的前兩版斷言（「寬度介於 40%～75%」、
  // 「寬度比原本小 50 以上」）兩份都會過 —— 把其中一份停用測試照樣綠，
  // 等於什麼都沒測。只有釘死幾何才分得出來。
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("拿不到 viewport");

  await title.hover();
  await page.mouse.down();
  await page.mouse.move(10, 300, { steps: 15 });
  await page.mouse.up();

  // 位置與大小是 framer-motion 的 spring，要等它停下來。
  await expect
    .poll(async () => Math.round((await boxOf(frame(page))).x), {
      timeout: 10_000,
      message: "應該貼齊左緣（畫面座標 12，桌面容器有內距）",
    })
    .toBe(12);

  const snapped = await boxOf(frame(page));
  expect(Math.round(snapped.y), "貼齊頂端（48 是頂端狀態列高度）").toBe(48);
  expect(Math.round(snapped.width), "寬度是畫面的一半減邊距").toBe(viewport.width / 2 - 24);
  expect(Math.round(snapped.height), "高度是畫面高減上下邊距").toBe(viewport.height - 96);
});

test("拖右下角把手會改變視窗大小", async ({ page }) => {
  await registerAndLogin(page, "wm3");
  await openFinder(page);

  const before = await boxOf(frame(page));

  // ⚠️ 用座標直接驅動指標，不要用 `handle.hover()`。把手在 DOM 裡是可見的
  //（實測 15×15、opacity 1），但 framer-motion 讓外框持續有微小變動，
  // Playwright 的 actionability 檢查會一直等「stable」等到逾時。
  // resize 是 `onPointerDown` 起始的，從那個座標按下去就是真實的操作。
  const handleBox = await boxOf(page.locator('[data-resize="se"]').first());

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width + 160, before.y + before.height + 120, {
    steps: 12,
  });
  await page.mouse.up();

  await expect
    .poll(async () => (await frame(page).boundingBox())?.width ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(before.width + 50);
});

test("點擊會把視窗提到最上層", async ({ page }) => {
  await registerAndLogin(page, "wm4");

  // 兩個 Finder（finder 是多實例 app）。
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  await expect(page.locator('[data-context-type="window-title"]')).toHaveCount(1, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New Window" }).click();
  await expect(page.locator('[data-context-type="window-title"]')).toHaveCount(2, {
    timeout: 15_000,
  });

  const zIndexes = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-context-type="window-title"]')].map((t) => {
        const el = t.closest("[style]") as HTMLElement | null;
        return Number(el?.style.zIndex ?? "0");
      }),
    );

  const [z1 = 0, z2 = 0] = await zIndexes();
  expect(z2, "後開的在上面").toBeGreaterThan(z1);

  // ⚠️ 先把第二個視窗拖開，第一個的標題列才點得到。
  //
  // CI 的 call log 說得很清楚：
  //   `<div data-resize="n" …> from <div data-window-frame=…> subtree
  //    intercepts pointer events`
  //
  // 新視窗每開一個往右下偏移 20px（`100 + windows.length * 20`）。視窗 1 的
  // 標題列高 40px（y=100..140），而視窗 2 的**上緣縮放把手**是一條滿寬 8px 的
  // 帶子，落在 y=120..128 —— 正好蓋在標題列中央，而 Playwright 點的就是中央。
  //
  // 本機會過是因為第二個視窗還在做進場動畫（scale 0.9 → 1），把手還沒到最終
  // 位置就被點到了；CI 比較慢，動畫收斂之後攔截就是必然。
  // 也就是說本機的綠燈是靠一個 race 贏來的 —— 那是最糟的一種綠燈。
  // 拖開之後兩個視窗不再重疊，這條就跟動畫時序無關了。
  const second = page.locator("[data-window-frame]").nth(1);
  const secondTitle = page.locator('[data-context-type="window-title"]').nth(1);
  const box = await second.boundingBox();
  if (!box) throw new Error("拿不到第二個視窗的位置");
  await secondTitle.hover();
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 220, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () => (await second.boundingBox())?.x ?? -1, { timeout: 10_000 })
    .not.toBe(box.x);

  // 點第一個視窗的標題列 → 它要變成最上層。
  await page.locator('[data-context-type="window-title"]').first().click();
  await expect
    .poll(
      async () => {
        const [a = 0, b = 0] = await zIndexes();
        return a > b;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
});

test("顯示桌面會收起視窗，再按一次會還原", async ({ page }) => {
  await registerAndLogin(page, "wm5");
  await openFinder(page);

  const titles = page.locator('[data-context-type="window-title"]');
  await expect(titles).toHaveCount(1);

  // 同樣是「收起來」而不是「關掉」。
  await page.getByRole("button", { name: "顯示桌面" }).click();
  await expect(titles.first()).toBeHidden({ timeout: 10_000 });

  await page.getByRole("button", { name: "顯示桌面" }).click();
  await expect(titles.first()).toBeVisible({ timeout: 10_000 });
});
