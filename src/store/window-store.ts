import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AppType = 'finder' | 'launchpad' | 'photos' | 'docker' | 'settings' | 'trash' | 'calculator' | 'terminal' | 'dashboard' | 'preview';
export type DockPosition = 'bottom' | 'left' | 'right';
export type SnapState = 'left' | 'right' | 'maximize' | null;

export interface WindowState {
  id: string;
  appType: AppType;
  title: string;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  snapState: SnapState;
  restoreBounds: { position: { x: number; y: number }; size: { width: number; height: number } } | null;
  zIndex: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
  props?: any;
  appState?: any;
  wasMinimizedByShowDesktop?: boolean;
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
  maximizeWindow: (id: string, bounds?: { position: { x: number; y: number }; size: { width: number; height: number } }) => void;
  snapWindow: (id: string, snapState: SnapState, bounds: { position: { x: number; y: number }; size: { width: number; height: number } }) => void;
  restoreWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  updateWindowPosition: (id: string, position: { x: number; y: number }) => void;
  updateWindowSize: (id: string, size: { width: number; height: number }) => void;
  updateWindowAppState: (id: string, state: any) => void;
  setDockPosition: (position: DockPosition) => void;

  // Show Desktop Feature
  showDesktop: boolean;
  toggleShowDesktop: () => void;
}

export const useWindowStore = create(
  persist<WindowStore, [], [], Pick<WindowStore, 'windowHistory' | 'dockPosition'>>(
    (set, get) => ({
      windows: [],
      activeWindowId: null,
      nextZIndex: 100,
      windowHistory: {},
      dockPosition: 'bottom',
      showDesktop: false,

      toggleShowDesktop: () => {
        const { showDesktop, windows } = get();
        const newShowDesktop = !showDesktop;

        if (newShowDesktop) {
          const visibleWindowIds = windows.filter(w => !w.isMinimized).map(w => w.id);

          set((state) => ({
            showDesktop: true,
            windows: state.windows.map(w => visibleWindowIds.includes(w.id) ? { ...w, isMinimized: true, wasMinimizedByShowDesktop: true } : w)
          }));
        } else {
          set((state) => ({
            showDesktop: false,
            windows: state.windows.map(w => (w as any).wasMinimizedByShowDesktop ? { ...w, isMinimized: false, wasMinimizedByShowDesktop: undefined } : w)
          }));
        }
      },

      openWindow: (appType, title, props) => {
        const { windows, nextZIndex, focusWindow, windowHistory } = get();

        // Reset show desktop state
        set({ showDesktop: false });

        // Apps that can have multiple instances
        const multiInstanceApps: AppType[] = ['finder', 'terminal', 'preview', 'photos'];

        // For singleton apps (not in multiInstanceApps), focus existing window instead of creating new one
        if (!multiInstanceApps.includes(appType)) {
          const existingWindow = windows.find(w => w.appType === appType);
          if (existingWindow) {
            focusWindow(existingWindow.id);
            return;
          }
        }

        const id = crypto.randomUUID();
        const defaultTitle = title || appType.charAt(0).toUpperCase() + appType.slice(1);

        // Default sizes for different app types
        const defaultSizes: Partial<Record<AppType, { width: number; height: number }>> = {
          calculator: { width: 320, height: 500 },
          terminal: { width: 700, height: 500 },
          photos: { width: 1000, height: 700 },
          preview: { width: 900, height: 700 },
          settings: { width: 600, height: 500 },
        };

        // Restore from history if available
        const history = windowHistory[appType];
        const position = history ? history.position : { x: 100 + windows.length * 20, y: 100 + windows.length * 20 };
        const size = history ? history.size : (defaultSizes[appType] || { width: 800, height: 600 });

        const newWindow: WindowState = {
          id,
          appType,
          title: defaultTitle,
          isOpen: true,
          isMinimized: false,
          isMaximized: false,
          snapState: null,
          restoreBounds: null,
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

          // Clean up persisted Finder tab state from localStorage
          if (windowToClose.appType === 'finder' && typeof window !== 'undefined') {
            try {
              localStorage.removeItem(`finder-tabs-${id}`);
            } catch {
              // Silently ignore
            }
          }
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

      maximizeWindow: (id, bounds) => {
        set((state) => {
          const window = state.windows.find(w => w.id === id);
          if (!window) return state;

          // If already maximized, do nothing
          if (window.isMaximized) return state;

          // Save current state before maximizing
          const restoreBounds = {
            position: window.position,
            size: window.size
          };

          // 統一使用一套邏輯：如果沒有提供bounds，計算預設的全螢幕尺寸（帶邊距）
          const screenWidth = typeof globalThis.window !== 'undefined' ? globalThis.window.innerWidth : 1920;
          const screenHeight = typeof globalThis.window !== 'undefined' ? globalThis.window.innerHeight : 1080;

          // 使用與預覽一致的邊距：top: 48px, left/right: 24px, bottom: 48px (top bar 40 + dock ~48)
          const newPos = bounds ? bounds.position : { x: 24, y: 48 };
          const newSize = bounds ? bounds.size : {
            width: screenWidth - 48,  // 24px on each side
            height: screenHeight - 96  // 48px top + 48px bottom
          };

          return {
            windows: state.windows.map((w) =>
              w.id === id ? {
                ...w,
                isMaximized: true,
                snapState: 'maximize',
                isMinimized: false,
                restoreBounds: w.restoreBounds || restoreBounds,
                position: newPos,
                size: newSize
              } : w
            ),
            activeWindowId: id,
            nextZIndex: state.nextZIndex + 1,
          };
        });
      },

      snapWindow: (id, snapState, bounds) => {
        set((state) => {
          const window = state.windows.find(w => w.id === id);
          if (!window) return state;

          // If already in this snap state, just update bounds (optional, but consistent)
          // Save current state only if we are not already snapped or maximized
          // (or if we are moving from one snap to another, we might want to keep the ORIGINAL restore bounds)

          const restoreBounds = window.restoreBounds || {
            position: window.position,
            size: window.size
          };

          return {
            windows: state.windows.map((w) =>
              w.id === id ? {
                ...w,
                isMaximized: snapState === 'maximize',
                snapState,
                isMinimized: false,
                restoreBounds,
                position: bounds.position,
                size: bounds.size
              } : w
            ),
            activeWindowId: id,
            nextZIndex: state.nextZIndex + 1,
          };
        });
      },

      restoreWindow: (id) => {
        set((state) => ({
          showDesktop: false,
          windows: state.windows.map((w) => {
            if (w.id !== id) return w;

            // Use restoreBounds if available, otherwise default
            const targetPos = w.restoreBounds?.position || w.position;
            const targetSize = w.restoreBounds?.size || w.size;

            return {
              ...w,
              isMaximized: false,
              snapState: null,
              isMinimized: false,
              position: targetPos,
              size: targetSize,
              restoreBounds: null
            };
          }),
          activeWindowId: id,
          nextZIndex: state.nextZIndex + 1,
        }));
      },

      focusWindow: (id) => {
        set((state) => {
          const window = state.windows.find((w) => w.id === id);
          if (!window) return state;

          return {
            showDesktop: false,
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