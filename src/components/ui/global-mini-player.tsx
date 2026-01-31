'use client';

import React, { useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  X,
  Maximize2,
  Music2,
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
  const audioRef = useRef<HTMLAudioElement>(null);
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
    setAudioState,
    stop,
    toggleMiniPlayer,
    updateProgress,
  } = useAudioPlayerStore();

  const { focusWindow } = useWindowStore();

  // Sync audio playback with state
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSrc) return;

    if (isPlaying) {
      audio.play().catch(console.error);
    } else {
      audio.pause();
    }
  }, [isPlaying, currentSrc]);

  // Handle audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      updateProgress(audio.currentTime, audio.duration || 0);
    };

    const handleEnded = () => {
      setAudioState({ isPlaying: false });
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [updateProgress, setAudioState]);

  const handleTogglePlay = () => {
    setAudioState({ isPlaying: !isPlaying });
  };

  const handleExpand = () => {
    if (windowId) {
      focusWindow(windowId);
      toggleMiniPlayer(false);
    }
  };

  const handleClose = () => {
    stop();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  // Don't render if not active or not in mini player mode
  if (!isActive || !isMiniPlayer || !currentSrc) {
    return null;
  }

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      {/* Hidden Audio Element */}
      <audio
        ref={audioRef}
        src={currentSrc}
        crossOrigin="use-credentials"
        preload="metadata"
      />

      {/* Mini Player UI */}
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
              {currentArtist && (
                <p className="text-xs text-white/50 truncate">{currentArtist}</p>
              )}
              <span className="text-xs text-white/30">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
          </div>

          {/* Controls */}
          <button
            onClick={handleTogglePlay}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            title={isPlaying ? '暫停' : '播放'}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 text-white" fill="white" />
            ) : (
              <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
            )}
          </button>

          <button
            onClick={handleExpand}
            className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
            title="展開"
          >
            <Maximize2 className="w-4 h-4 text-white/50 hover:text-white" />
          </button>

          <button
            onClick={handleClose}
            className="p-1 text-white/50 hover:text-white transition-colors text-lg"
            title="關閉"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
}
