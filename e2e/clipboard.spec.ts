import { expect, test } from "@playwright/test";

import { loadTusClient, registerAndLogin } from "./helpers";

/**
 * Finder 的複製／貼上。
 *
 * 為什麼要 E2E：這個功能之前**完全不存在** —— `useBatchCopy` 是零呼叫點，
 * 選單列的 Copy／Paste 是灰的、右鍵那個是沒有 onClick 的死項目。純函式那層測得到
 * `planPaste` 的判定（`features/files/clipboard.test.ts`），但「右鍵複製 →
 * 空白處貼上 → 磁碟上真的多一個檔案」跨了 store、mutation、背景 job 三層，
 * 只有真瀏覽器串得起來。
 *
 * 特別要釘住的是「貼到**同一個**資料夾」：後端原本會把原檔清成 0 byte
 * （`fs::copy` 先 truncate 目的地，而目的地就是來源）。
 */
test("複製後貼在同一個資料夾，會多一份而不是毀掉原檔", async ({ page }) => {
  await registerAndLogin(page, "clip");
  await loadTusClient(page);

  const name = `clip-${Date.now().toString(36)}.txt`;
  const body = "剪貼簿測試內容";

  const uploaded = await page.evaluate(
    async ({ name, body }) => {
      const file = new File([body], name, { type: "text/plain" });
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
    { name, body },
  );
  expect(uploaded, "建立測試檔案").toBe(true);

  // tus 落地之後還要等 indexer 寫進 DB，列表才看得到（列表是 DB 撐的）。
  const listed = (n: string) =>
    page.evaluate(async (name: string) => {
      const res = await fetch("/api/files");
      const list = (await res.json()) as { name: string }[];
      return list.some((f) => f.name === name);
    }, n);
  await expect.poll(() => listed(name), { timeout: 20_000 }).toBe(true);

  await page.getByRole("button", { name: "Finder", exact: true }).click();

  const row = page.getByText(name, { exact: true }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });

  // 選起來，然後走選單列 Edit → Copy（順帶涵蓋選單列的接線）。
  await row.click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: "Copy", exact: true }).click();
  await expect(page.getByText(/^已複製/)).toBeVisible();

  // 貼上走鍵盤 —— Finder 的 keydown 是掛在 window 上的。
  await page.keyboard.press("Control+v");

  // 複製是背景 job，等磁碟上真的出現複本。
  const copyName = name.replace(/\.txt$/, " (1).txt");
  await expect.poll(() => listed(copyName), { timeout: 20_000 }).toBe(true);

  // ⚠️ 重點：原檔不可以被清空。
  const original = await page.evaluate(async (n: string) => {
    const res = await fetch(`/api/download/${encodeURIComponent(n)}`);
    return res.ok ? await res.text() : `HTTP ${res.status}`;
  }, name);
  expect(original, "原檔不可以被清空").toBe(body);
});
