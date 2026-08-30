import { describe, expect, it } from "vitest";
import { getFileIconConfig } from "./file-icons";

/**
 * 圖示對應的解析順序：資料夾 → 副檔名 → 完整 MIME → MIME 主類型 → 預設。
 * 這個順序有意義（副檔名比伺服器猜的 MIME 準），所以每一段都釘住。
 */

/** 兩個 config 是不是同一個圖示。 */
const sameIcon = (a: { icon: unknown }, b: { icon: unknown }) => a.icon === b.icon;

describe("getFileIconConfig", () => {
  it("資料夾優先於一切 —— 就算名字帶副檔名", () => {
    const folder = getFileIconConfig("v1.2.3", true);
    const notFolder = getFileIconConfig("v1.2.3", false);
    expect(sameIcon(folder, notFolder)).toBe(false);
  });

  it("副檔名大小寫不影響結果", () => {
    // ⚠️ 這條是真的踩過：曾經有處判斷寫成 `endsWith(".m3u8")`，
    //    大寫的 .M3U8 就整個漏掉。這裡的解析是先 toLowerCase 才查表。
    expect(sameIcon(getFileIconConfig("A.PDF", false), getFileIconConfig("a.pdf", false))).toBe(
      true,
    );
    expect(
      sameIcon(getFileIconConfig("VIDEO.MP4", false), getFileIconConfig("video.mp4", false)),
    ).toBe(true);
  });

  it("副檔名優先於 MIME —— 伺服器猜的 MIME 常常是錯的", () => {
    const byExt = getFileIconConfig("報告.pdf", false, "application/octet-stream");
    expect(sameIcon(byExt, getFileIconConfig("報告.pdf", false))).toBe(true);
  });

  it("沒有副檔名時用完整 MIME", () => {
    const byMime = getFileIconConfig("README", false, "application/pdf");
    expect(sameIcon(byMime, getFileIconConfig("x.pdf", false))).toBe(true);
  });

  it("完整 MIME 對不到就退到主類型（image/* 這種）", () => {
    const exotic = getFileIconConfig("photo", false, "image/avif");
    const plain = getFileIconConfig("photo", false, "image/png");
    expect(sameIcon(exotic, plain)).toBe(true);
  });

  it("以點開頭的檔名不算副檔名（.gitignore 不是 gitignore 類型）", () => {
    expect(
      sameIcon(getFileIconConfig(".env", false), getFileIconConfig("no-extension", false)),
    ).toBe(true);
  });

  it("完全認不出來時回預設圖示，不會爆炸", () => {
    expect(getFileIconConfig("", false)).toBeDefined();
    expect(getFileIconConfig("x.這不是副檔名", false, "什麼/都不是")).toBeDefined();
  });
});
