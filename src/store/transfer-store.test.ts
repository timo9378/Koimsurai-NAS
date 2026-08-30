import { beforeEach, describe, expect, it } from "vitest";
import { formatSpeed, useTransferStore, type TransferTask } from "./transfer-store";

/**
 * 傳輸清單的狀態機。這裡特別在意 `clearCompleted`：它是用
 * `Object.keys(...).forEach` 邊走邊 delete，很容易寫成對已刪除的 key 取值。
 */

const s = () => useTransferStore.getState();

type NewTask = Omit<TransferTask, "speed" | "startTime" | "bytesTransferred">;

const addTask = (id: string, over: Partial<NewTask> = {}) =>
  s().addTask({
    id,
    name: `${id}.bin`,
    type: "upload",
    size: 1000,
    progress: 0,
    status: "pending",
    ...over,
  });

beforeEach(() => {
  useTransferStore.setState({ tasks: {}, uploadSpeed: 0, downloadSpeed: 0 });
});

describe("clearCompleted", () => {
  it("只清掉 completed，其他狀態留著", () => {
    addTask("a", { status: "completed" });
    addTask("b", { status: "active" });
    addTask("c", { status: "error" });
    addTask("d", { status: "pending" });

    s().clearCompleted();

    expect(Object.keys(s().tasks).sort()).toEqual(["b", "c", "d"]);
  });

  it("全部都是 completed 也不會爆炸", () => {
    addTask("a", { status: "completed" });
    addTask("b", { status: "completed" });
    s().clearCompleted();
    expect(s().tasks).toEqual({});
  });

  it("空清單呼叫是 no-op", () => {
    expect(() => s().clearCompleted()).not.toThrow();
    expect(s().tasks).toEqual({});
  });
});

describe("速度統計", () => {
  it("只累計 active 的任務，並依上傳/下載分開", () => {
    addTask("up", { status: "active", type: "upload" });
    addTask("down", { status: "active", type: "download" });
    addTask("done", { status: "completed", type: "upload" });

    // addTask 進來時 speed 是 0，用 updateTask 直接給值
    s().updateTask("up", { speed: 100 });
    s().updateTask("down", { speed: 250 });
    s().updateTask("done", { speed: 999 });

    expect(s().uploadSpeed).toBe(100);
    expect(s().downloadSpeed).toBe(250);
  });

  it("任務移除後速度要跟著歸零，不會留下幽靈數字", () => {
    addTask("up", { status: "active", type: "upload" });
    s().updateTask("up", { speed: 100 });
    expect(s().uploadSpeed).toBe(100);

    s().removeTask("up");
    expect(s().uploadSpeed).toBe(0);
  });
});

describe("formatSpeed", () => {
  it.each([
    [0, "0 B/s"],
    [512, "512.0 B/s"],
  ])("%i → %s", (input, expected) => {
    expect(formatSpeed(input)).toBe(expected);
  });

  it("大於 1 KB 時換單位", () => {
    expect(formatSpeed(2048)).toMatch(/KB\/s$/);
    expect(formatSpeed(5 * 1024 * 1024)).toMatch(/MB\/s$/);
  });
});
