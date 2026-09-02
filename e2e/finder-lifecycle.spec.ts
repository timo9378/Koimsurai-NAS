import { expect, test } from "@playwright/test";

import { loadTusClient, registerAndLogin } from "./helpers";

/**
 * Finder 的核心生命週期：建立資料夾 → 重新命名 → 刪除 → 復原。
 *
 * 為什麼這條該是第一個補的 E2E：`Finder.tsx` 有 1547 行、覆蓋率 0%，而這四個
 * 動作就是這個 app 存在的理由。它們今天全部被改過 ——
 *   - `DELETE /api/files/*path` 現在回 `{ trash_name }`
 *   - 「復原」送的是**垃圾桶檔名**而不是原始路徑（撞名時兩者不同）
 *   - 重新命名的判定抽成了 `finder/rename.ts`
 * 而這一整條在瀏覽器裡從來沒有被驗證過：純函式測得到判定，測不到「按下去
 * 真的會發生」。
 */
test("建立資料夾 → 重新命名 → 刪除 → 復原", async ({ page }) => {
  await registerAndLogin(page, "lifecycle");
  await page.getByRole("button", { name: "Finder", exact: true }).click();

  const windowTitle = page.locator('[data-context-type="window-title"]').first();
  await expect(windowTitle).toBeVisible({ timeout: 15_000 });

  const listed = (name: string) =>
    page.evaluate(async (n: string) => {
      const res = await fetch("/api/files");
      const list = (await res.json()) as { name: string }[];
      return list.some((f) => f.name === n);
    }, name);

  // ── 建立 ────────────────────────────────────────────────────────────────
  // 走選單列的 File → New Folder（右鍵選單在虛擬清單上不好命中，而且這樣
  // 順帶也涵蓋到選單列的接線）。
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New Folder" }).click();

  // 新資料夾一出現就會進入重新命名模式（游標停在輸入框裡）。
  const renameInput = page.getByRole("textbox", { name: /^重新命名/ });
  await expect(renameInput).toBeVisible({ timeout: 15_000 });

  const folder = `lc-${Date.now().toString(36)}`;
  await renameInput.fill(folder);
  await renameInput.press("Enter");

  await expect.poll(() => listed(folder), { timeout: 20_000 }).toBe(true);
  await expect(page.getByText(folder, { exact: true }).first()).toBeVisible();

  // ── 刪除 ────────────────────────────────────────────────────────────────
  await page.getByText(folder, { exact: true }).first().click();
  await page.keyboard.press("Delete");

  await expect.poll(() => listed(folder), { timeout: 20_000 }).toBe(false);

  // ── 復原 ────────────────────────────────────────────────────────────────
  // ⚠️ 這是重點：toast 的「復原」送的是**垃圾桶檔名**。撞名時後端會存成
  // `原名.<timestamp>`，用原始檔名去還原會還原到別的東西。
  const undo = page.getByRole("button", { name: "復原" });
  await expect(undo).toBeVisible({ timeout: 10_000 });
  await undo.click();

  await expect.poll(() => listed(folder), { timeout: 20_000 }).toBe(true);
});

/**
 * 撞名時「復原」要還原**剛剛刪掉的那一個**。
 *
 * ⚠️ 上面那條測不到這件事：沒有撞名時 `trash_name` 就等於原檔名，送哪一個
 * 都會過。垃圾桶是扁平的，撞名時後端存成 `原名.<timestamp>` —— 用原始檔名
 * 去還原會把**上一次**刪掉的那份撈回來，而使用者以為自己復原的是剛剛那次。
 *
 * 兩份內容不同才分辨得出來還原的是哪一個。
 */
test("同名檔案刪兩次，復原拿回來的是最後刪掉的那份", async ({ page }) => {
  await registerAndLogin(page, "collide");
  await loadTusClient(page);

  const name = `dup-${Date.now().toString(36)}.txt`;

  // ⚠️ 每次都重新注入：底下的 deleteViaFinder 會 reload，而 reload 會把
  // 注入的 tus client 清掉。
  const upload = async (content: string) => {
    await loadTusClient(page);
    return page.evaluate(
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
  };

  const listed = () =>
    page.evaluate(async (n: string) => {
      const res = await fetch("/api/files");
      const list = (await res.json()) as { name: string }[];
      return list.some((f) => f.name === n);
    }, name);

  const contentOf = () =>
    page.evaluate(async (n: string) => {
      const res = await fetch(`/api/download/${encodeURIComponent(n)}`);
      return res.ok ? await res.text() : `HTTP ${res.status}`;
    }, name);

  const deleteViaFinder = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Finder", exact: true }).click();
    await page.getByText(name, { exact: true }).first().click({ timeout: 15_000 });
    await page.keyboard.press("Delete");
    await expect.poll(listed, { timeout: 20_000 }).toBe(false);
  };

  // 第一次：內容 "first"，刪掉 → 垃圾桶裡是「原名」
  expect(await upload("first")).toBe(true);
  await expect.poll(listed, { timeout: 20_000 }).toBe(true);
  await deleteViaFinder();

  // 第二次：同名但內容 "second"，刪掉 → 撞名，垃圾桶裡是「原名.<timestamp>」
  expect(await upload("second")).toBe(true);
  await expect.poll(listed, { timeout: 20_000 }).toBe(true);
  await deleteViaFinder();

  const undo = page.getByRole("button", { name: "復原" });
  await expect(undo).toBeVisible({ timeout: 10_000 });
  await undo.click();

  await expect.poll(listed, { timeout: 20_000 }).toBe(true);
  await expect
    .poll(contentOf, { timeout: 20_000, message: "復原的應該是剛剛刪掉的那一份" })
    .toBe("second");
});
