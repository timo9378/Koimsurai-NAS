/**
 * 上傳「成功」但使用者必須注意的情況。回傳要顯示的警告；沒事回 `undefined`。
 *
 * 真實事件（2026-09-08）：從記憶卡選的 11 支 GoPro 影片，瀏覽器讀到的大小是 0
 * （選檔時來源讀不到）。前端的分流是「> 1 MB 走 tus、其餘走 multipart」，於是它們
 * 走 multipart、後端寫出 0 bytes 的檔案、面板給**綠勾** —— 使用者完全不會知道那些
 * 影片根本沒上傳，而其中兩支到最後都沒有任何一份好的副本。
 *
 * ⚠️ 不擋、照傳。空檔案本身是合法的（`.gitkeep`、佔位檔），擋掉就是替使用者決定
 * 什麼檔案不准存。這裡只負責「不要假裝一切正常」。
 */
export function uploadWarning(file: Pick<File, "size">): string | undefined {
  return file.size === 0 ? EMPTY_FILE_WARNING : undefined;
}

export const EMPTY_FILE_WARNING =
  "空檔案（0 bytes）：若原本應該有內容，可能是來源讀取失敗（記憶卡、雲端同步中的佔位檔），請確認後重傳。";
