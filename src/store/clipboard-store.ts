import { create } from "zustand";
import type { ClipboardEntry, ClipboardMode } from "@/features/files/clipboard";

/**
 * Finder 的剪貼簿。
 *
 * ⚠️ 跟系統剪貼簿無關 —— 這裡放的是「哪些檔案要被複製／搬到哪」，
 * 而 `navigator.clipboard` 放的是文字。兩者刻意不互通：把路徑寫進系統剪貼簿
 * 會讓使用者在別的地方貼出一串內部路徑。
 *
 * 只有一格（跟 Finder 一樣），複製會蓋掉上一次的內容。
 */
interface ClipboardStore {
  entry: ClipboardEntry | null;
  put: (mode: ClipboardMode, paths: string[]) => void;
  clear: () => void;
}

export const useClipboardStore = create<ClipboardStore>((set) => ({
  entry: null,
  put: (mode, paths) => set({ entry: paths.length > 0 ? { mode, paths } : null }),
  clear: () => set({ entry: null }),
}));
