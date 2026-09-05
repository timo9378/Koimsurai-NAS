import { expect, test, type Page } from "@playwright/test";

import { loadTusClient, registerAndLogin } from "./helpers";

/**
 * Finder 的檢視與排序。
 *
 * `finder/sorting.ts` 有純函式測試（`sortFiles` 的比較器、無效日期的處理），
 * 但「點了表頭真的重排」「切換格狀／清單真的換版面」沒有驗過 —— 而排序這條
 * 今天才修過一個 bug：`modified` 是 Unix 秒字串，`new Date()` 解不出來，
 * 於是每一項都拿到 `-Infinity`，依時間排序在前端完全沒有作用。
 */

/** 在根目錄放三個大小不同的檔案，名字刻意與大小反序。 */
async function seed(page: Page, prefix: string) {
  await loadTusClient(page);
  const files = [
    { name: `${prefix}-a.txt`, size: 300 },
    { name: `${prefix}-b.txt`, size: 100 },
    { name: `${prefix}-c.txt`, size: 200 },
  ];
  for (const f of files) {
    const ok = await page.evaluate(
      async ({ name, size }) => {
        const file = new File(["x".repeat(size)], name, { type: "text/plain" });
        return await new Promise<boolean>((resolve) => {
          const up = new window.tus.Upload(file, {
            endpoint: "/api/tus",
            metadata: { filename: name, path: "" },
            onSuccess: () => resolve(true),
            onError: () => resolve(false),
          });
          up.start();
        });
      },
      { name: f.name, size: f.size },
    );
    expect(ok, `上傳 ${f.name}`).toBe(true);
  }
  await expect
    .poll(
      () =>
        page.evaluate(async (p: string) => {
          const res = await fetch(`/api/files?search=${encodeURIComponent(p)}&limit=500`);
          const list = (await res.json()) as { name: string; path: string }[];
          // ⚠️ 根目錄的 `?search=` 在後端是**遞迴全庫**的（見 list_files：
          // parent_path 為空時只有 `name LIKE ?`，沒有目錄條件）。
          // 這裡問的是「根目錄上還有幾個」，所以要把子目錄裡的濾掉 ——
          // 根層項目的 `path` 就是檔名本身，不含斜線。
          return list.filter((f) => f.name.startsWith(p) && !f.path.includes("/")).length;
        }, prefix),
      { timeout: 25_000 },
    )
    .toBe(3);
  return files.map((f) => f.name);
}

/** 目前清單上，屬於這批的檔名（照畫面順序）。 */
const shown = (page: Page, prefix: string) =>
  page.evaluate(
    (p: string) =>
      [...document.querySelectorAll("p, span, div")]
        .map((n) => (n.textContent || "").trim())
        .filter((t) => t.startsWith(p) && t.endsWith(".txt"))
        .filter((t, i, arr) => arr.indexOf(t) === i),
    prefix,
  );

test("清單檢視點表頭可以依名稱與大小排序，方向也會切換", async ({ page }) => {
  await registerAndLogin(page, "sort");
  const prefix = `s${Date.now().toString(36)}`;
  await seed(page, prefix);

  await page.reload();
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜尋這個資料夾" }).fill(prefix);
  await page.getByRole("button", { name: "清單檢視" }).click();

  await expect.poll(() => shown(page, prefix), { timeout: 15_000 }).toHaveLength(3);

  // 預設依名稱遞增
  expect(await shown(page, prefix)).toEqual([
    `${prefix}-a.txt`,
    `${prefix}-b.txt`,
    `${prefix}-c.txt`,
  ]);

  // 再點一次「Name」→ 反向
  // ⚠️ 表頭按鈕的文字是「Name↑」——排序箭頭在按鈕**裡面**，所以 exact 對不上。
  await page.getByRole("button", { name: /^Name/ }).click();
  await expect
    .poll(() => shown(page, prefix), { timeout: 10_000 })
    .toEqual([`${prefix}-c.txt`, `${prefix}-b.txt`, `${prefix}-a.txt`]);

  // 依大小遞增：b(100) < c(200) < a(300) —— 跟名稱順序刻意不同
  await page.getByRole("button", { name: /^Size/ }).click();
  await expect
    .poll(() => shown(page, prefix), { timeout: 10_000 })
    .toEqual([`${prefix}-b.txt`, `${prefix}-c.txt`, `${prefix}-a.txt`]);
});

test("格狀與清單檢視切換得動", async ({ page }) => {
  await registerAndLogin(page, "viewmode");
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  await expect(page.locator("[data-window-frame]").first()).toBeVisible({ timeout: 15_000 });

  // 清單檢視有表頭（Name / Size），格狀沒有。
  await page.getByRole("button", { name: "清單檢視" }).click();
  await expect(page.getByRole("button", { name: /^Name/ })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "格狀檢視" }).click();
  await expect(page.getByRole("button", { name: /^Name/ })).toHaveCount(0, { timeout: 10_000 });
});
