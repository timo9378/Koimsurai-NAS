// 內部拖拉移動的 dataTransfer 標記 — 用來區分「檔案 → 資料夾/路徑 搬移」與「OS 拖檔上傳」。
// FileList(發起拖移)/ Finder / Toolbar(breadcrumb drop)/ DesktopLayout 共用。
export const MOVE_MIME = "application/x-koimsurai-move";
