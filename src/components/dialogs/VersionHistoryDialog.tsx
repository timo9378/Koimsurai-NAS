"use client";

import { useState } from "react";
import { History, RotateCcw, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import type { FileVersion } from "@/types/api";
import { getApiErrorMessage } from "@/lib/errors";
import { toast } from "sonner";

interface VersionHistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  versions: FileVersion[] | undefined;
  isLoading: boolean;
  /** 還原一個版本。丟出例外就會顯示錯誤，dialog 不關。 */
  onRestore: (versionId: string) => Promise<unknown>;
}

/**
 * 檔案的版本歷史。
 *
 * ⚠️ 這個功能後端一直是完整的（`.versions/<父目錄>/<timestamp>_<檔名>`，
 * 覆寫時自動快照），前端的 `useFileVersions` / `useRestoreVersion` 也一直都在
 * —— 但**沒有任何呼叫點**。右鍵選單那個「Versions」是個沒有 onClick 的死項目，
 * 所以使用者從來看不到自己的版本，也還原不了。
 *
 * ⚠️ 補上 onClick **還不夠**：檔案的右鍵選單當時整個打不開（清單容器在右鍵時
 * 重新掛載整棵 ContextMenu 子樹，把每個檔案自己的 trigger 一起換掉）。
 * 所以「接上 UI」那次改動其實沒有真的送到 —— 我當時只寫了元件測試，
 * 而這個元件是注入式的、測起來很乾淨，那份乾淨給了我一種已經接好的錯覺。
 * 真正確認它可用是 `e2e/finder-versions.spec.ts` 走完整條路之後的事。
 *
 * 還原是**非破壞性**的：後端會先把目前的內容存成一個新版本，再把選定的版本
 * 複製回來，被選的那個版本檔也保留著。這件事要在 UI 上說出來，不然沒有人敢按。
 *
 * 資料與動作是**傳進來的**而不是在這裡呼叫 hook —— 跟 `ShareDialog` 同一個
 * 慣例，這樣元件測試不需要 QueryClientProvider 也不用去 mock apiClient。
 */
export const VersionHistoryDialog = ({
  isOpen,
  onClose,
  fileName,
  versions,
  isLoading,
  onRestore,
}: VersionHistoryDialogProps) => {
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const handleRestore = async (versionId: string) => {
    setRestoringId(versionId);
    try {
      await onRestore(versionId);
      toast.success(`已還原「${fileName}」`);
      onClose();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "還原失敗"));
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5" /> 版本歷史
          </DialogTitle>
          <DialogDescription>
            {fileName} —— 還原不會刪掉任何東西：目前的內容會先存成新的一個版本。
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 flex justify-center text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : !versions || versions.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">
            這個檔案還沒有舊版本。被覆寫過之後才會有。
          </p>
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto divide-y divide-gray-200 dark:divide-white/10">
            {versions.map((version) => (
              <li key={version.version_id} className="flex items-center gap-3 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    {/* 後端送的是 Unix 秒 */}
                    {new Date(version.timestamp * 1000).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500">{formatBytes(version.size)}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={restoringId !== null}
                  onClick={() => void handleRestore(version.version_id)}
                >
                  {restoringId === version.version_id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3.5 h-3.5" />
                  )}
                  還原
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
};
