import { expect, test } from "@playwright/test";

import { loadTusClient, registerAndLogin } from "./helpers";

/**
 * 公開分享頁 `/s/{id}`。
 *
 * 為什麼要 E2E：這是整個站**唯一給未登入的陌生人看**的介面（19KB 的元件），
 * 而它一條瀏覽器層的測試都沒有。後端有 `share_link_tests.rs`，但「連結貼給
 * 別人、對方在沒有 cookie 的瀏覽器裡打開會看到什麼」只有這裡測得到 ——
 * 而那正是最不該壞的一段。
 */
test("分享連結在沒有登入的瀏覽器裡打得開，也下載得到", async ({ page, browser }) => {
  await registerAndLogin(page, "sharer");
  await loadTusClient(page);

  const name = `shared-${Date.now().toString(36)}.txt`;
  const body = "分享頁測試內容";

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

  const shareId = await page.evaluate(async (n: string) => {
    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: n }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id: string };
    return data.id;
  }, name);
  if (shareId === null) throw new Error("建立分享連結失敗");

  // ⚠️ 開一個全新的 context —— 重點就是「沒有 cookie 的陌生人」。
  // 用同一個 page 的話會帶著登入狀態，等於什麼都沒驗到。
  const anonymous = await browser.newContext();
  const guest = await anonymous.newPage();
  await guest.goto(`/s/${shareId}`);

  await expect(guest.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });

  // 下載真的拿得到檔案內容。
  const content = await guest.evaluate(async (id: string) => {
    const res = await fetch(`/api/share/${id}/download`);
    return res.ok ? await res.text() : `HTTP ${res.status}`;
  }, shareId);
  expect(content).toBe(body);

  await anonymous.close();
});

/**
 * 有密碼的分享連結：打錯要**說出來**。
 *
 * ⚠️ 這頁用原生的 `<a download>` 觸發下載（大檔案唯一可靠的做法），而瀏覽器
 * 不會把 401 交回頁面 —— 密碼打錯時畫面上原本完全沒有任何反應，使用者只能猜
 * 是密碼錯了、連結過期了、還是站掛了。現在會先打一個不產生內容的驗證端點。
 */
test("分享頁的密碼打錯會顯示訊息，而不是靜靜沒反應", async ({ page, browser }) => {
  await registerAndLogin(page, "pwshare");
  await loadTusClient(page);

  const name = `pw-${Date.now().toString(36)}.txt`;
  const uploaded = await page.evaluate(async (n: string) => {
    const file = new File(["secret"], n, { type: "text/plain" });
    return await new Promise<boolean>((resolve) => {
      const upload = new window.tus.Upload(file, {
        endpoint: "/api/tus",
        metadata: { filename: n, path: "" },
        onSuccess: () => resolve(true),
        onError: () => resolve(false),
      });
      upload.start();
    });
  }, name);
  expect(uploaded).toBe(true);

  const shareId = await page.evaluate(async (n: string) => {
    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: n, password: "correct horse" }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { id: string }).id;
  }, name);
  if (shareId === null) throw new Error("建立分享連結失敗");

  const anonymous = await browser.newContext();
  const guest = await anonymous.newPage();
  await guest.goto(`/s/${shareId}`);

  const input = guest.locator('input[type="password"]');
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.fill("wrong one");
  await guest.getByRole("button", { name: "確認" }).click();

  await expect(guest.getByText(/密碼不正確/)).toBeVisible({ timeout: 15_000 });

  await anonymous.close();
});
