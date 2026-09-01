import { describe, expect, it } from "vitest";
import { AxiosError } from "axios";
import { backoffInterval } from "./polling";

const q = (error: unknown) => ({ state: { error } });
const httpError = (status: number) =>
  new AxiosError("boom", undefined, undefined, undefined, {
    status,
    data: {},
    statusText: "",
    headers: {},
    config: {} as never,
  });

describe("backoffInterval", () => {
  it("沒出錯就是原本的節奏", () => {
    expect(backoffInterval(3000)(q(null))).toBe(3000);
    expect(backoffInterval(10_000)(q(undefined))).toBe(10_000);
  });

  it("403 完全停止 —— 權限不會在這個 session 裡自己好", () => {
    expect(backoffInterval(3000)(q(httpError(403)))).toBe(false);
  });

  it("其他錯誤放慢而不是停止 —— 後端重啟會自己好", () => {
    expect(backoffInterval(3000)(q(httpError(500)))).toBe(30_000);
    expect(backoffInterval(3000)(q(httpError(503)))).toBe(30_000);
  });

  it("網路層的錯誤（沒有狀態碼）也是放慢", () => {
    expect(backoffInterval(3000)(q(new Error("Network Error")))).toBe(30_000);
  });

  it("慢速間隔可以指定", () => {
    expect(backoffInterval(1000, 60_000)(q(httpError(500)))).toBe(60_000);
  });
});
