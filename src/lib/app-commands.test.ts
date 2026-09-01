import { describe, expect, it, vi } from "vitest";
import { dispatchAppCommand, onAppCommand } from "./app-commands";

describe("app-commands", () => {
  it("指令只送到指定的那個視窗", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onAppCommand("win-a", a);
    const offB = onAppCommand("win-b", b);

    dispatchAppCommand("win-a", "nav-back");

    expect(a).toHaveBeenCalledExactlyOnceWith("nav-back");
    expect(b).not.toHaveBeenCalled();
    offA();
    offB();
  });

  it("同一個視窗的多個訂閱者都會收到", () => {
    const first = vi.fn();
    const second = vi.fn();
    const off1 = onAppCommand("w", first);
    const off2 = onAppCommand("w", second);

    dispatchAppCommand("w", "new-folder");

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    off1();
    off2();
  });

  it("取消訂閱之後就不再收到 —— 視窗關掉了還在聽會是洩漏", () => {
    const handler = vi.fn();
    const off = onAppCommand("w", handler);
    off();

    dispatchAppCommand("w", "nav-home");

    expect(handler).not.toHaveBeenCalled();
  });

  it("沒有 windowId 就不訂閱任何東西，也不會炸掉", () => {
    const handler = vi.fn();
    const off = onAppCommand(undefined, handler);

    dispatchAppCommand("anything", "nav-home");

    expect(handler).not.toHaveBeenCalled();
    expect(() => off()).not.toThrow();
  });

  it("沒有人訂閱時發送不會出事", () => {
    expect(() => dispatchAppCommand("nobody", "view-list")).not.toThrow();
  });
});
