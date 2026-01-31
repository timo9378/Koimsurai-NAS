'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Volume1,
  Maximize,
  Minimize,
  SkipBack,
  SkipForward,
  Settings,
  PictureInPicture2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface VideoPlayerProps {
  src: string;
  title?: string;
  poster?: string;
  className?: string;
  onError?: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
}

const formatTime = (seconds: number): string => {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Storage keys for persistence
const VOLUME_STORAGE_KEY = 'koimsurai-player-volume';
const MUTED_STORAGE_KEY = 'koimsurai-player-muted';

// Get saved volume from sessionStorage
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

export function VideoPlayer({ src, title, poster, className, onError }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const volumeBarRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  
  const progressBarRef = useRef<HTMLDivElement>(null);

  // Initialize volume from sessionStorage
  useEffect(() => {
    const savedVolume = getSavedVolume();
    const savedMuted = getSavedMuted();
    setVolume(savedVolume);
    setIsMuted(savedMuted);
    
    const video = videoRef.current;
    if (video) {
      video.volume = savedVolume;
      video.muted = savedMuted;
    }
    setIsInitialized(true);
  }, []);

  // Save volume to sessionStorage when it changes
  useEffect(() => {
    if (!isInitialized) return;
    sessionStorage.setItem(VOLUME_STORAGE_KEY, volume.toString());
    sessionStorage.setItem(MUTED_STORAGE_KEY, isMuted.toString());
  }, [volume, isMuted, isInitialized]);

  // Handle play/pause
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }, []);

  // Handle seek
  const handleSeek = useCallback((value: number[]) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = value[0];
    setCurrentTime(value[0]);
  }, []);

  // Handle progress bar click
  const handleProgressBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = progressBarRef.current;
    const video = videoRef.current;
    if (!bar || !video || !duration) return;
    
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    const newTime = percentage * duration;
    
    video.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration]);

  // Handle progress drag
  const handleProgressDrag = useCallback((e: MouseEvent) => {
    const bar = progressBarRef.current;
    const video = videoRef.current;
    if (!bar || !video || !duration) return;
    
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    const newTime = percentage * duration;
    
    video.currentTime = newTime;
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

  // Handle volume change from slider interaction
  const handleVolumeBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = volumeBarRef.current;
    const video = videoRef.current;
    if (!bar || !video) return;
    
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const newVolume = x / rect.width;
    
    video.volume = newVolume;
    video.muted = false;
    setVolume(newVolume);
    setIsMuted(false);
  }, []);

  // Handle volume drag
  const handleVolumeDrag = useCallback((e: MouseEvent) => {
    const bar = volumeBarRef.current;
    const video = videoRef.current;
    if (!bar || !video) return;
    
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const newVolume = x / rect.width;
    
    video.volume = newVolume;
    video.muted = false;
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
    const video = videoRef.current;
    if (!video) return;
    
    if (isMuted) {
      video.muted = false;
      setIsMuted(false);
      // If volume was 0, set to a reasonable default
      if (volume === 0) {
        video.volume = 0.5;
        setVolume(0.5);
      }
    } else {
      video.muted = true;
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    try {
      if (!document.fullscreenElement) {
        await container.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  }, []);

  // Toggle Picture in Picture
  const togglePiP = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.error('PiP error:', err);
    }
  }, []);

  // Skip forward/backward
  const skip = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.currentTime + seconds, duration));
  }, [duration]);

  // Change playback rate
  const changePlaybackRate = useCallback((rate: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    setPlaybackRate(rate);
    setShowSettings(false);
  }, []);

  // Show controls on mouse move
  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    
    if (isPlaying && !showVolumeSlider && !showSettings && !isDraggingVolume) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  }, [isPlaying, showVolumeSlider, showSettings, isDraggingVolume]);

  // Video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleLoadedMetadata = () => setDuration(video.duration);
    const handleWaiting = () => setIsBuffering(true);
    const handleCanPlay = () => setIsBuffering(false);
    const handleProgress = () => {
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
    };
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('progress', handleProgress);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('progress', handleProgress);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if video is focused or container is focused
      if (!containerRef.current?.contains(document.activeElement) && 
          document.activeElement !== document.body) return;

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
        case 'ArrowUp':
          e.preventDefault();
          {
            const video = videoRef.current;
            const newVol = Math.min(volume + 0.1, 1);
            if (video) {
              video.volume = newVol;
              video.muted = false;
            }
            setVolume(newVol);
            setIsMuted(false);
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          {
            const video = videoRef.current;
            const newVol = Math.max(volume - 0.1, 0);
            if (video) {
              video.volume = newVol;
            }
            setVolume(newVol);
          }
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, skip, volume, toggleMute, toggleFullscreen]);

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPercentage = duration > 0 ? (buffered / duration) * 100 : 0;
  
  // Display volume: when muted show 0, otherwise show actual volume
  const displayVolume = isMuted ? 0 : volume;
  
  // Volume icon based on level
  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full h-full bg-black rounded-lg overflow-hidden group select-none",
        className
      )}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        if (isPlaying && !isDraggingVolume) {
          setShowControls(false);
        }
        if (!isDraggingVolume) {
          setShowVolumeSlider(false);
        }
      }}
      tabIndex={0}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="w-full h-full object-contain"
        crossOrigin="use-credentials"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onError={onError}
        playsInline
      />

      {/* Buffering Indicator */}
      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Center Play Button (when paused) */}
      {!isPlaying && !isBuffering && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <div className="w-20 h-20 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-2xl hover:scale-105 transition-transform">
            <Play className="w-10 h-10 text-gray-900 ml-1" fill="currentColor" />
          </div>
        </button>
      )}

      {/* Controls Overlay */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 transition-all duration-300",
          showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
        )}
      >
        {/* Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none" />

        {/* Controls Container */}
        <div className="relative px-4 pb-4 pt-12">
          {/* Progress Bar */}
          <div className="group/progress mb-3">
            <div 
              ref={progressBarRef}
              className="relative h-1 group-hover/progress:h-1.5 bg-white/20 rounded-full transition-all cursor-pointer"
              onMouseDown={handleProgressMouseDown}
            >
              {/* Buffered Progress */}
              <div
                className="absolute inset-y-0 left-0 bg-white/30 rounded-full pointer-events-none"
                style={{ width: `${bufferedPercentage}%` }}
              />
              {/* Current Progress */}
              <div
                className="absolute inset-y-0 left-0 bg-blue-500 rounded-full pointer-events-none"
                style={{ width: `${progressPercentage}%` }}
              />
              {/* Thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-blue-500 shadow-lg opacity-0 group-hover/progress:opacity-100 transition-opacity pointer-events-none"
                style={{ left: `calc(${progressPercentage}% - 6px)` }}
              />
            </div>
          </div>

          {/* Bottom Controls */}
          <div className="flex items-center justify-between gap-4">
            {/* Left Controls */}
            <div className="flex items-center gap-2">
              {/* Play/Pause */}
              <button
                onClick={togglePlay}
                className="p-2 rounded-full hover:bg-white/10 transition-colors"
                title={isPlaying ? 'Pause (k)' : 'Play (k)'}
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 text-white" fill="white" />
                ) : (
                  <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
                )}
              </button>

              {/* Skip Back */}
              <button
                onClick={() => skip(-10)}
                className="p-2 rounded-full hover:bg-white/10 transition-colors"
                title="Rewind 10s (←)"
              >
                <SkipBack className="w-4 h-4 text-white" />
              </button>

              {/* Skip Forward */}
              <button
                onClick={() => skip(10)}
                className="p-2 rounded-full hover:bg-white/10 transition-colors"
                title="Forward 10s (→)"
              >
                <SkipForward className="w-4 h-4 text-white" />
              </button>

              {/* Volume */}
              <div 
                className="flex items-center gap-1"
                onMouseEnter={() => setShowVolumeSlider(true)}
                onMouseLeave={() => !isDraggingVolume && setShowVolumeSlider(false)}
              >
                <button
                  onClick={toggleMute}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                  title={isMuted ? 'Unmute (m)' : 'Mute (m)'}
                >
                  <VolumeIcon className="w-5 h-5 text-white" />
                </button>
                
                {/* Custom Volume Slider */}
                <div 
                  className={cn(
                    "overflow-hidden transition-all duration-200",
                    showVolumeSlider || isDraggingVolume ? "w-20 opacity-100" : "w-0 opacity-0"
                  )}
                >
                  <div 
                    ref={volumeBarRef}
                    className="relative h-1.5 bg-white/20 rounded-full cursor-pointer mx-1"
                    onMouseDown={handleVolumeMouseDown}
                  >
                    {/* Volume Fill */}
                    <div
                      className="absolute inset-y-0 left-0 bg-white rounded-full pointer-events-none"
                      style={{ width: `${displayVolume * 100}%` }}
                    />
                    {/* Volume Thumb */}
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-lg pointer-events-none"
                      style={{ left: `calc(${displayVolume * 100}% - 6px)` }}
                    />
                  </div>
                </div>
              </div>

              {/* Time Display */}
              <span className="text-sm text-white/90 font-medium tabular-nums ml-2">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-1">
              {/* Settings (Playback Speed) */}
              <div className="relative">
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                  title="Settings"
                >
                  <Settings className="w-4 h-4 text-white" />
                </button>
                
                {showSettings && (
                  <div className="absolute bottom-full right-0 mb-2 bg-black/90 backdrop-blur-lg rounded-lg border border-white/10 p-2 min-w-[120px] shadow-xl">
                    <div className="text-xs text-white/60 px-2 py-1 mb-1">播放速度</div>
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                      <button
                        key={rate}
                        onClick={() => changePlaybackRate(rate)}
                        className={cn(
                          "w-full px-2 py-1.5 text-left text-sm rounded transition-colors",
                          playbackRate === rate
                            ? "bg-blue-500/20 text-blue-400"
                            : "text-white hover:bg-white/10"
                        )}
                      >
                        {rate === 1 ? '正常' : `${rate}x`}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* PiP */}
              <button
                onClick={togglePiP}
                className="p-2 rounded-full hover:bg-white/10 transition-colors"
                title="Picture in Picture"
              >
                <PictureInPicture2 className="w-4 h-4 text-white" />
              </button>

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-full hover:bg-white/10 transition-colors"
                title={isFullscreen ? 'Exit Fullscreen (f)' : 'Fullscreen (f)'}
              >
                {isFullscreen ? (
                  <Minimize className="w-4 h-4 text-white" />
                ) : (
                  <Maximize className="w-4 h-4 text-white" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Title Overlay (Top) */}
      {title && (
        <div
          className={cn(
            "absolute top-0 left-0 right-0 p-4 transition-all duration-300",
            showControls ? "opacity-100" : "opacity-0"
          )}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
          <h3 className="relative text-white font-medium text-sm truncate">{title}</h3>
        </div>
      )}
    </div>
  );
}
