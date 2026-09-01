/**
 * 從頂端選單列送一個指令給**某一個視窗**裡的 app。
 *
 * ⚠️ 一定要帶 windowId。桌面可以同時開好幾個 Finder，而選單列的指令只該作用在
 * 目前作用中的那一個 —— 用無差別的 `window.dispatchEvent(new Event("finder-back"))`
 * 會讓每一個 Finder 都往回走一步（既有的 `desktop-create-folder` 沒有這個問題，
 * 因為桌面只有一個）。
 */
export type AppCommand =
  | "new-folder"
  | "select-all"
  | "nav-back"
  | "nav-forward"
  | "nav-parent"
  | "nav-home"
  | "nav-desktop"
  | "view-icons"
  | "view-list"
  | "new-tab"
  | "close-tab"
  | "clipboard-copy"
  | "clipboard-cut"
  | "clipboard-paste";

const EVENT = "app-command";

const NOOP = (): void => {
  // 沒有訂閱任何東西，所以也沒有東西要取消。
};

interface AppCommandDetail {
  windowId: string;
  command: AppCommand;
}

export function dispatchAppCommand(windowId: string, command: AppCommand): void {
  window.dispatchEvent(new CustomEvent<AppCommandDetail>(EVENT, { detail: { windowId, command } }));
}

/**
 * 訂閱送給這個視窗的指令，回傳取消訂閱的函式。
 *
 * `windowId` 是 undefined 時（元件不在視窗系統裡）不訂閱任何東西 ——
 * 不然它會收到別人的指令。
 */
export function onAppCommand(
  windowId: string | undefined,
  handler: (command: AppCommand) => void,
): () => void {
  // eslint-disable-next-line no-empty-function -- 沒有東西要取消訂閱，回一個什麼都不做的
  if (windowId === undefined) return NOOP;

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<AppCommandDetail>).detail;
    if (detail.windowId === windowId) handler(detail.command);
  };

  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
