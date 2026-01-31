'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Volume1,
  SkipBack,
  SkipForward,
  Repeat,
  Shuffle,
  Music2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAudioPlayerStore } from '@/store/audio-player-store';
import { useWindowStore } from '@/store/window-store';

interface AudioPlayerProps {
  src: string;
  title?: string;
  artist?: string;
  albumArt?: string;
  className?: string;
  windowId?: string;
  onError?: (e: React.SyntheticEvent<HTMLAudioElement>) => void;
  onEnded?: () => void;
}

const formatTime = (seconds: number): string => {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Storage keys for persistence (shared with video player)
const VOLUME_STORAGE_KEY = 'koimsurai-player-volume';
const MUTED_STORAGE_KEY = 'koimsurai-player-muted';

const getSavedVolume = (): number => {
  if (typeof window === 'undefined') return 1;
  const saved = sessionStorage.getItem(VOLUME_STORAGE_KEY);
  if (saved) {
    const vol = parseFloat(saved);
    return isNaN(vol) ? 1 : Math.max(0, Math.min(1, vol));
  }
  return 1;
};

const getSavedMuted = (): boolean => {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(MUTED_STORAGE_KEY) === 'true';
};

export function AudioPlayer({ 
  src, 
  title, 
  artist, 
  albumArt, 
  className, 
  windowId,
  onError,
  onEnded 
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const volumeBarRef = useRef<HTMLDivElement>(null);
  
  const { setAudioState, updateProgress, toggleMiniPlayer } = useAudioPlayerStore();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isRepeat, setIsRepeat] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  // Initialize volume from sessionStorage
  useEffect(() => {
    const savedVolume = getSavedVolume();
    const savedMuted = getSavedMuted();
    setVolume(savedVolume);
    setIsMuted(savedMuted);
    
    const audio = audioRef.current;
    if (audio) {
      audio.volume = savedVolume;
      audio.muted = savedMuted;
    }
    setIsInitialized(true);
  }, []);

  // Save volume to sessionStorage when it changes
  useEffect(() => {
    if (!isInitialized) return;
    sessionStorage.setItem(VOLUME_STORAGE_KEY, volume.toString());
    sessionStorage.setItem(MUTED_STORAGE_KEY, isMuted.toString());
  }, [volume, isMuted, isInitialized]);

  // Sync with global audio player store
  useEffect(() => {
    setAudioState({
      isActive: true,
      currentSrc: src,
      currentTitle: title || null,
      currentArtist: artist || null,
      currentAlbumArt: albumArt || null,
      windowId: windowId || null,
    });

    // Cleanup when component unmounts
    return () => {
      // Only clear if this is the current playing source
      const currentStore = useAudioPlayerStore.getState();
      if (currentStore.currentSrc === src) {
        setAudioState({
          isActive: false,
          isPlaying: false,
          currentSrc: null,
        });
        toggleMiniPlayer(false);
      }
    };
  }, [src, title, artist, albumArt, windowId, setAudioState, toggleMiniPlayer]);

  // Listen to window minimize state to show mini player
  const windows = useWindowStore((state) => state.windows);
  const currentWindow = windowId ? windows.find((w) => w.id === windowId) : null;
  
  useEffect(() => {
    if (currentWindow?.isMinimized && isPlaying) {
      // Window is minimized and audio is playing, show mini player
      toggleMiniPlayer(true);
    } else if (!currentWindow?.isMinimized) {
      // Window is restored, hide mini player
      toggleMiniPlayer(false);
    }
  }, [currentWindow?.isMinimized, isPlaying, toggleMiniPlayer]);

  // Handle play/pause
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  }, []);

  // Handle progress bar click
  const handleProgressBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = progressBarRef.current;
    const audio = audioRef.current;
    if (!bar || !audio || !duration) return;
    
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    const newTime = percentage * duration;
    
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration]);

  // Handle progress drag
  const handleProgressDrag = useCallback((e: MouseEvent) => {
    const bar = progressBarRef.current;
    const audio = audioRef.current;
    if (!bar || !audio || !duration) return;
    
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    const newTime = percentage * duration;
    
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration]);

  // Mouse down on progress bar starts drag
  const handleProgressMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingProgress(true);
    handleProgressBarClick(e);
  }, [handleProgressBarClick]);

  // Mouse drag handlers for progress
  useEffect(() => {
    if (!isDraggingProgress) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleProgressDrag(e);
    };

    const handleMouseUp = () => {
      setIsDraggingProgress(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingProgress, handleProgressDrag]);

  // Handle volume bar click
  const handleVolumeBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = volumeBarRef.current;
    const audio = audioRef.current;
    if (!bar || !audio) return;
    
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const newVolume = x / rect.width;
    
    audio.volume = newVolume;
    audio.muted = false;
    setVolume(newVolume);
    setIsMuted(false);
  }, []);

  // Handle volume drag
  const handleVolumeDrag = useCallback((e: MouseEvent) => {
    const bar = volumeBarRef.current;
    const audio = audioRef.current;
    if (!bar || !audio) return;
    
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const newVolume = x / rect.width;
    
    audio.volume = newVolume;
    audio.muted = false;
    setVolume(newVolume);
    setIsMuted(false);
  }, []);

  // Mouse down on volume bar starts drag
  const handleVolumeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
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

  // Toggle mute
  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    if (isMuted) {
      audio.muted = false;
      setIsMuted(false);
      if (volume === 0) {
        audio.volume = 0.5;
        setVolume(0.5);
      }
    } else {
      audio.muted = true;
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  // Skip forward/backward
  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.currentTime + seconds, duration));
  }, [duration]);

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => {
      setIsPlaying(true);
      setAudioState({ isPlaying: true });
    };
    const handlePause = () => {
      setIsPlaying(false);
      setAudioState({ isPlaying: false });
    };
    const handleTimeUpdate = () => {
      if (!isDraggingProgress) {
        setCurrentTime(audio.currentTime);
        updateProgress(audio.currentTime, audio.duration || 0);
      }
    };
    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      updateProgress(0, audio.duration);
    };
    const handleEnded = () => {
      if (isRepeat) {
        audio.currentTime = 0;
        audio.play();
      } else {
        setIsPlaying(false);
        setAudioState({ isPlaying: false });
        onEnded?.();
      }
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [isDraggingProgress, isRepeat, onEnded, setAudioState, updateProgress]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skip(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          skip(10);
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, skip, toggleMute]);

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;
  const displayVolume = isMuted ? 0 : volume;
  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className={cn("flex flex-col w-full h-full bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-xl overflow-hidden select-none", className)}>
      {/* Hidden Audio Element */}
      <audio
        ref={audioRef}
        src={src}
        crossOrigin="use-credentials"
        onError={onError}
        preload="metadata"
      />

      {/* Album Art / Visualization Area */}
      <div className="flex-1 flex items-center justify-center p-8 min-h-[200px]">
        {albumArt ? (
          <div className="relative w-48 h-48 md:w-64 md:h-64 rounded-lg overflow-hidden shadow-2xl">
            <img
              src={albumArt}
              alt="Album Art"
              className="w-full h-full object-cover"
            />
            {/* Vinyl Record Effect */}
            <div className={cn(
              "absolute inset-0 bg-black/20",
              isPlaying && "animate-pulse"
            )} />
          </div>
        ) : (
          <div className={cn(
            "w-48 h-48 md:w-64 md:h-64 rounded-full bg-gradient-to-br from-purple-500/20 via-blue-500/20 to-cyan-500/20 flex items-center justify-center shadow-2xl border border-white/10",
            isPlaying && "animate-spin-slow"
          )}>
            <div className="w-32 h-32 md:w-40 md:h-40 rounded-full bg-gradient-to-br from-purple-500/30 via-blue-500/30 to-cyan-500/30 flex items-center justify-center border border-white/10">
              <Music2 className="w-16 h-16 md:w-20 md:h-20 text-white/50" />
            </div>
          </div>
        )}
      </div>

      {/* Song Info */}
      <div className="px-6 pb-4 text-center">
        <h2 className="text-xl font-bold text-white truncate">
          {title || '未知曲目'}
        </h2>
        {artist && (
          <p className="text-sm text-white/60 truncate mt-1">{artist}</p>
        )}
      </div>

      {/* Progress Bar */}
      <div className="px-6 pb-2">
        <div 
          ref={progressBarRef}
          className="relative h-1.5 bg-white/10 rounded-full cursor-pointer group"
          onMouseDown={handleProgressMouseDown}
        >
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full pointer-events-none"
            style={{ width: `${progressPercentage}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{ left: `calc(${progressPercentage}% - 6px)` }}
          />
        </div>
        <div className="flex justify-between text-xs text-white/50 mt-1">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="px-6 pb-6">
        <div className="flex items-center justify-center gap-4">
          {/* Shuffle */}
          <button
            onClick={() => setIsShuffle(!isShuffle)}
            className={cn(
              "p-2 rounded-full transition-colors",
              isShuffle 
                ? "text-purple-400 hover:bg-purple-500/20" 
                : "text-white/50 hover:text-white hover:bg-white/10"
            )}
            title="隨機播放"
          >
            <Shuffle className="w-5 h-5" />
          </button>

          {/* Skip Back */}
          <button
            onClick={() => skip(-10)}
            className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            title="倒退 10 秒"
          >
            <SkipBack className="w-6 h-6" />
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="p-4 rounded-full bg-white text-gray-900 hover:scale-105 transition-transform shadow-lg"
            title={isPlaying ? '暫停' : '播放'}
          >
            {isPlaying ? (
              <Pause className="w-8 h-8" fill="currentColor" />
            ) : (
              <Play className="w-8 h-8 ml-1" fill="currentColor" />
            )}
          </button>

          {/* Skip Forward */}
          <button
            onClick={() => skip(10)}
            className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            title="快進 10 秒"
          >
            <SkipForward className="w-6 h-6" />
          </button>

          {/* Repeat */}
          <button
            onClick={() => setIsRepeat(!isRepeat)}
            className={cn(
              "p-2 rounded-full transition-colors",
              isRepeat 
                ? "text-purple-400 hover:bg-purple-500/20" 
                : "text-white/50 hover:text-white hover:bg-white/10"
            )}
            title="重複播放"
          >
            <Repeat className="w-5 h-5" />
          </button>
        </div>

        {/* Volume Control */}
        <div 
          className="flex items-center justify-center gap-2 mt-4"
          onMouseEnter={() => setShowVolumeSlider(true)}
          onMouseLeave={() => !isDraggingVolume && setShowVolumeSlider(false)}
        >
          <button
            onClick={toggleMute}
            className="p-2 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            title={isMuted ? '取消靜音' : '靜音'}
          >
            <VolumeIcon className="w-5 h-5" />
          </button>
          
          <div 
            className={cn(
              "overflow-hidden transition-all duration-200",
              showVolumeSlider || isDraggingVolume ? "w-24 opacity-100" : "w-0 opacity-0"
            )}
          >
            <div 
              ref={volumeBarRef}
              className="relative h-1.5 bg-white/10 rounded-full cursor-pointer"
              onMouseDown={handleVolumeMouseDown}
            >
              <div
                className="absolute inset-y-0 left-0 bg-white rounded-full pointer-events-none"
                style={{ width: `${displayVolume * 100}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-lg pointer-events-none"
                style={{ left: `calc(${displayVolume * 100}% - 6px)` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
