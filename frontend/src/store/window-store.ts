import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AppType = 'finder' | 'launchpad' | 'photos' | 'docker' | 'settings' | 'trash' | 'calculator' | 'terminal' | 'dashboard' | 'preview';
export type DockPosition = 'bottom' | 'left' | 'right';

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
  props?: any;
  appState?: any;
}

interface WindowStore {
  windows: WindowState[];
  activeWindowId: string | null;
  nextZIndex: number;
  windowHistory: Record<string, { position: { x: number; y: number }; size: { width: number; height: number } }>;
  dockPosition: DockPosition;

  openWindow: (appType: AppType, title?: string, props?: any) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  updateWindowPosition: (id: string, position: { x: number; y: number }) => void;
  updateWindowSize: (id: string, size: { width: number; height: number }) => void;
  updateWindowAppState: (id: string, state: any) => void;
  setDockPosition: (position: DockPosition) => void;
}

export const useWindowStore = create(
  persist<WindowStore, [], [], Pick<WindowStore, 'windowHistory' | 'dockPosition'>>(
    (set, get) => ({
      windows: [],
      activeWindowId: null,
      nextZIndex: 100,
      windowHistory: {},
      dockPosition: 'bottom',

      openWindow: (appType, title, props) => {
    const { windows, nextZIndex, focusWindow, windowHistory } = get();

    if (!props && appType !== 'preview') {
      const existingWindow = windows.find(w => w.appType === appType);
      if (existingWindow) {
        focusWindow(existingWindow.id);
        return;
      }
    }
    
    const id = crypto.randomUUID();
    const defaultTitle = title || appType.charAt(0).toUpperCase() + appType.slice(1);
    
    // Restore from history if available
    const history = windowHistory[appType];
    const position = history ? history.position : { x: 100 + windows.length * 20, y: 100 + windows.length * 20 };
    const size = history ? history.size : { width: 800, height: 600 };

    const newWindow: WindowState = {
      id,
      appType,
      title: defaultTitle,
      isOpen: true,
      isMinimized: false,
      isMaximized: false,
      zIndex: nextZIndex,
      position,
      size,
      props,
    };

    set({
      windows: [...windows, newWindow],
      activeWindowId: id,
      nextZIndex: nextZIndex + 1,
    });
  },

  closeWindow: (id) => {
    const { windows } = get();
    const windowToClose = windows.find(w => w.id === id);
    
    if (windowToClose) {
      set((state) => ({
        windowHistory: {
          ...state.windowHistory,
          [windowToClose.appType]: {
            position: windowToClose.position,
            size: windowToClose.size
          }
        }
      }));
    }

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

      updateWindowAppState: (id, appState) => {
        set((state) => ({
          windows: state.windows.map((w) =>
            w.id === id ? { ...w, appState: { ...w.appState, ...appState } } : w
          ),
        }));
      },

      setDockPosition: (position) => {
        set({ dockPosition: position });
      },
    }),
    {
      name: 'window-storage',
      partialize: (state) => ({
        windowHistory: state.windowHistory,
        dockPosition: state.dockPosition
      }),
    }
  )
);