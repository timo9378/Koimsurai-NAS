import { beforeEach, describe, expect, it } from "vitest";

import { type UploadTask, useUploadStore } from "./upload-store";

const task = (id: string, over: Partial<UploadTask> = {}): UploadTask => ({
  id,
  file: new File([], `${id}.txt`),
  path: "/",
  progress: 100,
  status: "completed",
  ...over,
});

describe("clearCompleted", () => {
  beforeEach(() => {
    useUploadStore.setState({ tasks: {} });
  });

  it("清掉一般的已完成", () => {
    useUploadStore.setState({ tasks: { a: task("a") } });
    useUploadStore.getState().clearCompleted();
    expect(useUploadStore.getState().tasks).toEqual({});
  });

  // 這條是這次改動的理由。
  it("留下有警告的已完成 —— 那正是使用者需要看到的", () => {
    useUploadStore.setState({
      tasks: { ok: task("ok"), warn: task("warn", { warning: "空檔案（0 bytes）" }) },
    });
    useUploadStore.getState().clearCompleted();
    expect(Object.keys(useUploadStore.getState().tasks)).toEqual(["warn"]);
  });

  it("不碰上傳中與失敗的", () => {
    useUploadStore.setState({
      tasks: {
        up: task("up", { status: "uploading", progress: 40 }),
        err: task("err", { status: "error", error: "x" }),
      },
    });
    useUploadStore.getState().clearCompleted();
    expect(Object.keys(useUploadStore.getState().tasks).sort()).toEqual(["err", "up"]);
  });

  it("逐筆移除仍然移得掉有警告的", () => {
    useUploadStore.setState({ tasks: { warn: task("warn", { warning: "空檔案" }) } });
    useUploadStore.getState().removeTask("warn");
    expect(useUploadStore.getState().tasks).toEqual({});
  });
});
