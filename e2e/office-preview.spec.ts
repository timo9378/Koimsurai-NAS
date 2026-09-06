import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { loadTusClient, registerAndLogin, selectInFinder } from "./helpers";

/**
 * Office 文件的預覽。
 *
 * 為什麼要這條：`FilePreview` 原本對所有 `.docx?/.xlsx?/.pptx?` 一律顯示
 * 「目前不支援直接預覽 Office 文件」。現在 docx / xlsx 會真的畫出來，而畫的
 * 過程全在瀏覽器裡（動態 import docx-preview / exceljs）—— 這種「載入一包
 * 幾百 KB 的函式庫再解析二進位」的路徑，單元測試驗不到：jsdom 沒有真正的
 * 版面，動態 import 在 vitest 裡也是同一個 process。只有真的開一份檔案、
 * 真的看到裡面的字，才算數。
 *
 * fixture 是 committed 的真 OOXML 檔（`e2e/fixtures/`），不是臨時拼的字串
 * —— 用假的 zip 會在解析階段就掛掉，那樣測到的是「錯誤處理」，不是預覽。
 */

async function uploadFixture(page: Page, fixture: string, name: string) {
  await loadTusClient(page);
  const base64 = readFileSync(`e2e/fixtures/${fixture}`).toString("base64");

  const ok = await page.evaluate(
    async ({ base64, name }) => {
      // base64 → Blob。tus 要的是真的二進位，字串會讓檔案內容整個壞掉。
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], name);

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
    { base64, name },
  );
  expect(ok, `上傳 ${name}`).toBe(true);

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
}

/** 上傳、開 Finder、選起來、空白鍵開 Quick Look。 */
async function openPreview(page: Page, fixture: string, name: string) {
  await registerAndLogin(page, "office");
  await uploadFixture(page, fixture, name);
  await page.reload();
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  await selectInFinder(page, name);
  await page.keyboard.press("Space");
  await expect(page.locator("[data-window-frame]")).toHaveCount(2, { timeout: 15_000 });
}

test(".docx 會把內容畫出來，不是叫使用者去下載", async ({ page }) => {
  const name = `doc-${Date.now().toString(36)}.docx`;
  await openPreview(page, "sample.docx", name);

  const view = page.getByTestId("docx-view");
  await expect(view).toBeVisible({ timeout: 20_000 });

  // 內文真的被解析出來 —— 光是 docx-view 存在不算，那個容器在解析失敗時也在。
  await expect(view).toContainText("KOIMSURAI_DOCX_MARKER", { timeout: 20_000 });
  await expect(view).toContainText("驗證 .docx 預覽");

  // 舊的那句話不可以再出現。
  await expect(page.getByText("目前不支援直接預覽 Office 文件")).toHaveCount(0);
});

test(".xlsx 會畫成表格，空白列不會讓資料錯位，而且切得到第二張工作表", async ({ page }) => {
  const name = `sheet-${Date.now().toString(36)}.xlsx`;
  await openPreview(page, "sample.xlsx", name);

  const view = page.getByTestId("xlsx-view");
  await expect(view).toBeVisible({ timeout: 20_000 });
  await expect(view).toContainText("KOIMSURAI_XLSX_MARKER", { timeout: 20_000 });
  await expect(view).toContainText("1234");

  // fixture 的第 3 列是空的，第 4 列才是「三月」。exceljs 的 eachRow 預設會
  // **跳過**空列 —— 如果實作直接 push，三月會跑到第 3 列去。
  const rows = view.locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(2)).not.toContainText("三月");
  await expect(rows.nth(3)).toContainText("三月");

  // 兩張表 → 要有分頁可以切。
  const tab = page.getByRole("tab", { name: "第二張表" });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(view).toContainText("SECOND_SHEET_MARKER");
});

test("舊格式（.doc）的說法要跟「不支援」不一樣，而且要告訴使用者怎麼救", async ({ page }) => {
  // 內容不重要 —— 這條走的是分類，根本不會去下載檔案。
  const name = `legacy-${Date.now().toString(36)}.doc`;
  await registerAndLogin(page, "officeleg");
  await loadTusClient(page);
  const ok = await page.evaluate(async (n: string) => {
    const file = new File(["not really a doc"], n);
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
  await page.keyboard.press("Space");
  await expect(page.locator("[data-window-frame]")).toHaveCount(2, { timeout: 15_000 });

  // 要講「另存成 .docx」，而不是一句沒有下一步的「不支援」。
  await expect(page.getByText(/另存成/)).toBeVisible({ timeout: 15_000 });
});
