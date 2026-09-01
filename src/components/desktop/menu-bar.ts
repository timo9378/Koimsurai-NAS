import type { AppCommand } from "@/lib/app-commands";
import type { AppType } from "@/store/window-store";

/**
 * 頂端選單列的內容。
 *
 * ⚠️ 這條選單列原本每一項都**沒有 handler** —— 約 40 個按下去完全沒有反應的
 * 項目，其中包括 `Container > Remove` 這種看起來會做事的。macOS 本身會把
 * 當下不能用的項目變灰，所以「做不到就變灰」既符合這個皮膚、也不再騙人。
 *
 * 規則：有 `command` 的才可以按，沒有的一律 disabled。要新增功能就是給它一個
 * command，而不是讓它繼續假裝自己會動。
 */
export type MenuCommand =
  /** 送給目前作用中視窗裡的 app（見 `lib/app-commands`）。 */
  | { readonly kind: "app"; readonly command: AppCommand }
  /** 開一個新視窗。 */
  | { readonly kind: "open"; readonly appType: AppType }
  /** 關掉目前作用中的視窗。 */
  | { readonly kind: "close" }
  /** 發一個全域事件（桌面本身只有一個，不需要作用域）。 */
  | { readonly kind: "event"; readonly event: string };

export interface MenuItem {
  readonly label: string;
  /** 沒有 command 的項目會變灰 —— 表示「還沒做」而不是「按了沒事」。 */
  readonly command?: MenuCommand;
}

export interface MenuBarConfig {
  readonly appName: string;
  readonly menus: readonly { readonly label: string; readonly items: readonly MenuItem[] }[];
}

const app = (command: AppCommand): MenuCommand => ({ kind: "app", command });

export function getMenuItemsForApp(appType: string | null): MenuBarConfig {
  switch (appType) {
    case "finder":
      return {
        appName: "Finder",
        menus: [
          {
            label: "File",
            items: [
              { label: "New Folder", command: app("new-folder") },
              { label: "New Window", command: { kind: "open", appType: "finder" } },
              { label: "Close Window", command: { kind: "close" } },
            ],
          },
          {
            label: "Edit",
            items: [
              { label: "Cut", command: app("clipboard-cut") },
              { label: "Copy", command: app("clipboard-copy") },
              { label: "Paste", command: app("clipboard-paste") },
              { label: "Select All", command: app("select-all") },
            ],
          },
          {
            label: "View",
            // 只有兩種檢視模式，欄位檢視與預覽窗格都還不存在。
            items: [
              { label: "as Icons", command: app("view-icons") },
              { label: "as List", command: app("view-list") },
              { label: "as Columns" },
              { label: "Show Preview" },
            ],
          },
          {
            label: "Go",
            items: [
              { label: "Back", command: app("nav-back") },
              { label: "Forward", command: app("nav-forward") },
              { label: "Enclosing Folder", command: app("nav-parent") },
              { label: "Home", command: app("nav-home") },
              { label: "Desktop", command: app("nav-desktop") },
            ],
          },
        ],
      };
    case "photos":
      return {
        appName: "Photos",
        menus: [
          { label: "File", items: [{ label: "Import" }, { label: "Export" }, { label: "Share" }] },
          {
            label: "Edit",
            items: [{ label: "Rotate" }, { label: "Crop" }, { label: "Adjust Color" }],
          },
          {
            label: "View",
            items: [{ label: "Show Sidebar" }, { label: "Zoom In" }, { label: "Zoom Out" }],
          },
        ],
      };
    case "terminal":
      return {
        appName: "Terminal",
        menus: [
          {
            label: "Shell",
            items: [
              { label: "New Window", command: { kind: "open", appType: "terminal" } },
              { label: "New Tab", command: app("new-tab") },
              // ⚠️ Close **Tab**，不是關視窗。第一版接成 `{ kind: "close" }`
              // —— 那會把整個終端機關掉，比停用還糟：使用者以為只會少一個分頁。
              { label: "Close Tab", command: app("close-tab") },
            ],
          },
          {
            label: "Edit",
            items: [
              { label: "Copy" },
              { label: "Paste" },
              { label: "Select All" },
              { label: "Clear" },
            ],
          },
          {
            label: "View",
            items: [{ label: "Increase Font Size" }, { label: "Decrease Font Size" }],
          },
        ],
      };
    case "docker":
      return {
        appName: "Docker Manager",
        menus: [
          { label: "File", items: [{ label: "Refresh" }, { label: "Settings" }] },
          {
            label: "Container",
            // ⚠️ 這四項看起來就像真的會動的容器操作。它們沒有實作，而
            // 「按了什麼都沒發生」對 Stop／Remove 這種操作是最糟的一種回饋。
            items: [
              { label: "Start" },
              { label: "Stop" },
              { label: "Restart" },
              { label: "Remove" },
            ],
          },
          { label: "View", items: [{ label: "Show Logs" }, { label: "Show Stats" }] },
        ],
      };
    default:
      return {
        appName: "Desktop",
        menus: [
          {
            label: "File",
            items: [
              // 桌面只有一個，所以沿用既有的全域事件（DesktopIcons 在聽）。
              { label: "New Folder", command: { kind: "event", event: "desktop-create-folder" } },
              { label: "Get Info" },
            ],
          },
          { label: "Edit", items: [{ label: "Undo" }, { label: "Redo" }] },
          { label: "View", items: [{ label: "Clean Up" }, { label: "Sort By" }] },
        ],
      };
  }
}
