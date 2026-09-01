/**
 * 稽核紀錄的動作 → 顯示樣式。
 *
 * ⚠️ 這份表原本與後端**對不上兩邊**：有三個後端從來不會產生的動作
 * （`create_file`、`upload_file`、`move_file`），而後端真正會寫的
 * `restore_version` 反而沒有。補完之後再核對過一次。
 *
 * 認不得的動作**不是錯誤** —— 後端新增一種動作時不該讓畫面壞掉，
 * 所以退回把底線換成空白的原字串。那比顯示「未知」有用得多。
 */
export type AuditTone = "neutral" | "create" | "destructive" | "warning";

export interface AuditActionInfo {
  readonly label: string;
  readonly tone: AuditTone;
}

const ACTIONS: Record<string, AuditActionInfo> = {
  create_folder: { label: "Create Folder", tone: "create" },
  upload_file: { label: "Upload", tone: "create" },
  rename_file: { label: "Rename", tone: "warning" },
  batch_move: { label: "Move", tone: "warning" },
  batch_copy: { label: "Copy", tone: "create" },
  restore_version: { label: "Restore Version", tone: "warning" },
  restore_from_trash: { label: "Restore", tone: "warning" },
  delete_file: { label: "Move to Trash", tone: "destructive" },
  batch_delete: { label: "Move to Trash", tone: "destructive" },
  permanent_delete: { label: "Delete Permanently", tone: "destructive" },
  empty_trash: { label: "Empty Trash", tone: "destructive" },
};

export function auditActionInfo(action: string): AuditActionInfo {
  return ACTIONS[action] ?? { label: action.replace(/_/g, " "), tone: "neutral" };
}

export const TONE_CLASS: Record<AuditTone, string> = {
  neutral: "bg-blue-500/20 text-blue-600",
  create: "bg-green-500/20 text-green-600",
  warning: "bg-amber-500/20 text-amber-600",
  destructive: "bg-red-500/20 text-red-600",
};
