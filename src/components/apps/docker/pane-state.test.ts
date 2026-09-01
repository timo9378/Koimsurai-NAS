import { describe, expect, it } from "vitest";
import { AxiosError } from "axios";
import { dockerPaneState } from "./pane-state";

const httpError = (status: number) =>
  new AxiosError("boom", undefined, undefined, undefined, {
    status,
    data: {},
    statusText: "",
    headers: {},
    config: {} as never,
  });

const base = { isLoading: false, error: null, connected: true, itemCount: 0 };

describe("dockerPaneState", () => {
  it("403 是「沒有權限」，不是「沒有容器」", () => {
    // production 的 DOCKER_MANAGER_USER_IDS=1,2 —— 第三個帳號會走到這裡。
    expect(dockerPaneState({ ...base, error: httpError(403) })).toEqual({ kind: "forbidden" });
  });

  it("503 是「Docker 沒連上」", () => {
    expect(dockerPaneState({ ...base, error: httpError(503) })).toEqual({ kind: "unavailable" });
  });

  it("其他錯誤保留狀態碼，不要籠統帶過", () => {
    expect(dockerPaneState({ ...base, error: httpError(500) })).toEqual({
      kind: "error",
      status: 500,
    });
  });

  it("錯誤優先於 loading —— 重試時不能把已知的失敗蓋掉", () => {
    expect(dockerPaneState({ ...base, isLoading: true, error: httpError(403) })).toEqual({
      kind: "forbidden",
    });
  });

  it("還在載入就是 loading", () => {
    expect(dockerPaneState({ ...base, isLoading: true })).toEqual({ kind: "loading" });
  });

  it("daemon 說沒連上時，空清單的原因不是「沒有容器」", () => {
    expect(dockerPaneState({ ...base, connected: false })).toEqual({ kind: "unavailable" });
  });

  it("還沒問到 connected 時不當成沒連上", () => {
    expect(dockerPaneState({ ...base, connected: undefined, itemCount: 2 })).toEqual({
      kind: "ready",
    });
  });

  it("沒有錯誤、有連上、清單是空的 —— 那才是真的沒有容器", () => {
    expect(dockerPaneState(base)).toEqual({ kind: "empty" });
  });

  it("有東西就是 ready", () => {
    expect(dockerPaneState({ ...base, itemCount: 3 })).toEqual({ kind: "ready" });
  });
});
