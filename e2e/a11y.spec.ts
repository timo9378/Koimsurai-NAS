import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { registerAndLogin } from "./helpers";

// axe 掃的是「規則能自動判定」的那一小部分可及性（大約 30–40%）——
// 掃過不等於可用，但掃出來的都是真的。所以這裡只擋 serious/critical，
// 而且把當下的違規數當**棘輪**：既有的債不阻擋 CI，新增的會。

const BLOCKING = ["serious", "critical"];

/// 目前已知、還沒修的違規。數字是**上限**，修掉就把它調下來；
/// 兩頁現在都是 0，新增的 serious/critical 會當場擋下。
///
/// 導入這支測試時掃出兩個並當場修掉的：
///   - `aria-allowed-attr`（critical，桌面 3 個節點）：Radix 的
///     `PopoverTrigger asChild` 包在純 `div` 上，Radix 會掛
///     aria-controls / aria-expanded，而 div 不允許那些屬性。
///     更要緊的是那三顆按鈕**根本 Tab 不到**。
///   - `button-name`（critical，登入頁）：icon-only 的送出鈕沒有可讀名稱，
///     螢幕閱讀器唸出來只有「按鈕」。
// ⚠️ 不用 Record<string, number> —— noUncheckedIndexedAccess 會把讀出來的值
// 變成 `number | undefined`，而那正是這個設定該做的事。用字面型別就沒有這問題。
const KNOWN_ISSUES = {
  login: 0,
  desktop: 0,
} as const;

async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
}

function summarise(violations: Awaited<ReturnType<typeof scan>>["violations"]) {
  return violations
    .filter((v) => BLOCKING.includes(v.impact ?? ""))
    .map(
      (v) =>
        `  [${v.impact}] ${v.id}: ${v.help}\n    ${v.nodes.length} 個節點，第一個：${v.nodes[0]?.target.join(" ")}`,
    )
    .join("\n");
}

test("登入畫面的可及性沒有比現況更差", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder("Username")).toBeVisible();

  const { violations } = await scan(page);
  const blocking = violations.filter((v) => BLOCKING.includes(v.impact ?? ""));

  expect(
    blocking.length,
    `登入畫面的 serious/critical 違規：\n${summarise(violations)}`,
  ).toBeLessThanOrEqual(KNOWN_ISSUES.login);
});

test("桌面版面的可及性沒有比現況更差", async ({ page }) => {
  await registerAndLogin(page, "a11y");

  const { violations } = await scan(page);
  const blocking = violations.filter((v) => BLOCKING.includes(v.impact ?? ""));

  expect(
    blocking.length,
    `桌面版面的 serious/critical 違規：\n${summarise(violations)}`,
  ).toBeLessThanOrEqual(KNOWN_ISSUES.desktop);
});

/**
 * Dock 是這個桌面的主要導覽，而它原本每一顆圖示都是帶 `onClick` 的裸 `<div>`
 * —— 鍵盤到不了、讀螢幕的人也看不到。axe 沒抓到（「div 上掛 onClick」不在它的
 * 規則裡），所以這條要自己寫：每一顆都要是有名字、按得到的按鈕。
 */
test("Dock 的每一顆圖示都可以用鍵盤到達，而且有名字", async ({ page }) => {
  await registerAndLogin(page, "dock");

  const icons = page.locator('[data-context-type="dock-icon"]');
  // ⚠️ 要先等它出現再數。`registerAndLogin` 只等到登入表單消失，桌面還在掛載中
  // —— 本機夠快所以看不出來，CI 上 count() 會拿到 0（第一次就是這樣紅的）。
  await expect(icons.first()).toBeVisible({ timeout: 15_000 });
  const count = await icons.count();

  for (let i = 0; i < count; i++) {
    const icon = icons.nth(i);
    await expect(icon).toHaveRole("button");
    await expect(icon).toHaveAttribute("aria-label", /.+/);
  }

  // 鍵盤真的到得了：聚焦第一顆之後按 Enter 會開起一個視窗。
  await icons.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-context-type="window-title"]').first()).toBeVisible({
    timeout: 15_000,
  });
});
