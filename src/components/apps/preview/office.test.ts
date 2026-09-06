import { describe, expect, it } from "vitest";

import { isRenderable, officeKind, unsupportedReason } from "./office";

describe("officeKind", () => {
  it("認得 OOXML 三種", () => {
    expect(officeKind("報告.docx")).toBe("docx");
    expect(officeKind("帳目.xlsx")).toBe("xlsx");
    expect(officeKind("簡報.pptx")).toBe("pptx");
  });

  // 這是這個模組存在的理由。舊的判斷式是 /\.(docx?|xlsx?|pptx?)$/i，
  // 它把 .doc 和 .docx 當成同一種 —— 而 .doc 丟給 docx-preview 會炸在解 zip，
  // 不會走到「不支援」的分支。
  it("把 Office 97-2003 的舊格式跟 OOXML 分開", () => {
    expect(officeKind("舊檔.doc")).toBe("legacy");
    expect(officeKind("舊表.xls")).toBe("legacy");
    expect(officeKind("舊簡報.ppt")).toBe("legacy");
  });

  it("大小寫不影響", () => {
    expect(officeKind("A.DOCX")).toBe("docx");
    expect(officeKind("A.Xls")).toBe("legacy");
  });

  it("不是 Office 檔就回 null", () => {
    expect(officeKind("a.pdf")).toBeNull();
    expect(officeKind("a.txt")).toBeNull();
    expect(officeKind("沒有副檔名")).toBeNull();
    expect(officeKind("")).toBeNull();
  });

  // 「.docx」開頭是點、split 之後第一段是空字串 —— 不能誤判成 docx 以外的東西。
  it("純副檔名的檔名（.docx）也算 docx", () => {
    expect(officeKind(".docx")).toBe("docx");
  });

  it("只看最後一段副檔名", () => {
    expect(officeKind("report.xlsx.txt")).toBeNull();
    expect(officeKind("report.txt.xlsx")).toBe("xlsx");
  });
});

describe("isRenderable", () => {
  it("只有 docx 和 xlsx 畫得出來", () => {
    expect(isRenderable("docx")).toBe(true);
    expect(isRenderable("xlsx")).toBe(true);
    expect(isRenderable("pptx")).toBe(false);
    expect(isRenderable("legacy")).toBe(false);
    expect(isRenderable(null)).toBe(false);
  });
});

describe("unsupportedReason", () => {
  // 三種情況要講三句不一樣的話，使用者才知道下一步。
  it("pptx 和 legacy 的說法不一樣", () => {
    const pptx = unsupportedReason("pptx");
    const legacy = unsupportedReason("legacy");
    expect(pptx).toBeTruthy();
    expect(legacy).toBeTruthy();
    expect(pptx).not.toBe(legacy);
    // legacy 要告訴使用者有救（另存新檔），不能只說「不支援」。
    expect(legacy).toContain(".docx");
  });

  it("畫得出來的類型沒有理由", () => {
    expect(unsupportedReason("docx")).toBeNull();
    expect(unsupportedReason("xlsx")).toBeNull();
  });
});
