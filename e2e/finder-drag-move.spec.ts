import { expect, test, type Page } from "@playwright/test";

import { loadTusClient, registerAndLogin } from "./helpers";

/**
 * Finder 的拖放移動。
 *
 * 為什麼現在補：這是 Finder 最常用的操作之一，而它在瀏覽器裡從來沒被驗過 ——
 * `finder/move.ts` 的判定有純函式測試，但「拖了真的會搬」沒有。而且我剛改過
 * 它的撞名行為：後端原本是 `dest.join(檔名)` 直接 `fs::rename`，而 rename 在
 * 目的地已存在時是**原子性取代** —— 把 report.pdf 拖進一個已經有 report.pdf
 * 的資料夾，原本那份就這樣沒了。現在會變成 `report (1).pdf`。
 */

/** 在根目錄放一個檔案（走 tus，跟真實上傳同一條路）。 */
async function upload(page: Page, name: string, content: string) {
  await loadTusClient(page);
  const ok = await page.evaluate(
    async ({ name, content }) => {
      const file = new File([content], name, { type: "text/plain" });
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
    { name, content },
  );
  expect(ok, `上傳 ${name}`).toBe(true);
}

/** 列出某個目錄下的檔名。 */
function listing(page: Page, dir = "") {
  return page.evaluate(async (d: string) => {
    const res = await fetch(d ? `/api/files/${d}` : "/api/files");
    if (!res.ok) return [`HTTP ${res.status}`];
    const list = (await res.json()) as { name: string }[];
    return list.map((f) => f.name).sort();
  }, dir);
}

async function makeFolder(page: Page, name: string) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New Folder" }).click();
  const input = page.getByRole("textbox", { name: /^重新命名/ });
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.fill(name);
  await input.press("Enter");
  await expect.poll(() => listing(page), { timeout: 20_000 }).toContain(name);
}

test("把檔案拖進資料夾，它真的會搬過去", async ({ page }) => {
  await registerAndLogin(page, "dragmove");
  // ⚠️ 共用前綴：拖放需要來源與目的地**同時**被渲染出來，所以要用一次搜尋
  // 把兩個都篩出來。E2E 的儲存根是所有測試共用的，不篩的話清單裡有幾十個
  // 檔案，而它是虛擬捲動的 —— 目標可能根本不在 DOM 裡。
  const prefix = `mv${Date.now().toString(36)}`;
  const file = `${prefix}-file.txt`;
  const folder = `${prefix}-box`;

  await upload(page, file, "payload");
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  await expect(page.locator('[data-context-type="window-title"]').first()).toBeVisible({
    timeout: 15_000,
  });
  await makeFolder(page, folder);

  await page.reload();
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜尋這個資料夾" }).fill(prefix);
  await expect(page.getByText(file, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(folder, { exact: true }).first()).toBeVisible();

  await page
    .getByText(file, { exact: true })
    .first()
    .dragTo(page.getByText(folder, { exact: true }).first());

  await expect.poll(() => listing(page), { timeout: 20_000 }).not.toContain(file);
  await expect.poll(() => listing(page, folder), { timeout: 20_000 }).toContain(file);
});

test("拖到已經有同名檔案的資料夾，不會把對方吃掉", async ({ page }) => {
  await registerAndLogin(page, "dragcollide");
  const prefix = `dup${Date.now().toString(36)}`;
  const name = `${prefix}-file.txt`;
  const folder = `${prefix}-box`;

  // 資料夾裡先放一份「不可以不見」的同名檔案。
  await loadTusClient(page);
  await page.evaluate(
    async ({ name, folder }) => {
      await fetch("/api/files/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "", folder_name: folder }),
      });
      const file = new File(["do not lose me"], name, { type: "text/plain" });
      await new Promise<boolean>((resolve) => {
        const up = new window.tus.Upload(file, {
          endpoint: "/api/tus",
          metadata: { filename: name, path: folder },
          onSuccess: () => resolve(true),
          onError: () => resolve(false),
        });
        up.start();
      });
    },
    { name, folder },
  );
  await expect.poll(() => listing(page, folder), { timeout: 20_000 }).toContain(name);

  // 根目錄再放一份同名的，內容不同 —— 這樣才分辨得出誰是誰。
  await upload(page, name, "incoming");
  await expect.poll(() => listing(page), { timeout: 20_000 }).toContain(name);

  await page.reload();
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜尋這個資料夾" }).fill(prefix);
  await expect(page.getByText(folder, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();

  await page
    .getByText(name, { exact: true })
    .first()
    .dragTo(page.getByText(folder, { exact: true }).first());

  // ⚠️ 重點：原本那份還在，而且內容沒被換掉。
  await expect
    .poll(() => listing(page, folder), { timeout: 20_000, message: "撞名時應該多一份而不是覆蓋" })
    .toHaveLength(2);

  const original = await page.evaluate(
    async ({ folder, name }) => {
      const res = await fetch(`/api/download/${folder}/${encodeURIComponent(name)}`);
      return res.ok ? await res.text() : `HTTP ${res.status}`;
    },
    { folder, name },
  );
  expect(original, "既有的檔案不可以被覆寫").toBe("do not lose me");
});
