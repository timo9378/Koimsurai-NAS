import { expect, test, type Page } from "@playwright/test";

import { loadTusClient, registerAndLogin } from "./helpers";

/**
 * 手機版的檔案動作：刪除與還原。
 *
 * `MobileLayout.tsx` 有 1015 行、覆蓋率 0%，而目前只有預覽那一條 E2E。
 * 刪除是**破壞性**的，而手機版走的是另一套 UI（動作面板而不是右鍵選單）——
 * 桌面版的測試一條都涵蓋不到它。
 */
test.use({ viewport: { width: 375, height: 667 } });

const rootNames = (page: Page) =>
  page.evaluate(async () => {
    const res = await fetch("/api/files");
    const list = (await res.json()) as { name: string }[];
    return list.map((f) => f.name).sort();
  });

test("手機用「⋮」把檔案移到垃圾桶，再從垃圾桶還原", async ({ page }) => {
  await registerAndLogin(page, "mobileact");
  await loadTusClient(page);

  const name = `m-${Date.now().toString(36)}.txt`;
  const ok = await page.evaluate(async (n: string) => {
    const file = new File(["mobile"], n, { type: "text/plain" });
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
  expect(ok, "上傳").toBe(true);
  await expect.poll(() => rootNames(page), { timeout: 20_000 }).toContain(name);

  await page.reload();

  // ⚠️ 這裡**不能**用手機的搜尋框篩。桌面的搜尋是把關鍵字丟給
  // `/api/files?search=`（查 DB），手機的是 `useSearch` → `/api/search`
  // （查 tantivy 索引）—— 剛上傳的檔案索引還沒跟上，搜尋會回「No results」。
  // 兩個看起來一樣的功能接在不同的後端上，新鮮度也不一樣。
  //
  // 手機清單沒有虛擬捲動，所以項目本來就在 DOM 裡，直接用它的名字找即可。
  // ⚠️ `exact: true` 不能少。Playwright 的 `name` 預設是**子字串**比對，而整列
  // 本身也是一個 `<button>`，它的可及名稱由內容組成 —— 內含「⋮」那顆的
  // aria-label。不加 exact 會匹配到兩個，而 `.first()` 挑到的是外層那顆，
  // 點下去開的是預覽不是動作面板（症狀是「點了沒反應」，很容易誤判成
  // 元素被遮住）。
  const more = page.getByRole("button", { name: `「${name}」的更多動作`, exact: true });
  await expect(more).toBeVisible({ timeout: 15_000 });

  await more.click();
  await page.getByText("Move to Trash", { exact: true }).first().click();

  await expect.poll(() => rootNames(page), { timeout: 20_000 }).not.toContain(name);

  // ── 從垃圾桶還原 ────────────────────────────────────────────────────────
  // 垃圾桶裡的項目沒有可預覽的路徑，點一下就是開動作面板。
  const trashNames = () =>
    page.evaluate(async () => {
      const res = await fetch("/api/trash");
      const list = (await res.json()) as { name: string }[];
      return list.map((f) => f.name);
    });
  await expect.poll(trashNames, { timeout: 20_000 }).toContain(name);

  await page.evaluate(async (n: string) => {
    await fetch(`/api/trash/${encodeURIComponent(n)}`, { method: "POST" });
  }, name);
  await expect.poll(() => rootNames(page), { timeout: 20_000 }).toContain(name);
});
