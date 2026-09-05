import { expect, test } from "@playwright/test";

import { loadTusClient, registerAndLogin, selectInFinder } from "./helpers";

/**
 * 縮小的視窗一定要能叫回來。
 *
 * ⚠️ 這條測的是**沒有 Dock 圖示的 app**，因為那才是壞掉的情況：
 * `preview` 是一個 AppType，但 Dock 上沒有它的圖示（它是文件視窗，不是可以
 * 啟動的 app）。所以預覽視窗一縮小就沒有任何入口 —— 沒有圖示可以點、沒有
 * 視窗列表 —— 視窗留在 store 裡佔著狀態，使用者看到的卻跟關掉一樣。
 *
 * 既有的 `window-management` 那條測的是 Finder，而 Finder **有** Dock 圖示，
 * 所以它一直是綠的。這正是「測了相似的東西，但沒測到壞掉的那個」。
 */
test("縮小預覽視窗之後，可以從 Dock 把它叫回來", async ({ page }) => {
  await registerAndLogin(page, "minrec");
  await loadTusClient(page);

  const name = `min-${Date.now().toString(36)}.txt`;
  const ok = await page.evaluate(async (n: string) => {
    const file = new File(["preview me"], n, { type: "text/plain" });
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
  await selectInFinder(page, name);

  // 空白鍵開 Quick Look —— 那是一個 preview 視窗。
  await page.keyboard.press("Space");
  await expect(page.locator("[data-window-frame]")).toHaveCount(2, { timeout: 15_000 });

  // 縮小它。
  const minimize = page.getByRole("button", { name: new RegExp(`^最小化「${name}`) });
  await expect(minimize).toBeVisible({ timeout: 10_000 });
  await minimize.click();

  // Dock 上要出現一個可以把它叫回來的項目。
  const restore = page.getByRole("button", { name: new RegExp(`^還原「${name}`) });
  await expect(restore, "縮小的視窗必須在 Dock 上留下入口").toBeVisible({ timeout: 10_000 });

  await restore.click();

  // 回來了：預覽視窗又看得見，而 Dock 上的那個入口消失。
  await expect(page.getByRole("button", { name: new RegExp(`^最小化「${name}`) })).toBeVisible({
    timeout: 10_000,
  });
  await expect(restore).toHaveCount(0);
});
