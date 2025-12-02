import { create } from 'zustand';

export type AppType = 'finder' | 'launchpad' | 'photos' | 'docker' | 'settings' | 'trash' | 'calculator' | 'terminal' | 'dashboard';

export interface WindowState {
  id: string;
  appType: AppType;
  title: string;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

interface WindowStore {
  windows: WindowState[];
  activeWindowId: string | null;
  nextZIndex: number;

  openWindow: (appType: AppType, title?: string) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  updateWindowPosition: (id: string, position: { x: number; y: number }) => void;
  updateWindowSize: (id: string, size: { width: number; height: number }) => void;
}

export const useWindowStore = create<WindowStore>((set, get) => ({
  windows: [],
  activeWindowId: null,
  nextZIndex: 100,

  openWindow: (appType, title) => {
    const { windows, nextZIndex } = get();
    
    const id = crypto.randomUUID();
    const defaultTitle = title || appType.charAt(0).toUpperCase() + appType.slice(1);
    
    const newWindow: WindowState = {
      id,
      appType,
      title: defaultTitle,
      isOpen: true,
      isMinimized: false,
      isMaximized: false,
      zIndex: nextZIndex,
      position: { x: 100 + windows.length * 20, y: 100 + windows.length * 20 },
      size: { width: 800, height: 600 },
    };

    set({
      windows: [...windows, newWindow],
      activeWindowId: id,
      nextZIndex: nextZIndex + 1,
    });
  },

  closeWindow: (id) => {
    set((state) => ({
      windows: state.windows.filter((w) => w.id !== id),
      activeWindowId: state.activeWindowId === id ? null : state.activeWindowId,
    }));
  },

  minimizeWindow: (id) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, isMinimized: true } : w
      ),
      activeWindowId: state.activeWindowId === id ? null : state.activeWindowId,
    }));
  },

  maximizeWindow: (id) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, isMaximized: true, isMinimized: false } : w
      ),
      activeWindowId: id,
      nextZIndex: state.nextZIndex + 1,
    }));
  },

  restoreWindow: (id) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, isMaximized: false, isMinimized: false } : w
      ),
      activeWindowId: id,
      nextZIndex: state.nextZIndex + 1,
    }));
  },

  focusWindow: (id) => {
    set((state) => {
      const window = state.windows.find((w) => w.id === id);
      if (!window) return state;
      
      return {
        activeWindowId: id,
        nextZIndex: state.nextZIndex + 1,
        windows: state.windows.map((w) =>
          w.id === id ? { ...w, zIndex: state.nextZIndex, isMinimized: false } : w
        ),
      };
    });
  },

  updateWindowPosition: (id, position) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, position } : w
      ),
    }));
  },

  updateWindowSize: (id, size) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, size } : w
      ),
    }));
  },
}));