/**
 * Office 檔案的分類。
 *
 * 這裡刻意**不**用 mime_type：後端是靠副檔名猜 mime 的，而且 `.docx` 常常
 * 被猜成 `application/zip`（它本來就是一個 zip）。副檔名反而是比較可靠的來源。
 *
 * ⚠️ `.doc` / `.xls` / `.ppt` 跟 `.docx` / `.xlsx` / `.pptx` **不是同一種東西**。
 * 前者是 OLE2 複合二進位檔（Office 97-2003），後者是 OOXML（zip + XML）。
 * docx-preview 和 exceljs 都只讀 OOXML —— 把 `.doc` 丟進去不會報「不支援」，
 * 會炸在解 zip 的地方。所以 legacy 要單獨分出來，訊息才不會騙人。
 */
export type OfficeKind = "docx" | "xlsx" | "pptx" | "legacy";

const OOXML: Record<string, OfficeKind> = {
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
};

/** Office 97-2003 的二進位格式，瀏覽器端沒有可用的解析器。 */
const LEGACY = new Set(["doc", "xls", "ppt"]);

/** 不是 Office 檔就回傳 null。 */
export function officeKind(name: string): OfficeKind | null {
  const ext = name.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  if (LEGACY.has(ext)) return "legacy";
  return OOXML[ext] ?? null;
}

/** 這個類型有沒有辦法在瀏覽器裡算出畫面。 */
export function isRenderable(kind: OfficeKind | null): kind is "docx" | "xlsx" {
  return kind === "docx" || kind === "xlsx";
}

/**
 * 不能預覽時要對使用者說的話。分開寫是因為三個原因**不一樣**，
 * 之前那句「目前不支援直接預覽 Office 文件」對三種情況講同一句話，
 * 使用者沒辦法知道下一步該做什麼（轉檔？還是根本沒救？）。
 */
export function unsupportedReason(kind: OfficeKind): string | null {
  switch (kind) {
    case "pptx":
      return "簡報還不能預覽，請下載後開啟。";
    case "legacy":
      return "這是 Office 97-2003 的舊格式，瀏覽器無法解析。另存成 .docx / .xlsx 之後就能預覽。";
    default:
      return null;
  }
}
