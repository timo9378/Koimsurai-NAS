import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { AxiosError } from "axios";
import { createFolderWithUniqueName, pickAvailableName } from "./new-folder";

type CreateMock = Mock<(name: string) => Promise<unknown>>;
const names = (create: CreateMock) => create.mock.calls.map(([name]) => name);

const conflict = () =>
  new AxiosError("conflict", undefined, undefined, undefined, {
    status: 409,
    data: {},
    statusText: "Conflict",
    headers: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: {} as never,
  });

describe("pickAvailableName", () => {
  it("沒撞名就用 base 本身，序號停在 1", () => {
    expect(pickAvailableName("新資料夾", ["a", "b"])).toEqual({ name: "新資料夾", counter: 1 });
  });

  it("撞名就一路往後找", () => {
    expect(pickAvailableName("新資料夾", ["新資料夾", "新資料夾1"])).toEqual({
      name: "新資料夾2",
      counter: 3,
    });
  });

  it("回傳的 counter 是下一個沒試過的序號，不是已用掉的那個", () => {
    // 這條是 409 重試能不能接得上的關鍵：從 counter 接下去要拿到「新資料夾2」，
    // 而不是把剛剛已經確認被佔用的「新資料夾1」再試一次。
    const { name, counter } = pickAvailableName("新資料夾", ["新資料夾"]);
    expect(name).toBe("新資料夾1");
    expect(`新資料夾${counter}`).toBe("新資料夾2");
  });

  it("中間有空缺就填空缺", () => {
    expect(pickAvailableName("f", ["f", "f2"]).name).toBe("f1");
  });
});

describe("createFolderWithUniqueName", () => {
  it("一次就成功時回傳挑到的名字", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    await expect(createFolderWithUniqueName({ existing: [], create })).resolves.toBe("新資料夾");
    expect(create).toHaveBeenCalledExactlyOnceWith("新資料夾");
  });

  it("409 之後換下一個名字再試，而不是重試同一個", async () => {
    const create = vi.fn().mockRejectedValueOnce(conflict()).mockResolvedValue(undefined);
    await expect(createFolderWithUniqueName({ existing: [], create })).resolves.toBe("新資料夾1");
    expect(names(create)).toEqual(["新資料夾", "新資料夾1"]);
  });

  it("清單過期時連續 409 也能收斂", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockResolvedValue(undefined);
    await expect(createFolderWithUniqueName({ existing: ["新資料夾"], create })).resolves.toBe(
      "新資料夾3",
    );
    // 每次 409 都往後跳一號，不會回頭重試已經確認被佔用的名字。
    expect(names(create)).toEqual(["新資料夾1", "新資料夾2", "新資料夾3"]);
  });

  it("不是 409 的錯誤直接往外丟，不要重試十次", async () => {
    const create = vi.fn().mockRejectedValue(new Error("網路斷了"));
    await expect(createFolderWithUniqueName({ existing: [], create })).rejects.toThrow("網路斷了");
    expect(create).toHaveBeenCalledOnce();
  });

  it("一直 409 就在 maxAttempts 次之後放棄", async () => {
    const create = vi.fn().mockRejectedValue(conflict());
    await expect(
      createFolderWithUniqueName({ existing: [], create, maxAttempts: 3 }),
    ).rejects.toThrow("無法創建資料夾");
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("base 可以換掉（桌面用的是同一個字串，但不該由這個模組寫死）", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    await expect(createFolderWithUniqueName({ existing: ["X"], create, base: "X" })).resolves.toBe(
      "X1",
    );
  });
});
