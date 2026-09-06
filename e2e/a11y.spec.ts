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

/**
 * 等到 CSS transition 都跑完再掃。
 *
 * ⚠️ 少了這個，色彩對比的結果是**不穩定的**。這個 UI 到處都是
 * `transition-all duration-150`，而 axe 量的是「當下那一格畫面」的顏色——
 * 掃在補間中間的話，量到的是一個根本不存在於任何靜止狀態的顏色。
 * 實際遇到的：Calculator 同一份程式碼一輪紅、下一輪綠。
 *
 * 只等 transition，不等 animation —— `animate-spin` 那種是無限迴圈，等不完。
 */
async function settleTransitions(page: Page) {
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .filter((a) => a instanceof CSSTransition)
        .every((a) => a.playState !== "running"),
    undefined,
    { timeout: 10_000 },
  );
}

async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
}

function summarise(violations: Awaited<ReturnType<typeof scan>>["violations"]) {
  return violations
    .filter((v) => BLOCKING.includes(v.impact ?? ""))
    .map((v) => {
      // ⚠️ 一定要印 `failureSummary`。只印選擇器的話，看到
      // 「.bg-blue-600 > .flex-1 對比不足」只能自己去算顏色 —— 而 Tailwind v4
      // 的色階是 OKLCH，跟 v3 的十六進位值不一樣，憑印象算一定錯。
      // axe 會直接告訴你它量到的前景色、背景色與比值。
      const nodes = v.nodes
        .slice(0, 5)
        .map(
          (n) =>
            `      ${n.target.join(" ")}\n        ${n.failureSummary?.split("\n").join("\n        ")}`,
        )
        .join("\n");
      const more = v.nodes.length > 5 ? `\n      …另外還有 ${v.nodes.length - 5} 個` : "";
      return `  [${v.impact}] ${v.id}: ${v.help}（${v.nodes.length} 個節點）\n${nodes}${more}`;
    })
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

/**
 * 每一個 app 視窗自己也要掃。
 *
 * 上面兩條掃的是登入頁和「空桌面」—— 而這個系統幾乎所有 UI 都活在視窗裡，
 * 所以那兩條掃過等於什麼都沒掃到。使用者說「還是有一些 UI 問題沒修到」，
 * 這就是那個洞。
 */
const DOCK_APPS = [
  "Finder",
  "Launchpad",
  "Dashboard",
  "Photos",
  "Docker",
  "Terminal",
  "Calculator",
  "Settings",
  "Trash",
] as const;

/**
 * Dock 上點下去之後，那個 app 的 UI 會出現在哪裡。
 *
 * ⚠️ Settings 是特例：它在 Dock 上開的是一個 popover，**不是視窗**
 * （見 Dock.tsx 的 `Popover.Root`）。第一版把它當成視窗等，結果紅在
 * 「element(s) not found」—— 那是測試寫錯，不是產品壞掉。
 */
const SURFACE: Record<(typeof DOCK_APPS)[number], string> = {
  Finder: "[data-window-frame]",
  Launchpad: "[data-window-frame]",
  Dashboard: "[data-window-frame]",
  Photos: "[data-window-frame]",
  Docker: "[data-window-frame]",
  Terminal: "[data-window-frame]",
  Calculator: "[data-window-frame]",
  Settings: "[data-dock-settings]",
  Trash: "[data-window-frame]",
};

/**
 * 每個 app 目前已知、還沒修的 serious/critical 數量（棘輪上限）。
 * 加新 app 的時候這裡會被下面那條測試逼著補上。
 */
const WINDOW_ISSUES: Record<(typeof DOCK_APPS)[number], number> = {
  Finder: 0,
  Launchpad: 0,
  Dashboard: 0,
  Photos: 0,
  Docker: 0,
  Terminal: 0,
  Calculator: 0,
  Settings: 0,
  Trash: 0,
};

/**
 * 這條是「補全」的那把鎖：新增一個 Dock app 卻沒加進 DOCK_APPS，
 * 這裡就會紅。否則上面那一串會慢慢過期，而且沒有人會發現。
 */
test("DOCK_APPS 涵蓋 Dock 上的每一個 app", async ({ page }) => {
  await registerAndLogin(page, "a11ylist");

  const icons = page.locator('[data-context-type="dock-icon"]');
  await expect(icons.first()).toBeVisible({ timeout: 15_000 });

  const labels = await icons.evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? ""),
  );
  expect([...labels].sort()).toEqual([...DOCK_APPS].sort());
});

for (const app of DOCK_APPS) {
  test(`${app} 的可及性沒有比現況更差`, async ({ page }) => {
    await registerAndLogin(page, "a11ywin");

    const surface = SURFACE[app];

    await page.getByRole("button", { name: app, exact: true }).click();
    // UI 要真的畫出來才有東西可以掃。
    await expect(page.locator(surface).first()).toBeVisible({ timeout: 15_000 });
    // 內容多半是非同步載的（檔案列表、容器列表、系統指標）。等到不再有
    // 載入中的骨架，掃到的才是使用者真正看到的畫面。
    await expect(page.locator(`${surface} .animate-spin`)).toHaveCount(0, { timeout: 20_000 });
    await settleTransitions(page);

    const { violations } = await new AxeBuilder({ page })
      .include(surface)
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = violations.filter((v) => BLOCKING.includes(v.impact ?? ""));

    expect(
      blocking.length,
      `${app} 的 serious/critical 違規：\n${summarise(violations)}`,
    ).toBeLessThanOrEqual(WINDOW_ISSUES[app]);
  });
}
