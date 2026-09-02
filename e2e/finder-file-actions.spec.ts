import { expect, test, type Page } from "@playwright/test";

import { loadTusClient, registerAndLogin, selectInFinder } from "./helpers";

/**
 * 檔案右鍵選單裡的其餘動作：Get Info、Tags、Add to Favorites。
 *
 * ⚠️ 這些在上一個 commit 之前**全部到不了** —— 右鍵檔案跳出來的是空白處的
 * 選單。所以它們雖然寫好很久了，實際上沒有人能用。
 */

async function uploadOne(page: Page, name: string) {
  await loadTusClient(page);
  const ok = await page.evaluate(async (n: string) => {
    const file = new File(["contents"], n, { type: "text/plain" });
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
          const res = await fetch("/api/files");
          const list = (await res.json()) as { name: string }[];
          return list.some((f) => f.name === n);
        }, name),
      { timeout: 20_000 },
    )
    .toBe(true);
}

async function openFinderOn(page: Page, name: string) {
  await page.reload();
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  await selectInFinder(page, name);
}

const rightClick = async (page: Page, name: string) => {
  await selectInFinder(page, name);
  await page.getByText(name, { exact: true }).first().click({ button: "right" });
};

test("Get Info 顯示名稱、大小與修改時間", async ({ page }) => {
  await registerAndLogin(page, "getinfo");
  const name = `gi-${Date.now().toString(36)}.txt`;
  await uploadOne(page, name);
  await openFinderOn(page, name);

  await rightClick(page, name);
  await page.getByRole("menuitem", { name: "Get Info", exact: true }).click();

  await expect(page.getByText("File Information")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  // 修改時間必須是真的日期 —— 這裡曾經整片都是 Invalid Date。
  await expect(page.getByText("Invalid Date")).toHaveCount(0);
  await expect(page.getByText(/\b20\d{2}\b/).first()).toBeVisible();
});

test("加到我的最愛，側邊欄就會出現它", async ({ page }) => {
  await registerAndLogin(page, "fav");
  const name = `fv-${Date.now().toString(36)}.txt`;
  await uploadOne(page, name);
  await openFinderOn(page, name);

  await rightClick(page, name);
  await page.getByRole("menuitem", { name: "Add to Favorites", exact: true }).click();

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const res = await fetch("/api/favorites");
          if (!res.ok) return [`HTTP ${res.status}`];
          const list = (await res.json()) as { name: string }[];
          return list.map((f) => f.name);
        }),
      { timeout: 20_000 },
    )
    .toContain(name);
});

test("加標籤之後，用側邊欄的標籤篩得到它", async ({ page }) => {
  await registerAndLogin(page, "tags");
  const name = `tg-${Date.now().toString(36)}.txt`;
  const tag = `t${Date.now().toString(36)}`;
  await uploadOne(page, name);
  await openFinderOn(page, name);

  await rightClick(page, name);
  await page.getByRole("menuitem", { name: "Tags...", exact: true }).click();
  await expect(page.getByText("管理標籤")).toBeVisible({ timeout: 10_000 });

  // ⚠️ 輸入框一開始不存在 —— 要先按「新增自訂標籤」才會出現。
  // 我第一版直接找 placeholder，等到逾時，而畫面上其實只有快速標籤那排顏色。
  await page.getByRole("dialog").getByText("新增自訂標籤").click();
  const input = page.getByPlaceholder("輸入標籤名稱");
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(tag);
  await input.press("Enter");

  await expect
    .poll(
      () =>
        page.evaluate(async (t: string) => {
          const res = await fetch(`/api/tags/${encodeURIComponent(t)}/files`);
          if (!res.ok) return [`HTTP ${res.status}`];
          const list = (await res.json()) as { name: string }[];
          return list.map((f) => f.name);
        }, tag),
      { timeout: 20_000 },
    )
    .toContain(name);
});
