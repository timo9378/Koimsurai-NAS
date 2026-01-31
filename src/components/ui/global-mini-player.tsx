'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  X,
  Maximize2,
  Music2,
  Volume2,
  VolumeX,
  Volume1,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAudioPlayerStore } from '@/store/audio-player-store';
import { useWindowStore } from '@/store/window-store';

const formatTime = (seconds: number): string => {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export function GlobalMiniPlayer() {
  const volumeBarRef = useRef<HTMLDivElement>(null);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  const {
    isActive,
    isPlaying,
    isMiniPlayer,
    currentSrc,
    currentTitle,
    currentArtist,
    currentAlbumArt,
    currentTime,
    duration,
    windowId,
    volume,
    isMuted,
    activeAudioRef,
    setAudioState,
    stop,
    toggleMiniPlayer,
    setVolume,
    toggleMute,
  } = useAudioPlayerStore();

  const { focusWindow, restoreWindow } = useWindowStore();

  const handleTogglePlay = useCallback(() => {
    if (activeAudioRef) {
      if (isPlaying) {
        activeAudioRef.pause();
      } else {
        activeAudioRef.play().catch(console.error);
      }
      setAudioState({ isPlaying: !isPlaying });
    }
  }, [activeAudioRef, isPlaying, setAudioState]);

  const handleExpand = useCallback(() => {
    if (windowId) {
      restoreWindow(windowId);
      focusWindow(windowId);
      toggleMiniPlayer(false);
    }
  }, [windowId, restoreWindow, focusWindow, toggleMiniPlayer]);

  const handleClose = useCallback(() => {
    stop();
  }, [stop]);

  // Volume bar click handler
  const handleVolumeBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = volumeBarRef.current;
    if (!bar) return;
    
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const newVolume = x / rect.width;
    setVolume(newVolume);
  }, [setVolume]);

  // Volume drag handler
  const handleVolumeDrag = useCallback((e: MouseEvent) => {
    const bar = volumeBarRef.current;
    if (!bar) return;
    
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const newVolume = x / rect.width;
    setVolume(newVolume);
  }, [setVolume]);

  const handleVolumeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingVolume(true);
    handleVolumeBarClick(e);
  }, [handleVolumeBarClick]);

  // Mouse drag handlers for volume
  useEffect(() => {
    if (!isDraggingVolume) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleVolumeDrag(e);
    };

    const handleMouseUp = () => {
      setIsDraggingVolume(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingVolume, handleVolumeDrag]);

  // Don't render if not active or not in mini player mode
  if (!isActive || !isMiniPlayer || !currentSrc) {
    return null;
  }

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;
  const displayVolume = isMuted ? 0 : volume;
  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div 
      className={cn(
        "fixed bottom-4 right-4 w-80 bg-gray-900/95 backdrop-blur-xl rounded-xl shadow-2xl border border-white/10 overflow-hidden z-50",
        "animate-in slide-in-from-bottom-4 fade-in duration-300"
      )}
    >
      {/* Progress Bar */}
      <div className="h-1 bg-white/10">
        <div 
          className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all"
          style={{ width: `${progressPercentage}%` }}
        />
      </div>

      <div className="flex items-center gap-3 p-3">
        {/* Album Art */}
        <div 
          className="w-12 h-12 rounded-lg overflow-hidden bg-white/10 shrink-0 cursor-pointer hover:ring-2 hover:ring-purple-500/50 transition-all"
          onClick={handleExpand}
        >
          {currentAlbumArt ? (
            <img src={currentAlbumArt} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music2 className="w-6 h-6 text-white/50" />
            </div>
          )}
        </div>

        {/* Song Info */}
        <div 
          className="flex-1 min-w-0 cursor-pointer"
          onClick={handleExpand}
        >
          <p className="text-sm font-medium text-white truncate">
            {currentTitle || '未知曲目'}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/30">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Volume Control */}
        <div 
          className="flex items-center gap-1"
          onMouseEnter={() => setShowVolumeSlider(true)}
          onMouseLeave={() => !isDraggingVolume && setShowVolumeSlider(false)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMute();
            }}
            className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
            title={isMuted ? '取消靜音' : '靜音'}
          >
            <VolumeIcon className="w-4 h-4 text-white/60" />
          </button>
          
          <div 
            className={cn(
              "overflow-hidden transition-all duration-200",
              showVolumeSlider || isDraggingVolume ? "w-16 opacity-100" : "w-0 opacity-0"
            )}
          >
            <div 
              ref={volumeBarRef}
              className="relative h-1 bg-white/20 rounded-full cursor-pointer"
              onMouseDown={handleVolumeMouseDown}
            >
              <div
                className="absolute inset-y-0 left-0 bg-white rounded-full pointer-events-none"
                style={{ width: `${displayVolume * 100}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white shadow-lg pointer-events-none"
                style={{ left: `calc(${displayVolume * 100}% - 4px)` }}
              />
            </div>
          </div>
        </div>

        {/* Play/Pause */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleTogglePlay();
          }}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          title={isPlaying ? '暫停' : '播放'}
        >
          {isPlaying ? (
            <Pause className="w-5 h-5 text-white" fill="white" />
          ) : (
            <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
          )}
        </button>

        {/* Expand */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleExpand();
          }}
          className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
          title="展開"
        >
          <Maximize2 className="w-4 h-4 text-white/50 hover:text-white" />
        </button>

        {/* Close */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleClose();
          }}
          className="p-1 text-white/50 hover:text-white transition-colors"
          title="關閉"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
