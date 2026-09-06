import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FileInfo } from "@/types/api";

import { currentViewport, fitToViewport } from "./window-geometry";

/**
 * ⚠️ `AppType` 由這個陣列推導，不要反過來手寫聯集再另外維護一份清單 ——
 * 兩者一定會走鐘，而走鐘的症狀是「執行期檢查漏掉某個 app」這種安靜的錯。
 */
export const APP_TYPES = [
  "finder",
  "launchpad",
  "photos",
  "docker",
  "settings",
  "trash",
  "calculator",
  "terminal",
  "dashboard",
  "preview",
] as const;

export type AppType = (typeof APP_TYPES)[number];

/** 從 DOM 屬性、網址之類的地方拿到的字串要先過這裡才能當 `AppType` 用。 */
export function isAppType(value: string): value is AppType {
  return (APP_TYPES as readonly string[]).includes(value);
}
export type DockPosition = "bottom" | "left" | "right";
export type SnapState = "left" | "right" | "maximize" | null;

/**
 * 每個 app 開窗時可以帶的參數。
 *
 * 原本 `props?: any` 一路傳到 `WindowContent` 再展開給元件，等於整條路徑上
 * 沒有任何一步會告訴你「開 Finder 卻傳了 preview 的參數」。這裡跟 `AppType`
 * 綁在一起之後，`openWindow("finder", "x", { file })` 在編譯期就會紅。
 *
 * ⚠️ 新增 AppType 時這裡**必須**跟著加一筆，否則 `AppProps[K]` 索引不到。
 *    不吃參數的 app 寫 `EmptyProps`。
 */
type EmptyProps = Record<string, never>;

export interface AppProps {
  finder: { initialPath?: string; navigateTo?: string };
  preview: { file: FileInfo };
  /** 有 containerId 就接那個容器的 shell，沒有就是一般 terminal */
  terminal: { containerId?: string };
  launchpad: EmptyProps;
  photos: EmptyProps;
  docker: EmptyProps;
  settings: EmptyProps;
  trash: EmptyProps;
  calculator: EmptyProps;
  dashboard: EmptyProps;
}

/**
 * 視窗自己回寫、給別人讀的狀態（跟 `AppProps` 的差別是方向：props 是開窗時
 * 傳進去，appState 是開著的視窗往外報告）。目前只有 Finder 用得到 ——
 * Dock 的縮圖與 DesktopIcons 的「跳到這個路徑」都靠它。
 */
export interface AppStates {
  finder: { currentPath?: string[]; navigateTo?: string };
  preview: EmptyProps;
  terminal: EmptyProps;
  launchpad: EmptyProps;
  photos: EmptyProps;
  docker: EmptyProps;
  settings: EmptyProps;
  trash: EmptyProps;
  calculator: EmptyProps;
  dashboard: EmptyProps;
}

interface WindowBase {
  id: string;
  title: string;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  snapState: SnapState;
  restoreBounds: {
    position: { x: number; y: number };
    size: { width: number; height: number };
  } | null;
  zIndex: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
  wasMinimizedByShowDesktop?: boolean;
}

/**
 * 以 `appType` 為判別式的聯集：narrow 到 `appType === "preview"` 之後，
 * `props` 就是 `{ file: FileInfo }`，不是 `any`。
 */
export type WindowState = {
  [K in AppType]: WindowBase & { appType: K; props?: AppProps[K]; appState?: AppStates[K] };
}[AppType];

interface WindowStore {
  windows: WindowState[];
  activeWindowId: string | null;
  nextZIndex: number;
  windowHistory: Record<
    string,
    { position: { x: number; y: number }; size: { width: number; height: number } }
  >;
  dockPosition: DockPosition;

  openWindow: <K extends AppType>(appType: K, title?: string, props?: AppProps[K]) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (
    id: string,
    bounds?: { position: { x: number; y: number }; size: { width: number; height: number } },
  ) => void;
  snapWindow: (
    id: string,
    snapState: SnapState,
    bounds: { position: { x: number; y: number }; size: { width: number; height: number } },
  ) => void;
  restoreWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  updateWindowPosition: (id: string, position: { x: number; y: number }) => void;
  updateWindowSize: (id: string, size: { width: number; height: number }) => void;
  updateWindowAppState: (id: string, state: AppStates[AppType]) => void;
  setDockPosition: (position: DockPosition) => void;

  // Show Desktop Feature
  showDesktop: boolean;
  toggleShowDesktop: () => void;
}

export const useWindowStore = create(
  persist<WindowStore, [], [], Pick<WindowStore, "windowHistory" | "dockPosition">>(
    (set, get) => ({
      windows: [],
      activeWindowId: null,
      nextZIndex: 100,
      windowHistory: {},
      dockPosition: "bottom",
      showDesktop: false,

      toggleShowDesktop: () => {
        const { showDesktop, windows } = get();
        const newShowDesktop = !showDesktop;

        if (newShowDesktop) {
          const visibleWindowIds = windows.filter((w) => !w.isMinimized).map((w) => w.id);

          set((state) => ({
            showDesktop: true,
            windows: state.windows.map((w) =>
              visibleWindowIds.includes(w.id)
                ? { ...w, isMinimized: true, wasMinimizedByShowDesktop: true }
                : w,
            ),
          }));
        } else {
          set((state) => ({
            showDesktop: false,
            windows: state.windows.map((w) =>
              w.wasMinimizedByShowDesktop
                ? { ...w, isMinimized: false, wasMinimizedByShowDesktop: undefined }
                : w,
            ),
          }));
        }
      },

      openWindow: (appType, title, props) => {
        const { windows, nextZIndex, focusWindow, windowHistory } = get();

        // Reset show desktop state
        set({ showDesktop: false });

        // Apps that can have multiple instances
        const multiInstanceApps: AppType[] = ["finder", "terminal", "preview", "photos"];

        // For singleton apps (not in multiInstanceApps), focus existing window instead of creating new one
        if (!multiInstanceApps.includes(appType)) {
          const existingWindow = windows.find((w) => w.appType === appType);
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
        // ⚠️ 夾進畫面之後才用。原本是直接吃這些值 —— preview 的 900×700 開在
        // `y = 100 + 已開視窗數 × 20`，在 1280×720 的畫面上第二個視窗就是
        // 120 + 700 = 820 > 720，底部 100px 在畫面外，視窗底部的控制項點不到。
        // 從 history 還原的也要夾：上次是在大螢幕上關掉的話，換到小螢幕會重現同樣的問題。
        const { position, size } = fitToViewport(
          {
            position: history
              ? history.position
              : { x: 100 + windows.length * 20, y: 100 + windows.length * 20 },
            size: history ? history.size : (defaultSizes[appType] ?? { width: 800, height: 600 }),
          },
          currentViewport(),
        );

        // ⚠️ 這個 cast 是必要的：`WindowState` 是以 appType 判別的聯集，而 TS
        // 無法證明「`appType: K` 這一筆的 props 型別就是 `AppProps[K]`」——
        // 兩者的關聯只有我們知道。呼叫端仍然被泛型簽章擋著，安全網在那裡。
        const newWindow = {
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
        } as WindowState;

        set({
          windows: [...windows, newWindow],
          activeWindowId: id,
          nextZIndex: nextZIndex + 1,
        });
      },

      closeWindow: (id) => {
        const { windows } = get();
        const windowToClose = windows.find((w) => w.id === id);

        if (windowToClose) {
          set((state) => ({
            windowHistory: {
              ...state.windowHistory,
              [windowToClose.appType]: {
                position: windowToClose.position,
                size: windowToClose.size,
              },
            },
          }));

          // Clean up persisted Finder tab state from localStorage
          if (windowToClose.appType === "finder" && typeof window !== "undefined") {
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
          windows: state.windows.map((w) => (w.id === id ? { ...w, isMinimized: true } : w)),
          activeWindowId: state.activeWindowId === id ? null : state.activeWindowId,
        }));
      },

      maximizeWindow: (id, bounds) => {
        set((state) => {
          const window = state.windows.find((w) => w.id === id);
          if (!window) return state;

          // If already maximized, do nothing
          if (window.isMaximized) return state;

          // Save current state before maximizing
          const restoreBounds = {
            position: window.position,
            size: window.size,
          };

          // 統一使用一套邏輯：如果沒有提供bounds，計算預設的全螢幕尺寸（帶邊距）
          const screenWidth =
            typeof globalThis.window !== "undefined" ? globalThis.window.innerWidth : 1920;
          const screenHeight =
            typeof globalThis.window !== "undefined" ? globalThis.window.innerHeight : 1080;

          // 使用與預覽一致的邊距：top: 48px, left/right: 24px, bottom: 48px (top bar 40 + dock ~48)
          const newPos = bounds ? bounds.position : { x: 24, y: 48 };
          const newSize = bounds
            ? bounds.size
            : {
                width: screenWidth - 48, // 24px on each side
                height: screenHeight - 96, // 48px top + 48px bottom
              };

          return {
            windows: state.windows.map((w) =>
              w.id === id
                ? {
                    ...w,
                    isMaximized: true,
                    snapState: "maximize",
                    isMinimized: false,
                    restoreBounds: w.restoreBounds ?? restoreBounds,
                    position: newPos,
                    size: newSize,
                  }
                : w,
            ),
            activeWindowId: id,
            nextZIndex: state.nextZIndex + 1,
          };
        });
      },

      snapWindow: (id, snapState, bounds) => {
        set((state) => {
          const window = state.windows.find((w) => w.id === id);
          if (!window) return state;

          // If already in this snap state, just update bounds (optional, but consistent)
          // Save current state only if we are not already snapped or maximized
          // (or if we are moving from one snap to another, we might want to keep the ORIGINAL restore bounds)

          const restoreBounds = window.restoreBounds ?? {
            position: window.position,
            size: window.size,
          };

          return {
            windows: state.windows.map((w) =>
              w.id === id
                ? {
                    ...w,
                    isMaximized: snapState === "maximize",
                    snapState,
                    isMinimized: false,
                    restoreBounds,
                    position: bounds.position,
                    size: bounds.size,
                  }
                : w,
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
            const targetPos = w.restoreBounds?.position ?? w.position;
            const targetSize = w.restoreBounds?.size ?? w.size;

            return {
              ...w,
              isMaximized: false,
              snapState: null,
              isMinimized: false,
              position: targetPos,
              size: targetSize,
              restoreBounds: null,
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
              w.id === id ? { ...w, zIndex: state.nextZIndex, isMinimized: false } : w,
            ),
          };
        });
      },

      updateWindowPosition: (id, position) => {
        set((state) => ({
          windows: state.windows.map((w) => (w.id === id ? { ...w, position } : w)),
        }));
      },

      updateWindowSize: (id, size) => {
        set((state) => ({
          windows: state.windows.map((w) => (w.id === id ? { ...w, size } : w)),
        }));
      },

      updateWindowAppState: (id, appState) => {
        set((state) => ({
          windows: state.windows.map((w) =>
            w.id === id ? { ...w, appState: { ...w.appState, ...appState } } : w,
          ),
        }));
      },

      setDockPosition: (position) => {
        set({ dockPosition: position });
      },
    }),
    {
      name: "window-storage",
      partialize: (state) => ({
        windowHistory: state.windowHistory,
        dockPosition: state.dockPosition,
      }),
    },
  ),
);
