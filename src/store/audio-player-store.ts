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
  
  // Actions
  setAudioState: (state: Partial<AudioPlayerState>) => void;
  play: (src: string, title?: string, artist?: string, albumArt?: string, windowId?: string) => void;
  pause: () => void;
  stop: () => void;
  toggleMiniPlayer: (show: boolean) => void;
  updateProgress: (currentTime: number, duration: number) => void;
}

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

  setAudioState: (state) => set(state),

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
    });
  },

  toggleMiniPlayer: (show) => {
    set({ isMiniPlayer: show });
  },

  updateProgress: (currentTime, duration) => {
    set({ currentTime, duration });
  },
}));
