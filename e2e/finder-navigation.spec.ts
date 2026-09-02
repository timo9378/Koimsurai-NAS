import { expect, test, type Page } from "@playwright/test";

import { loadTusClient, registerAndLogin } from "./helpers";

/**
 * Finder 的導覽：進資料夾、上一頁／下一頁、麵包屑。
 *
 * `finder/history.ts` 有純函式測試（`pushPath` / `goBack` / `goForward` 的
 * 邊界），但「按下去真的會走」沒有被驗過 —— 而歷史紀錄最容易錯的地方正是
 * 「按鈕的 disabled 狀態」與「走過去之後清單真的換了」這兩件事，那是純函式
 * 看不到的。
 */

/** 讀某個目錄的檔名。 */
function listing(page: Page, dir = "") {
  return page.evaluate(async (d: string) => {
    const res = await fetch(d ? `/api/files/${d}` : "/api/files");
    if (!res.ok) return [`HTTP ${res.status}`];
    const list = (await res.json()) as { name: string }[];
    return list.map((f) => f.name).sort();
  }, dir);
}

test("進資料夾 → 上一頁 → 下一頁 → 麵包屑回根目錄", async ({ page }) => {
  await registerAndLogin(page, "nav");
  const folder = `nav-${Date.now().toString(36)}`;
  const inner = `inside-${Date.now().toString(36)}.txt`;

  // 建資料夾，並在裡面放一個只有它才有的檔案 —— 這樣「清單真的換了」
  // 才有東西可以斷言（根目錄是所有測試共用的，不能靠數量）。
  await loadTusClient(page);
  await page.evaluate(
    async ({ folder, inner }) => {
      await fetch("/api/files/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "", folder_name: folder }),
      });
      const file = new File(["inner"], inner, { type: "text/plain" });
      await new Promise<boolean>((resolve) => {
        const up = new window.tus.Upload(file, {
          endpoint: "/api/tus",
          metadata: { filename: inner, path: folder },
          onSuccess: () => resolve(true),
          onError: () => resolve(false),
        });
        up.start();
      });
    },
    { folder, inner },
  );
  await expect.poll(() => listing(page, folder), { timeout: 20_000 }).toContain(inner);

  await page.reload();
  await page.getByRole("button", { name: "Finder", exact: true }).click();

  const back = page.getByRole("button", { name: "上一頁" });
  const forward = page.getByRole("button", { name: "下一頁" });

  // 一開始在根目錄：兩顆都不能按。
  await expect(back).toBeDisabled({ timeout: 15_000 });
  await expect(forward).toBeDisabled();

  // 進資料夾（雙擊）。
  const search = page.getByRole("searchbox", { name: "搜尋這個資料夾" });
  await search.fill(folder);
  await page.getByText(folder, { exact: true }).first().dblclick();

  // ⚠️ 搜尋條件在切換目錄之後**還留著**，會把資料夾裡的東西一起濾掉。
  // （這本身是個可以討論的行為，但這裡先照現況清掉。）
  await search.fill("");
  await expect(page.getByText(inner, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // 進去之後「上一頁」可以按了，「下一頁」還不行。
  await expect(back).toBeEnabled();
  await expect(forward).toBeDisabled();

  // 上一頁 → 回到根目錄，資料夾裡的檔案不該再出現。
  await back.click();
  await expect(page.getByText(inner, { exact: true })).toHaveCount(0, { timeout: 15_000 });
  await expect(forward).toBeEnabled();

  // 下一頁 → 又回到資料夾裡。
  await forward.click();
  await expect(page.getByText(inner, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // 麵包屑回根目錄。
  await page.getByRole("button", { name: "Home", exact: true }).first().click();
  await expect(page.getByText(inner, { exact: true })).toHaveCount(0, { timeout: 15_000 });
});
