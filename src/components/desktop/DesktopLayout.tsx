'use client';

import React, { useEffect, useState, useRef } from 'react';
import { TopBar } from './TopBar';
import { WindowContainer } from './WindowContainer';
import { UploadStatus } from './UploadStatus';
import { GlobalContextMenu } from './GlobalContextMenu';
import { DesktopIcons } from './DesktopIcons';
import { useFileUpload } from '@/features/files/hooks/useFileUpload'; // Updated import
import { useUploadStore } from '@/store/upload-store';
import { useWindowStore } from '@/store/window-store';

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
  const [wallpaper, setWallpaper] = React.useState('https://images.unsplash.com/photo-1477346611705-65d1883cee1e?q=80&w=2070&auto=format&fit=crop');
  const [selection, setSelection] = useState<SelectionBox>({
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    isSelecting: false,
  });
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [maximizePreview, setMaximizePreview] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const { handleUploadFiles } = useFileUpload(); // Use the hook
  const { snapWindow, maximizeWindow } = useWindowStore();

  useEffect(() => {
    const saved = localStorage.getItem('desktop-wallpaper');
    if (saved) setWallpaper(saved);
  }, []);

  // Handle window drag for snap preview
  useEffect(() => {
    const handleDragMove = (e: Event) => {
      const customEvent = e as CustomEvent<{ x: number; y: number }>;
      const y = customEvent.detail.y;
      
      // Show maximize preview if dragged to top
      if (y < 50) {
        setMaximizePreview(true);
      } else {
        setMaximizePreview(false);
      }
    };
    
    const handleDragEnd = (e: Event) => {
      const customEvent = e as CustomEvent<{ x: number; y: number; windowId: string }>;
      const { x, y, windowId } = customEvent.detail;
      
      setMaximizePreview(false);
      
      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;
      
      // Maximize if dropped at top (fixed: use snapWindow with 'maximize' state)
      if (y < 50) {
        maximizeWindow(windowId);
      }
      // Snap left
      else if (x < 50) {
        snapWindow(windowId, 'left', {
          position: { x: 0, y: 0 },
          size: { width: screenWidth / 2, height: screenHeight }
        });
      }
      // Snap right
      else if (x > screenWidth - 50) {
        snapWindow(windowId, 'right', {
          position: { x: screenWidth / 2, y: 0 },
          size: { width: screenWidth / 2, height: screenHeight }
        });
      }
    };
    
    window.addEventListener('window-drag-move', handleDragMove);
    window.addEventListener('window-drag-end', handleDragEnd);
    
    return () => {
      window.removeEventListener('window-drag-move', handleDragMove);
      window.removeEventListener('window-drag-end', handleDragEnd);
    };
  }, [snapWindow]);

  const handleWallpaperChange = (url: string) => {
    setWallpaper(url);
    localStorage.setItem('desktop-wallpaper', url);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only start selection if clicking directly on the desktop background
    // and specifically the left mouse button
    if (e.target === e.currentTarget && e.button === 0) {
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
      setSelection(prev => ({
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
      const event = new CustomEvent('desktop-selection-change', {
        detail: {
          rect: { left, top, width, height }
        }
      });
      window.dispatchEvent(event);
    }
  };

  const handleMouseUp = () => {
    if (selection.isSelecting) {
      setSelection(prev => ({ ...prev, isSelecting: false }));
      // Dispatch event to end selection
      window.dispatchEvent(new Event('desktop-selection-end'));
    }
  };

  // Calculate selection box styles
  const getSelectionBoxStyle = () => {
    const left = Math.min(selection.startX, selection.currentX);
    const top = Math.min(selection.startY, selection.currentY);
    const width = Math.abs(selection.currentX - selection.startX);
    const height = Math.abs(selection.currentY - selection.startY);
    
    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    };
  };

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
    await handleUploadFiles(files, '/Desktop');
  };

  // Calculate box dimensions
  const left = Math.min(selection.startX, selection.currentX);
  const top = Math.min(selection.startY, selection.currentY);
  const width = Math.abs(selection.currentX - selection.startX);
  const height = Math.abs(selection.currentY - selection.startY);

  return (
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
      onDrop={handleDrop}
    >
      {/* Overlay for better contrast */}
      <div className={`absolute inset-0 bg-black/20 pointer-events-none transition-colors duration-300 ${isDraggingFile ? 'bg-blue-500/20' : ''}`} />
      
      {/* Maximize Preview */}
      {maximizePreview && (
        <div className="absolute inset-0 border-4 border-blue-500/50 bg-blue-500/10 pointer-events-none z-[9998] animate-in fade-in duration-200" />
      )}
      
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