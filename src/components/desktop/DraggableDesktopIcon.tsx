"use client";

import React, { useEffect, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { FileInfo } from "@/types/api";
import { FileTypeIcon } from "@/lib/file-icons";
import { gridToPixels } from "./icon-grid";

interface DraggableDesktopIconProps {
  file: FileInfo;
  isSelected: boolean;
  isRenaming: boolean;
  renameValue: string;
  position: { row: number; col: number };
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
}

export const DraggableDesktopIcon = ({
  file,
  isSelected,
  isRenaming,
  renameValue,
  position,
  onClick,
  onDoubleClick,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
}: DraggableDesktopIconProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // ⚠️ 重新命名時要停用拖曳 —— 否則在 <input> 裡按方向鍵移動游標會被
  // KeyboardSensor 攔走，變成在移動圖示。
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: file.path,
    disabled: isRenaming,
  });

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const getIcon = () => {
    return (
      <FileTypeIcon
        filename={file.name}
        isDir={file.is_dir}
        mimeType={file.mime_type ?? undefined}
        size="lg"
      />
    );
  };

  const { x: gridX, y: gridY } = gridToPixels(position);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "absolute flex flex-col items-center gap-1 p-2 rounded hover:bg-white/10 w-[100px] cursor-pointer transition-all group",
        isSelected && "bg-blue-500/30 border border-blue-500/50 hover:bg-blue-500/40",
        isDragging && "opacity-70 z-50 shadow-2xl scale-110",
      )}
      style={{
        left: `${gridX}px`,
        top: `${gridY}px`,
        // 拖曳中用 transform 位移，不改 left/top —— transform 不觸發 layout，
        // 而且 dnd-kit 給的 transform 已經含了 KeyboardSensor 的步進。
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition: isDragging ? "none" : "all 0.3s ease-out",
      }}
      // role="button" / tabIndex 由 dnd-kit 的 attributes 提供（它還會補上
      // aria-roledescription="draggable" 與拖曳說明的 aria-describedby）。
      //
      // 這裡是 role="button" 的 div 而不是真的 <button>：重新命名時裡面會出現
      // 一個 <input>，而 input 不能放在 button 裡 —— 那是無效的 HTML，
      // 瀏覽器會把 DOM 重組成跟你寫的不一樣。
      {...listeners}
      {...attributes}
      // ⚠️ role / tabIndex 跟 attributes 給的值一樣，重寫一次是為了讓靜態分析
      // 看得到 —— oxlint 讀不出 spread 裡有什麼，少了這兩行會誤報
      // jsx-a11y/no-static-element-interactions。放在 spread **之後**，
      // 放前面 TS 會擋（TS2783: specified more than once）。
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="button"
      tabIndex={0}
      // ⚠️ 選取狀態**不能**用 aria-pressed —— dnd-kit 已經用它表示「已拿起」，
      // 兩個意思會互相覆蓋（TS 也會擋：'aria-pressed' is specified more than once）。
      // 而且對一個「按下去會開啟檔案」的 button 來說，pressed 本來就不是
      // 「已選取」的正確語意。改成寫進可讀名稱。
      aria-label={isSelected ? `${file.name}（已選取）` : file.name}
      // ⚠️ 這裡**不能**只寫自己的 onKeyDown —— `{...listeners}` 裡就有一個
      // （dnd-kit 的鍵盤拖曳啟動器），寫在後面會把它整個蓋掉，鍵盤拖曳
      // 就完全不會啟動。要顯式串起來。
      //
      // 鍵位分工（跟檔案總管一致）：
      //   Enter  開啟
      //   空白   拿起／放下（dnd-kit）
      //   方向鍵 移動一格（拿起之後才有作用）
      //   Esc    取消，回到原位
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (!isRenaming) onDoubleClick();
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
      onClick={(e) => {
        // 拖曳過就不要再當成點擊 —— dnd-kit 的 isDragging 在 dragEnd 之前都是 true
        if (!isDragging) {
          e.stopPropagation();
          onClick(e);
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!isRenaming && !isDragging) onDoubleClick();
      }}
      data-context-type="desktop-icon"
      data-context-id={file.path}
    >
      <div className="filter drop-shadow-lg transition-transform group-hover:scale-105">
        {getIcon()}
      </div>
      {isRenaming ? (
        <input
          ref={inputRef}
          type="text"
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onRenameSubmit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onRenameCancel();
            }
          }}
          onBlur={onRenameSubmit}
          className="text-xs text-center text-black dark:text-white font-medium px-1.5 py-0.5 rounded bg-white dark:bg-black border border-blue-500 outline-none w-full"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className={cn(
            "text-xs text-center text-white font-medium px-1.5 py-0.5 rounded shadow-sm line-clamp-2 break-all",
            isSelected ? "bg-blue-500" : "bg-black/40 group-hover:bg-black/60",
          )}
        >
          {file.name}
        </span>
      )}
    </div>
  );
};
