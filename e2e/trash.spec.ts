import { expect, test, type Page } from "@playwright/test";

import { loadTusClient, registerAndLogin, selectInFinder } from "./helpers";

/**
 * 垃圾桶：永久刪除與清空。
 *
 * 為什麼補這條：兩個都是**不可逆**的操作，而它們只有後端測試。前端的確認
 * 對話框、以及「按下去之後列表真的空了」在瀏覽器裡從來沒有被驗過 ——
 * 而「以為刪掉了其實沒刪」跟「以為只刪一個結果全清了」都是很貴的錯。
 *
 * 這兩個動作今天也被改過：`empty_trash` 與 `permanent_delete` 現在會進稽核
 * 紀錄（原本連 user_id 都是 `Extension(_user_id)` 取了不用）。
 */

async function uploadFile(page: Page, name: string) {
  await loadTusClient(page);
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
  expect(ok, `上傳 ${name}`).toBe(true);
}

/**
 * 根目錄上**符合 `query`** 的檔名。
 *
 * ⚠️ 一定要帶 `search`。`/api/files` 預設 `limit=50`，而 E2E 的儲存根是全域
 * 共用的 —— 整套跑下來會累積上百筆，自己的檔案照名稱排序掉在第一頁之外，
 * 看起來就跟上傳失敗一模一樣（單獨跑時根目錄很空，所以永遠是綠的）。
 */
const rootNames = (page: Page, query: string) =>
  page.evaluate(async (q: string) => {
    const res = await fetch(`/api/files?search=${encodeURIComponent(q)}&limit=500`);
    const list = (await res.json()) as { name: string }[];
    return list.map((f) => f.name).sort();
  }, query);

const trashNames = (page: Page) =>
  page.evaluate(async () => {
    const res = await fetch("/api/trash");
    if (!res.ok) return [`HTTP ${res.status}`];
    const list = (await res.json()) as { name: string }[];
    return list.map((f) => f.name).sort();
  });

/** 刪掉一個檔案，並確認它進了垃圾桶。 */
async function deleteToTrash(page: Page, name: string) {
  await selectInFinder(page, name);
  await page.keyboard.press("Delete");
  await expect.poll(() => rootNames(page, name), { timeout: 20_000 }).not.toContain(name);
}

test("清空垃圾桶：要先確認，確認之後垃圾桶真的空了", async ({ page }) => {
  await registerAndLogin(page, "emptytrash");
  const a = `t1-${Date.now().toString(36)}.txt`;
  const b = `t2-${Date.now().toString(36)}.txt`;

  await uploadFile(page, a);
  await uploadFile(page, b);
  // 兩個檔名各自搜尋 —— `search` 是 `name LIKE %…%`，一次只問一個才問得準。
  await expect.poll(() => rootNames(page, a), { timeout: 20_000 }).toContain(a);
  await expect.poll(() => rootNames(page, b), { timeout: 20_000 }).toContain(b);

  await page.reload();
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  await deleteToTrash(page, a);
  await deleteToTrash(page, b);
  // ⚠️ 斷言的是**自己的檔名**而不是數量。`.trash` 是全域共用的（沒有 user
  // 分隔），平行跑的其他測試會把它們的項目混進來 —— 我第一版用
  // `toHaveLength(2)`，單獨跑三次都綠，整套跑就紅了。
  await expect
    .poll(() => trashNames(page), { timeout: 20_000 })
    .toEqual(expect.arrayContaining([a, b]));

  // 進垃圾桶
  // Dock 也有一顆叫 Trash 的，用側邊欄那一顆（在 Finder 視窗裡）。
  await page.getByRole("button", { name: "Trash", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Empty Trash" })).toBeVisible({ timeout: 15_000 });

  // ⚠️ 要先出現確認 —— 這是不可逆的。
  await page.getByRole("button", { name: "Empty Trash" }).click();
  await expect(page.getByText(/Empty Trash\?/)).toBeVisible();

  // 垃圾桶在確認之前不能被動過 —— 這一行就是「確認對話框有沒有真的擋住」
  // 的斷言：按鈕如果直接清空，這裡就會紅。
  expect(await trashNames(page)).toEqual(expect.arrayContaining([a, b]));

  await page.getByRole("button", { name: "Empty Trash", exact: true }).last().click();

  await expect
    .poll(() => trashNames(page), { timeout: 20_000 })
    .toEqual(expect.not.arrayContaining([a, b]));
});

test("清空垃圾桶會進稽核紀錄 —— 不可逆的操作要查得到是誰做的", async ({ page }) => {
  await registerAndLogin(page, "trashaudit");
  const name = `au-${Date.now().toString(36)}.txt`;

  await uploadFile(page, name);
  await expect.poll(() => rootNames(page, name), { timeout: 20_000 }).toContain(name);

  await page.reload();
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  await deleteToTrash(page, name);

  await page.evaluate(async () => {
    await fetch("/api/trash", { method: "DELETE" });
  });

  const actions = await page.evaluate(async () => {
    const res = await fetch("/api/audit/logs");
    const logs = (await res.json()) as { action: string }[];
    return logs.map((l) => l.action);
  });
  expect(actions, "清空垃圾桶要留下紀錄").toContain("empty_trash");
});
