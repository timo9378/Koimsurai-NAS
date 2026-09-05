import { expect, test, type Page } from "@playwright/test";

import { loadTusClient, registerAndLogin, selectInFinder } from "./helpers";

/**
 * Finder 的右鍵選單：檔案的與空白處的。
 *
 * ⚠️ 檔案的右鍵選單原本**完全打不開** —— 右鍵任何一個檔案跳出來的都是空白處
 * 那個（New Folder / Paste / Upload Files…）。所以 Open、Download、Share、
 * Rename、Copy、Cut、Tags、Star、Versions、Get Info、Move to Trash 這一整排
 * 沒有一個到得了。
 *
 * 原因是清單容器的 `onPointerDown` 在 `button === 2` 時把外層 `<ContextMenu>`
 * 的 `key` 加一，**強制重新掛載整棵子樹**，連帶把每個檔案自己的
 * `ContextMenuTrigger` 也一起換掉，於是手勢中途就沒有接手的人了。
 * 那段沒有任何註解，`git log -S` 追下去是初始匯入就在的。
 *
 * 這也是為什麼「版本歷史接上 UI」那次改動其實沒有真的送到 —— 我當時只用
 * 元件測試驗了 dialog，沒有驗過那個選單項打不打得開。
 */

const menuItems = async (page: Page, where: string) => {
  await expect(page.locator('[role="menuitem"]').first(), `${where}：選單沒有打開`).toBeVisible({
    timeout: 10_000,
  });
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"]')].map((n) => (n.textContent || "").trim()),
  );
};

const closeMenu = async (page: Page) => {
  await page.keyboard.press("Escape");
  await expect(page.locator('[role="menuitem"]')).toHaveCount(0, { timeout: 10_000 });
};

/**
 * 右鍵某個檔案。
 *
 * ⚠️ 每次都重新套用搜尋篩選：關選單用的 Escape 會被搜尋框吃掉 ——
 * `<input type="search">` 收到 Escape 會**清空自己**，於是篩選沒了、
 * 目標又淹沒在共用儲存根的幾十個檔案裡（清單是虛擬捲動的，根本不在 DOM）。
 * 症狀是「找不到元素」，看起來像選單卡住，其實是篩選被清掉了。
 */
const rightClickFile = async (page: Page, name: string) => {
  await selectInFinder(page, name);
  await page.getByText(name, { exact: true }).first().click({ button: "right" });
};

test("右鍵檔案出檔案的選單，右鍵空白處出空白處的，而且可以連續開", async ({ page }) => {
  await registerAndLogin(page, "ctxmenu");
  await loadTusClient(page);

  const name = `ctx-${Date.now().toString(36)}.txt`;
  const ok = await page.evaluate(async (n: string) => {
    const file = new File(["x"], n, { type: "text/plain" });
    return await new Promise<boolean>((resolve) => {
      const up = new window.tus.Upload(file, {
        endpoint: "/api/tus",
        metadata: { filename: n, path: "" },
        onSuccess: () => resolve(true),
        onError: () => resolve(false),
      });
      up.start();
    });
  }, name);
  expect(ok).toBe(true);

  await expect
    .poll(
      () =>
        page.evaluate(async (n: string) => {
          const res = await fetch(`/api/files?search=${encodeURIComponent(n)}&limit=500`);
          const list = (await res.json()) as { name: string }[];
          return list.some((f) => f.name === n);
        }, name),
      { timeout: 20_000 },
    )
    .toBe(true);

  await page.reload();
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  // ── 檔案的選單 ──────────────────────────────────────────────────────────
  await rightClickFile(page, name);
  const fileMenu = await menuItems(page, "檔案第一次");
  expect(fileMenu, "應該是檔案的選單而不是空白處的").toEqual(
    expect.arrayContaining(["Share", "Versions", "Get Info", "Move to Trash"]),
  );
  expect(fileMenu, "不該混到空白處的項目").not.toContain("Upload Files");
  await closeMenu(page);

  // ── 連續再開一次（原本的 remount workaround 可能是為了這個）────────────
  await rightClickFile(page, name);
  expect(await menuItems(page, "檔案第二次"), "第二次還要開得起來").toContain("Versions");
  await closeMenu(page);

  // ── 空白處的選單 ────────────────────────────────────────────────────────
  const box = await page.locator("[data-window-frame]").first().boundingBox();
  if (!box) throw new Error("拿不到視窗位置");
  // 視窗右下角是狀態列（「N items」），會落在清單外面 —— 往上抓一點。
  await page.mouse.click(box.x + box.width - 120, box.y + box.height - 140, { button: "right" });
  expect(await menuItems(page, "空白處"), "空白處要出自己的選單").toEqual(
    expect.arrayContaining(["New Folder", "Upload Files", "Refresh"]),
  );
});
