import { expect, test, type Page } from "@playwright/test";

import { loadTusClient, registerAndLogin } from "./helpers";

/**
 * Finder 的多選、全選、Quick Look，以及剪下貼上（移動）。
 *
 * `finder/selection.ts` 與 `finder/clipboard.ts` 都有純函式測試，但「Cmd+A
 * 真的全選」「Space 真的開預覽」「剪下貼上真的搬走」沒有驗過。
 * 剪下這條尤其重要：複製有 E2E，剪下沒有，而兩者走的是不同的後端端點
 * （batch/copy 是排隊的 job，batch/move 是同步的）。
 */

async function seed(page: Page, prefix: string, count: number) {
  await loadTusClient(page);
  for (let i = 0; i < count; i++) {
    const name = `${prefix}-${i}.txt`;
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
    expect(ok).toBe(true);
  }
  await expect
    .poll(
      () =>
        page.evaluate(async (p: string) => {
          const res = await fetch("/api/files");
          const list = (await res.json()) as { name: string }[];
          return list.filter((f) => f.name.startsWith(p)).length;
        }, prefix),
      { timeout: 25_000 },
    )
    .toBe(count);
}

const rootCount = (page: Page, prefix: string) =>
  page.evaluate(async (p: string) => {
    const res = await fetch("/api/files");
    const list = (await res.json()) as { name: string }[];
    return list.filter((f) => f.name.startsWith(p)).length;
  }, prefix);

test("Cmd+A 全選之後按 Delete，整批都進垃圾桶", async ({ page }) => {
  await registerAndLogin(page, "selall");
  const prefix = `sa${Date.now().toString(36)}`;
  await seed(page, prefix, 3);

  await page.reload();
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  // 篩到只剩這批 —— 全選才不會把別的測試的檔案一起刪掉。
  await page.getByRole("searchbox", { name: "搜尋這個資料夾" }).fill(prefix);
  await expect(page.getByText(`${prefix}-0.txt`, { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });

  // 先點一個檔案讓焦點在清單上，再全選。
  await page.getByText(`${prefix}-0.txt`, { exact: true }).first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");

  await expect.poll(() => rootCount(page, prefix), { timeout: 25_000 }).toBe(0);
});

test("剪下貼上會把檔案搬到別的資料夾", async ({ page }) => {
  await registerAndLogin(page, "cutpaste");
  const prefix = `cp${Date.now().toString(36)}`;
  const file = `${prefix}-file.txt`;
  const folder = `${prefix}-box`;

  await loadTusClient(page);
  await page.evaluate(
    async ({ file, folder }) => {
      await fetch("/api/files/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "", folder_name: folder }),
      });
      const f = new File(["moved by cut"], file, { type: "text/plain" });
      await new Promise((r) => {
        const u = new window.tus.Upload(f, {
          endpoint: "/api/tus",
          metadata: { filename: file, path: "" },
          onSuccess: () => r(true),
          onError: () => r(false),
        });
        u.start();
      });
    },
    { file, folder },
  );
  await expect.poll(() => rootCount(page, prefix), { timeout: 25_000 }).toBe(2);

  await page.reload();
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "搜尋這個資料夾" });
  await search.fill(prefix);
  await expect(page.getByText(file, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // 剪下（選單列 Edit → Cut），進資料夾，貼上。
  await page.getByText(file, { exact: true }).first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: "Cut" }).click();
  await expect(page.getByText(/^已剪下/)).toBeVisible({ timeout: 10_000 });

  await page.getByText(folder, { exact: true }).first().dblclick();
  await search.fill("");
  await page.keyboard.press("ControlOrMeta+v");

  await expect
    .poll(
      () =>
        page.evaluate(async (f: string) => {
          const res = await fetch(`/api/files/${f}`);
          if (!res.ok) return [`HTTP ${res.status}`];
          const list = (await res.json()) as { name: string }[];
          return list.map((x) => x.name);
        }, folder),
      { timeout: 25_000 },
    )
    .toContain(file);

  // 原本的位置不該再有它。
  await expect.poll(() => rootCount(page, prefix), { timeout: 20_000 }).toBe(1);
});

test("選一個檔案按空白鍵會開 Quick Look 預覽", async ({ page }) => {
  await registerAndLogin(page, "quicklook");
  const prefix = `ql${Date.now().toString(36)}`;
  await seed(page, prefix, 1);

  await page.reload();
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜尋這個資料夾" }).fill(prefix);

  const name = `${prefix}-0.txt`;
  await page.getByText(name, { exact: true }).first().click({ timeout: 15_000 });
  await page.keyboard.press("Space");

  // Quick Look 是另一個視窗（preview app）。
  await expect(page.locator("[data-window-frame]")).toHaveCount(2, { timeout: 15_000 });
});
