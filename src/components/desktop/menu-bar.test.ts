import { describe, expect, it } from "vitest";
import { getMenuItemsForApp, type MenuItem } from "./menu-bar";

const APPS = ["finder", "photos", "terminal", "docker", null] as const;

const allItems = (appType: string | null): MenuItem[] =>
  getMenuItemsForApp(appType).menus.flatMap((menu) => menu.items);

describe("getMenuItemsForApp", () => {
  it("每個 app 都有名字與至少一個選單", () => {
    for (const appType of APPS) {
      const config = getMenuItemsForApp(appType);
      expect(config.appName.length).toBeGreaterThan(0);
      expect(config.menus.length).toBeGreaterThan(0);
    }
  });

  it("不認得的 appType 退回桌面選單，不是空的", () => {
    expect(getMenuItemsForApp("calculator").appName).toBe("Desktop");
    expect(getMenuItemsForApp(null).appName).toBe("Desktop");
  });

  it("每個選單裡的項目名稱不重複", () => {
    for (const appType of APPS) {
      for (const menu of getMenuItemsForApp(appType).menus) {
        const labels = menu.items.map((i) => i.label);
        expect(new Set(labels).size, `${String(appType)} / ${menu.label}`).toBe(labels.length);
      }
    }
  });

  it("Finder 的導覽整組都能用 —— 這是選單列最實際的用途", () => {
    const go = getMenuItemsForApp("finder").menus.find((m) => m.label === "Go");
    expect(go?.items.every((i) => i.command !== undefined)).toBe(true);
  });

  it("送給 app 的指令只會出現在有視窗的 app 上", () => {
    // 桌面沒有「作用中的視窗」可以收指令，所以它的項目不能是 kind: "app"。
    expect(allItems(null).some((i) => i.command?.kind === "app")).toBe(false);
  });

  it("Docker 的容器操作沒有實作，必須是灰的", () => {
    // 「按了什麼都沒發生」對 Stop／Remove 這種操作是最糟的一種回饋 ——
    // 使用者會以為指令送出去了。
    const container = getMenuItemsForApp("docker").menus.find((m) => m.label === "Container");
    expect(container?.items.map((i) => i.label)).toEqual(["Start", "Stop", "Restart", "Remove"]);
    expect(container?.items.every((i) => i.command === undefined)).toBe(true);
  });

  it("Terminal 的 Close Tab 是送給 app 的指令，不是關視窗", () => {
    // ⚠️ 第一版接成 `{ kind: "close" }` —— 那會把整個終端機關掉。
    // 「按了做出比預期更大的事」比「按了沒反應」更糟。
    const shell = getMenuItemsForApp("terminal").menus.find((m) => m.label === "Shell");
    const closeTab = shell?.items.find((i) => i.label === "Close Tab");
    expect(closeTab?.command).toEqual({ kind: "app", command: "close-tab" });

    // Finder 的 Close Window 才是真的關視窗。
    const file = getMenuItemsForApp("finder").menus.find((m) => m.label === "File");
    expect(file?.items.find((i) => i.label === "Close Window")?.command).toEqual({ kind: "close" });
  });

  it("有 command 的項目，command 的形狀是完整的", () => {
    for (const appType of APPS) {
      for (const item of allItems(appType)) {
        if (!item.command) continue;
        switch (item.command.kind) {
          case "app":
            expect(item.command.command.length).toBeGreaterThan(0);
            break;
          case "open":
            expect(item.command.appType.length).toBeGreaterThan(0);
            break;
          case "event":
            expect(item.command.event.length).toBeGreaterThan(0);
            break;
          case "close":
            break;
        }
      }
    }
  });
});
