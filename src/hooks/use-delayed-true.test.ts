import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDelayedTrue } from "./use-delayed-true";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useDelayedTrue", () => {
  it("一開始是 false", () => {
    const { result } = renderHook(() => useDelayedTrue(true, 5000));
    expect(result.current).toBe(false);
  });

  it("維持夠久之後才變 true", () => {
    const { result } = renderHook(() => useDelayedTrue(true, 5000));

    act(() => void vi.advanceTimersByTime(4999));
    expect(result.current).toBe(false);

    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it("時間到之前就變回 false 的話，不會閃出來", () => {
    // 這正是它存在的理由：WebSocket 3 秒就自動重連，瞬斷不該閃一個「離線」。
    const { result, rerender } = renderHook(({ v }) => useDelayedTrue(v, 5000), {
      initialProps: { v: true },
    });

    act(() => void vi.advanceTimersByTime(3000));
    rerender({ v: false });
    act(() => void vi.advanceTimersByTime(10_000));

    expect(result.current).toBe(false);
  });

  it("變回 false 是立即的，不用等", () => {
    const { result, rerender } = renderHook(({ v }) => useDelayedTrue(v, 5000), {
      initialProps: { v: true },
    });
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current).toBe(true);

    rerender({ v: false });
    expect(result.current).toBe(false);
  });
});
