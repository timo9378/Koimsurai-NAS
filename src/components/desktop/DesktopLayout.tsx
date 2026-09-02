"use client";

import React, { useState, useRef } from "react";
import { TopBar } from "./TopBar";
import { WindowContainer } from "./WindowContainer";
import { UploadStatus } from "./UploadStatus";
import { GlobalContextMenu } from "./GlobalContextMenu";
import { DesktopIcons } from "./DesktopIcons";
import { useFileUpload } from "@/features/files/hooks/useFileUpload"; // Updated import
import { MOVE_MIME } from "@/lib/dnd";

interface DesktopLayoutProps {
  children?: React.ReactNode;
}

interface SelectionBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isSelecting: boolean;
}

export const DesktopLayout = ({ children }: DesktopLayoutProps) => {
  const [wallpaper, setWallpaper] = React.useState(
    () =>
      localStorage.getItem("desktop-wallpaper") ??
      "https://images.unsplash.com/photo-1477346611705-65d1883cee1e?q=80&w=2070&auto=format&fit=crop",
  );
  const [selection, setSelection] = useState<SelectionBox>({
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    isSelecting: false,
  });
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const { handleUploadFiles } = useFileUpload(); // Use the hook

  // ⚠️ 這裡原本還有一份 snap／maximize 的實作，已經移除。
  //
  // `WindowContainer` 也監聽同一個 `window-drag-end`，而兩份的幾何**不一樣**：
  // 這裡是 `{x:0, y:0, w/2, h}`（無邊距），那裡是 `{x:12, y:48, w/2-24, h-96}`
  // （跟拖曳時顯示的預覽框一致）。兩份都會跑，最終狀態取決於監聽器的註冊順序
  // —— 實測是 WindowContainer 那份贏，所以這一份是死的，但只要掛載順序改變
  // 行為就會跟著變。
  //
  // 預覽框也是重複的：這裡畫一個滿版的邊框（只有最大化），WindowContainer 畫
  // 一個帶邊距的（最大化／左／右）。拖到頂端時兩個會同時出現，大小還不一樣。
  //
  // 留一份：`WindowContainer`（三種狀態都有，而且落點跟它自己的預覽一致）。

  const handleWallpaperChange = (url: string) => {
    setWallpaper(url);
    localStorage.setItem("desktop-wallpaper", url);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only start selection if clicking directly on the desktop background
    // content-wrapper is the div acting as the interactive layer for icons/windows
    const target = e.target as HTMLElement;
    const isInteractive = target.closest(
      'button, a, input, [data-context-type="desktop-icon"], .window-container, [data-context-type="topbar"], .desktop-window',
    );

    // Check if we are clicking on background (root or wrapper) AND not on an interactive element
    if (!isInteractive && e.button === 0) {
      setSelection({
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
        isSelecting: true,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (selection.isSelecting) {
      setSelection((prev) => ({
        ...prev,
        currentX: e.clientX,
        currentY: e.clientY,
      }));

      // Calculate selection box
      const left = Math.min(selection.startX, e.clientX);
      const top = Math.min(selection.startY, e.clientY);
      const width = Math.abs(e.clientX - selection.startX);
      const height = Math.abs(e.clientY - selection.startY);

      // Dispatch event for DesktopIcons to handle selection
      const event = new CustomEvent("desktop-selection-change", {
        detail: {
          rect: { left, top, width, height },
        },
      });
      window.dispatchEvent(event);
    }
  };

  const handleMouseUp = () => {
    if (selection.isSelecting) {
      setSelection((prev) => ({ ...prev, isSelecting: false }));
      // Dispatch event to end selection
      window.dispatchEvent(new Event("desktop-selection-end"));
    }
  };

  // Calculate selection box styles
  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 內部拖拉移動(檔案→資料夾/breadcrumb)不是上傳,別把整個桌面染藍
    if (e.dataTransfer.types.includes(MOVE_MIME)) return;
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingFile(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Use shared hook logic
    // We upload to /Desktop
    await handleUploadFiles(files, "/Desktop");
  };

  // Calculate box dimensions
  const left = Math.min(selection.startX, selection.currentX);
  const top = Math.min(selection.startY, selection.currentY);
  const width = Math.abs(selection.currentX - selection.startX);
  const height = Math.abs(selection.currentY - selection.startY);

  return (
    // 這一層是框選用的畫布，不是控制項——滑鼠拖曳出一個矩形來選取圖示。
    // 鍵盤使用者是用 Tab 逐一走訪圖示，沒有「框選」這個對應動作，所以這裡
    // 沒有等價的鍵盤處理可以補。
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={containerRef}
      className="relative w-screen h-screen overflow-hidden bg-cover bg-center transition-all duration-500 select-none"
      style={{ backgroundImage: `url(${wallpaper})` }}
      data-context-type="desktop"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(...args) => void handleDrop(...args)}
    >
      {/* Overlay for better contrast */}
      <div
        className={`absolute inset-0 bg-black/20 pointer-events-none transition-colors duration-300 ${isDraggingFile ? "bg-blue-500/20" : ""}`}
      />

      {/* Selection Box */}
      {selection.isSelecting && (
        <div
          className="absolute border border-blue-500/50 bg-blue-500/20 z-10 pointer-events-none"
          style={{
            left,
            top,
            width,
            height,
          }}
        />
      )}

      <TopBar />

      <main className="relative w-full h-full pt-8 pb-20 pointer-events-none">
        <div className="pointer-events-auto w-full h-full">
          <DesktopIcons />
          <WindowContainer />
          {children}
          {/* Moved UploadStatus here so it is interactive */}
          <UploadStatus />
        </div>
      </main>

      <GlobalContextMenu onWallpaperChange={handleWallpaperChange} />
    </div>
  );
};
