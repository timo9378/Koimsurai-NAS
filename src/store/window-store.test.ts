import { beforeEach, describe, expect, it } from "vitest";
import { APP_TYPES, isAppType, useWindowStore, type AppType } from "./window-store";

/**
 * 視窗管理是整個桌面的核心狀態，而它的規則散在 openWindow 裡不太顯眼：
 * 哪些 app 可以開多個、哪些只能有一個、關掉再開會不會記得上次的位置。
 * 這裡把那些規則釘住。
 */

const reset = () =>
  useWindowStore.setState({
    windows: [],
    activeWindowId: null,
    nextZIndex: 1,
    windowHistory: {},
    showDesktop: false,
  });

const s = () => useWindowStore.getState();

beforeEach(reset);

describe("isAppType", () => {
  it("認得所有 AppType", () => {
    for (const t of APP_TYPES) expect(isAppType(t)).toBe(true);
  });

  it("擋掉不是 AppType 的字串", () => {
    // ⚠️ 這個 guard 的存在意義：targetId 來自 DOM 的 data-context-id，
    //    也可能是 windowId（uuid）而不是 app 名稱。以前是 `as any` 硬轉。
    expect(isAppType("6f3a2d5e-0000-4000-8000-000000000000")).toBe(false);
    expect(isAppType("")).toBe(false);
    expect(isAppType("Finder")).toBe(false); // 大小寫敏感
  });

  it("APP_TYPES 與 AppType 是同一份來源，不會走鐘", () => {
    // 這行本身就是斷言：如果有人手動改了聯集卻沒改陣列，這裡編不過。
    const all: readonly AppType[] = APP_TYPES;
    expect(all.length).toBeGreaterThan(0);
  });
});

describe("openWindow", () => {
  it("單例 app 重複開只會聚焦既有視窗，不會再開一個", () => {
    s().openWindow("settings");
    const firstId = s().windows[0]?.id;
    s().openWindow("settings");

    expect(s().windows).toHaveLength(1);
    expect(s().activeWindowId).toBe(firstId);
  });

  it("多實例 app（finder / terminal / preview / photos）每次都開新的", () => {
    s().openWindow("finder");
    s().openWindow("finder");
    expect(s().windows).toHaveLength(2);
    expect(s().windows[0]?.id).not.toBe(s().windows[1]?.id);
  });

  it("props 跟著 appType 一起存下來，供 WindowContent 依 appType 收窄後取用", () => {
    s().openWindow("terminal", "Terminal - web", { containerId: "abc123" });
    const w = s().windows[0];
    expect(w?.appType).toBe("terminal");
    expect(w?.appType === "terminal" ? w.props?.containerId : undefined).toBe("abc123");
  });

  it("沒給標題就用 app 名稱首字大寫", () => {
    s().openWindow("dashboard");
    expect(s().windows[0]?.title).toBe("Dashboard");
  });

  it("開窗會取消「顯示桌面」狀態", () => {
    useWindowStore.setState({ showDesktop: true });
    s().openWindow("settings");
    expect(s().showDesktop).toBe(false);
  });

  it("新視窗疊在最上層", () => {
    s().openWindow("settings");
    s().openWindow("docker");
    const [settings, docker] = s().windows;
    expect(docker?.zIndex).toBeGreaterThan(settings?.zIndex ?? 0);
    expect(s().activeWindowId).toBe(docker?.id);
  });
});

describe("closeWindow / focusWindow", () => {
  it("關掉視窗會把位置與大小記進 windowHistory，下次開同一個 app 沿用", () => {
    s().openWindow("settings");
    const id = s().windows[0]!.id;
    s().updateWindowPosition(id, { x: 321, y: 123 });
    s().updateWindowSize(id, { width: 654, height: 456 });
    s().closeWindow(id);

    s().openWindow("settings");
    expect(s().windows[0]?.position).toEqual({ x: 321, y: 123 });
    expect(s().windows[0]?.size).toEqual({ width: 654, height: 456 });
  });

  it("聚焦會把該視窗提到最上層", () => {
    s().openWindow("finder");
    s().openWindow("finder");
    const first = s().windows[0]!;
    s().focusWindow(first.id);

    const refreshed = s().windows.find((w) => w.id === first.id)!;
    const other = s().windows.find((w) => w.id !== first.id)!;
    expect(refreshed.zIndex).toBeGreaterThan(other.zIndex);
    expect(s().activeWindowId).toBe(first.id);
  });
});

describe("toggleShowDesktop", () => {
  it("只還原「是被顯示桌面縮小的」那些，使用者自己縮小的維持縮小", () => {
    s().openWindow("settings");
    s().openWindow("docker");
    const [settings, docker] = s().windows;
    s().minimizeWindow(settings!.id); // 使用者自己縮的

    s().toggleShowDesktop();
    expect(s().windows.every((w) => w.isMinimized)).toBe(true);

    s().toggleShowDesktop();
    const after = Object.fromEntries(s().windows.map((w) => [w.id, w.isMinimized]));
    expect(after[docker!.id]).toBe(false);
    // ⚠️ 這條是重點：還原時不能把使用者原本就縮小的一起打開。
    expect(after[settings!.id]).toBe(true);
  });
});
