import { create } from 'zustand';

interface AudioPlayerState {
  // Current playing audio
  isActive: boolean;
  isPlaying: boolean;
  isMiniPlayer: boolean;
  currentSrc: string | null;
  currentTitle: string | null;
  currentArtist: string | null;
  currentAlbumArt: string | null;
  currentTime: number;
  duration: number;
  windowId: string | null;
  volume: number;
  isMuted: boolean;
  
  // Reference to the active audio element
  activeAudioRef: HTMLAudioElement | null;
  
  // Actions
  setAudioState: (state: Partial<AudioPlayerState>) => void;
  registerAudio: (src: string, audioRef: HTMLAudioElement, windowId?: string, title?: string, artist?: string, albumArt?: string) => void;
  unregisterAudio: (src: string) => void;
  play: (src: string, title?: string, artist?: string, albumArt?: string, windowId?: string) => void;
  pause: () => void;
  stop: () => void;
  toggleMiniPlayer: (show: boolean) => void;
  updateProgress: (currentTime: number, duration: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
}

// Storage keys
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

export const useAudioPlayerStore = create<AudioPlayerState>((set, get) => ({
  isActive: false,
  isPlaying: false,
  isMiniPlayer: false,
  currentSrc: null,
  currentTitle: null,
  currentArtist: null,
  currentAlbumArt: null,
  currentTime: 0,
  duration: 0,
  windowId: null,
  volume: typeof window !== 'undefined' ? getSavedVolume() : 1,
  isMuted: typeof window !== 'undefined' ? getSavedMuted() : false,
  activeAudioRef: null,

  setAudioState: (state) => set(state),

  // Register an audio element - this will stop any other playing audio
  registerAudio: (src, audioRef, windowId, title, artist, albumArt) => {
    const { activeAudioRef, currentSrc, volume, isMuted } = get();
    
    // If there's already an active audio and it's different, stop it
    if (activeAudioRef && currentSrc !== src) {
      activeAudioRef.pause();
      activeAudioRef.currentTime = 0;
    }
    
    // Apply saved volume to new audio
    audioRef.volume = volume;
    audioRef.muted = isMuted;
    
    set({
      isActive: true,
      currentSrc: src,
      currentTitle: title || null,
      currentArtist: artist || null,
      currentAlbumArt: albumArt || null,
      windowId: windowId || null,
      activeAudioRef: audioRef,
    });
  },

  unregisterAudio: (src) => {
    const { currentSrc } = get();
    if (currentSrc === src) {
      set({
        isActive: false,
        isPlaying: false,
        isMiniPlayer: false,
        currentSrc: null,
        currentTitle: null,
        currentArtist: null,
        currentAlbumArt: null,
        currentTime: 0,
        duration: 0,
        windowId: null,
        activeAudioRef: null,
      });
    }
  },

  play: (src, title, artist, albumArt, windowId) => {
    set({
      isActive: true,
      isPlaying: true,
      currentSrc: src,
      currentTitle: title || null,
      currentArtist: artist || null,
      currentAlbumArt: albumArt || null,
      windowId: windowId || null,
    });
  },

  pause: () => {
    set({ isPlaying: false });
  },

  stop: () => {
    const { activeAudioRef } = get();
    if (activeAudioRef) {
      activeAudioRef.pause();
      activeAudioRef.currentTime = 0;
    }
    set({
      isActive: false,
      isPlaying: false,
      isMiniPlayer: false,
      currentSrc: null,
      currentTitle: null,
      currentArtist: null,
      currentAlbumArt: null,
      currentTime: 0,
      duration: 0,
      windowId: null,
      activeAudioRef: null,
    });
  },

  toggleMiniPlayer: (show) => {
    set({ isMiniPlayer: show });
  },

  updateProgress: (currentTime, duration) => {
    set({ currentTime, duration });
  },

  setVolume: (volume) => {
    const { activeAudioRef } = get();
    if (activeAudioRef) {
      activeAudioRef.volume = volume;
      activeAudioRef.muted = false;
    }
    sessionStorage.setItem(VOLUME_STORAGE_KEY, volume.toString());
    sessionStorage.setItem(MUTED_STORAGE_KEY, 'false');
    set({ volume, isMuted: false });
  },

  toggleMute: () => {
    const { activeAudioRef, isMuted, volume } = get();
    const newMuted = !isMuted;
    if (activeAudioRef) {
      activeAudioRef.muted = newMuted;
      if (!newMuted && volume === 0) {
        activeAudioRef.volume = 0.5;
        set({ volume: 0.5 });
      }
    }
    sessionStorage.setItem(MUTED_STORAGE_KEY, newMuted.toString());
    set({ isMuted: newMuted });
  },
}));
