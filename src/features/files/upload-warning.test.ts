import { describe, expect, it } from "vitest";

import { EMPTY_FILE_WARNING, uploadWarning } from "./upload-warning";

describe("uploadWarning", () => {
  it("0 bytes 要警告", () => {
    expect(uploadWarning({ size: 0 })).toBe(EMPTY_FILE_WARNING);
  });

  // 邊界：1 byte 已經是「有內容」。寫成 `size <= 1` 之類的錯誤會在這裡紅。
  it("1 byte 以上不警告", () => {
    expect(uploadWarning({ size: 1 })).toBeUndefined();
    expect(uploadWarning({ size: 5 * 1024 ** 3 })).toBeUndefined();
  });

  // 面板會截斷，但 E2E 與使用者都靠這幾個字辨認 —— 改文案時不能把它弄丟。
  it("訊息裡講得出「0 bytes」與「重傳」", () => {
    expect(EMPTY_FILE_WARNING).toContain("0 bytes");
    expect(EMPTY_FILE_WARNING).toContain("重傳");
  });
});
