import {
  Download,
  Edit2,
  Info,
  RefreshCw,
  Share2,
  Star,
  StarOff,
  Trash2,
  type LucideIcon,
} from "lucide-react";

/** 動作面板的一個項目。`id` 是 `handleAction` 的 switch 值。 */
export interface SheetAction {
  id: string;
  label: string;
  icon: LucideIcon;
  danger?: boolean;
}

/**
 * 動作面板要顯示哪些項目。
 *
 * ⚠️ 這份清單抽出來是為了能測。原本寫在元件裡，於是「資料夾也被提供
 * Download」這種錯沒有任何東西擋得住 —— 後端的 `download_file` 要求
 * `is_file()`，資料夾一律 404，而列表上的「⋮」對資料夾也會開這個面板。
 *
 * 垃圾桶模式只有還原與永久刪除：其餘操作（分享、重新命名、加星號）對
 * 垃圾桶裡的項目都沒有意義，而且路徑也對不上（垃圾桶用的是扁平檔名）。
 */
export function sheetActions(
  file: { is_dir: boolean; is_starred: boolean },
  isTrash: boolean,
): SheetAction[] {
  if (isTrash) {
    return [
      { id: "restore", label: "Restore", icon: RefreshCw },
      { id: "delete-permanent", label: "Delete Permanently", icon: Trash2, danger: true },
    ];
  }

  return [
    ...(file.is_dir ? [] : [{ id: "download", label: "Download", icon: Download }]),
    { id: "share", label: "Share", icon: Share2 },
    { id: "rename", label: "Rename", icon: Edit2 },
    file.is_starred
      ? { id: "unstar", label: "Remove from Favorites", icon: StarOff }
      : { id: "star", label: "Add to Favorites", icon: Star },
    { id: "info", label: "File Info", icon: Info },
    { id: "delete", label: "Move to Trash", icon: Trash2, danger: true },
  ];
}
