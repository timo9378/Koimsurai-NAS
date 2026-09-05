import { expect, test } from "@playwright/test";

import { loadTusClient, registerAndLogin, selectInFinder } from "./helpers";

/**
 * 檔案列表上的「修改時間」。
 *
 * ⚠️ 這個之前**每一筆都是「Invalid Date」**。後端送的 `modified` 是
 * Unix 秒的字串（`timestamp().to_string()`），而四個渲染點都直接
 * `new Date(file.modified)` —— 在 JS 裡那是 Invalid Date，不是 1970 年。
 * 型別上它只是 `string`，所以 TypeScript 完全幫不上忙；只有真的把畫面
 * 打開來看才發現得了。
 */
test("檔案列表顯示得出真正的修改時間，不是 Invalid Date", async ({ page }) => {
  await registerAndLogin(page, "mtime");
  await loadTusClient(page);

  const name = `mtime-${Date.now().toString(36)}.txt`;
  const uploaded = await page.evaluate(
    async ({ name }) => {
      const file = new File(["x"], name, { type: "text/plain" });
      return await new Promise<boolean>((resolve) => {
        const upload = new window.tus.Upload(file, {
          endpoint: "/api/tus",
          metadata: { filename: name, path: "" },
          onSuccess: () => resolve(true),
          onError: () => resolve(false),
        });
        upload.start();
      });
    },
    { name },
  );
  expect(uploaded).toBe(true);

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

  // ⚠️ 這個 reload 不是裝飾。上傳是直接打 tus 的，前端完全不知道，
  // React Query 手上還是開頁時抓的那份列表，不會重抓 —— 沒有 reload
  // 這條在單獨跑時會綠（那時列表是空的、開 Finder 才第一次抓），
  // 整套跑時就紅。
  await page.reload();
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  // 儲存根是全域共用的，整套跑下來會累積幾十個檔案，列表又是虛擬捲動的
  // —— 不先篩，目標很可能根本不在 DOM 裡。
  await selectInFinder(page, name);
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // 預設是格狀檢視，日期只出現在 hover 的 tooltip 裡。切成清單檢視 ——
  // 順帶也走了選單列的 View → as List 那條指令。
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: "as List" }).click();

  // 清單上要出現看得懂的年份 —— 這就是「日期真的被算出來了」。
  // 不比對格式：node 與瀏覽器的 locale 不一樣（zh-TW vs en-US），
  // 比對 toLocaleDateString() 的輸出只會測到執行環境。
  await expect(page.getByText(/\b20\d{2}\b/).first()).toBeVisible({ timeout: 15_000 });

  // 而且畫面上不該有任何一處是 Invalid Date —— 這才是原本的樣子。
  await expect(page.getByText("Invalid Date")).toHaveCount(0);
});
