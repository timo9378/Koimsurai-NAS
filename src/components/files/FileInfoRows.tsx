import type { ReactNode } from "react";
import type { FileInfo } from "@/types/api";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

const Row = ({
  label,
  valueClassName,
  children,
}: {
  label: string;
  valueClassName?: string;
  children: ReactNode;
}) => (
  <div className="flex justify-between">
    <span className="text-gray-500">{label}</span>
    <span className={cn("text-gray-900 dark:text-white", valueClassName)}>{children}</span>
  </div>
);

/**
 * 「檔案資訊」的內容本身，不含外框。
 *
 * 手機是底部彈出的 sheet、桌面是 Dialog，外框不一樣但要顯示的東西一樣 ——
 * 這裡只放那份「一樣」的部分。抽出來的直接原因是桌面右鍵選單的「Get Info」
 * 原本是個**沒有 onClick 的**選單項，而手機一直都做得到。
 */
export const FileInfoRows = ({ file }: { file: FileInfo }) => (
  <div className="space-y-3 text-sm">
    <Row label="Name" valueClassName="font-medium truncate ml-4 text-right">
      {file.name}
    </Row>
    <Row label="Type">{file.is_dir ? "Folder" : file.mime_type || "Unknown"}</Row>
    <Row label="Size">{file.is_dir ? "--" : formatBytes(file.size)}</Row>
    <Row label="Modified">{new Date(file.modified).toLocaleString()}</Row>
    <Row label="Path" valueClassName="truncate ml-4 text-right">
      {file.path}
    </Row>
    {file.tags.length > 0 && (
      <div className="flex justify-between items-start">
        <span className="text-gray-500">Tags</span>
        <div className="flex gap-1 flex-wrap justify-end">
          {file.tags.map((t) => (
            <span
              key={t.name}
              className="px-2 py-0.5 rounded-full text-xs text-white"
              style={{ backgroundColor: t.color || "#8E8E93" }}
            >
              {t.name}
            </span>
          ))}
        </div>
      </div>
    )}
  </div>
);
