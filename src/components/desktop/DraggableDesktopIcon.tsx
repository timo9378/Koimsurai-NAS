'use client';

import React, { useEffect, useRef, useState } from 'react';
import { FileIcon, Folder, FileText, Image, Film, Music, Box } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileInfo } from '@/types/api';

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
  onPositionChange: (newPosition: { row: number; col: number }) => void;
}

const GRID_SIZE = 100; // Size of each grid cell (matches the icon width)
const GRID_GAP = 8; // Gap between icons

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
  onPositionChange,
}: DraggableDesktopIconProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const getIcon = () => {
    if (file.is_dir) return <Folder className="w-10 h-10 text-blue-500 fill-blue-500/20" />;
    
    const ext = file.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'webp':
        return <Image className="w-10 h-10 text-purple-500" />;
      case 'mp4':
      case 'mov':
      case 'avi':
        return <Film className="w-10 h-10 text-red-500" />;
      case 'mp3':
      case 'wav':
        return <Music className="w-10 h-10 text-green-500" />;
      case 'txt':
      case 'md':
      case 'json':
        return <FileText className="w-10 h-10 text-slate-500" />;
      case 'zip':
      case 'tar':
      case 'gz':
        return <Box className="w-10 h-10 text-yellow-500" />;
      default:
        return <FileIcon className="w-10 h-10 text-gray-500" />;
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isRenaming || e.button !== 0) return;
    
    const rect = iconRef.current?.getBoundingClientRect();
    if (!rect) return;

    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setDragPosition({ x: rect.left, y: rect.top });
    setIsDragging(true);
    onClick(e);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setDragPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      setIsDragging(false);

      // Calculate the nearest grid position
      // Account for padding/offset from desktop edge
      const desktopPadding = 16; // p-4 = 16px
      const topBarHeight = 48; // Top bar height

      const relativeX = e.clientX - desktopPadding;
      const relativeY = e.clientY - topBarHeight - desktopPadding;

      const col = Math.round(relativeX / (GRID_SIZE + GRID_GAP));
      const row = Math.round(relativeY / (GRID_SIZE + GRID_GAP));

      // Ensure non-negative values
      const newCol = Math.max(0, col);
      const newRow = Math.max(0, row);

      onPositionChange({ row: newRow, col: newCol });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, onPositionChange]);

  // Calculate the actual position based on grid
  const gridX = position.col * (GRID_SIZE + GRID_GAP);
  const gridY = position.row * (GRID_SIZE + GRID_GAP);

  return (
    <div
      ref={iconRef}
      className={cn(
        "absolute flex flex-col items-center gap-1 p-2 rounded hover:bg-white/10 w-[100px] cursor-pointer transition-all group",
        isSelected && "bg-blue-500/30 border border-blue-500/50 hover:bg-blue-500/40",
        isDragging && "opacity-70 z-50 shadow-2xl scale-110"
      )}
      style={{
        left: isDragging ? `${dragPosition.x}px` : `${gridX}px`,
        top: isDragging ? `${dragPosition.y}px` : `${gridY}px`,
        transition: isDragging ? 'none' : 'all 0.3s ease-out',
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!isRenaming) onDoubleClick();
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
            if (e.key === 'Enter') {
              e.preventDefault();
              onRenameSubmit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onRenameCancel();
            }
          }}
          onBlur={onRenameSubmit}
          className="text-xs text-center text-black dark:text-white font-medium px-1.5 py-0.5 rounded bg-white dark:bg-black border border-blue-500 outline-none w-full"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className={cn(
          "text-xs text-center text-white font-medium px-1.5 py-0.5 rounded shadow-sm line-clamp-2 break-all",
          isSelected ? "bg-blue-500" : "bg-black/40 group-hover:bg-black/60"
        )}>
          {file.name}
        </span>
      )}
    </div>
  );
};
