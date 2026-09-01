"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  useFiles,
  useDelete,
  usePermanentDelete,
  useRename,
  useToggleStar,
  useTrash,
  useRestoreFromTrash,
  useEmptyTrash,
  useFavorites,
  useDownload,
  useCreateShare,
  useCreateFolder,
  useBatchMove,
} from "@/features/files/api/useFiles";
import { getApiErrorStatus } from "@/lib/errors";
import { MOVE_MIME } from "@/lib/dnd";
import type { FileInfo, UploadLinkResponse } from "@/types/api";
import { useUploadStore } from "@/store/upload-store";
import { useWindowStore } from "@/store/window-store";
import { useFileUpload } from "@/features/files/hooks/useFileUpload"; // Updated import
import { collectTrashed } from "@/features/files/trash";
import { createFolderWithUniqueName } from "@/features/files/new-folder";
import { useUserTags, useFilesByTag } from "@/hooks/use-tags";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Sidebar } from "./finder/Sidebar";
import { Toolbar } from "./finder/Toolbar";
import { FileList } from "./finder/FileList";
import { ShareDialog, UploadLinkDialog, TagDialog } from "@/components/dialogs";
import { X, Plus } from "lucide-react";
import { activateOnKey } from "@/lib/a11y";
import { selectOnClick } from "./finder/selection";
import { dirName, joinPath, toApiPath } from "@/lib/paths";
import { filterByQuery, sortFiles } from "./finder/sorting";
import { planRename } from "./finder/rename";
import { getApiErrorMessage } from "@/lib/errors";
import { planMove } from "./finder/move";
import {
  addTab as addTabTo,
  closeTab as closeTabIn,
  createTab,
  restoreTabs,
  serializeTabs,
  type TabState,
  type TabsState,
  updateActiveTab as updateActiveTabIn,
} from "./finder/tabs";
import {
  currentPath as currentHistoryPath,
  goBack,
  goForward,
  pushPath,
  type NavHistory,
} from "./finder/history";

type ViewMode = "grid" | "list";

// Tab state interface
interface FinderProps {
  windowId?: string;
}

const TABS_STORAGE_KEY = "finder-tabs";

/** localStorage 的薄包裝。驗證與還原的規則在 finder/tabs.ts。 */
const restorePersistedTabs = (windowId?: string): TabsState | null => {
  if (!windowId || typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(`${TABS_STORAGE_KEY}-${windowId}`);
    return stored === null ? null : restoreTabs(JSON.parse(stored));
  } catch {
    return null;
  }
};

const persistTabs = (windowId: string | undefined, state: TabsState) => {
  if (!windowId || typeof window === "undefined") return;
  try {
    localStorage.setItem(`${TABS_STORAGE_KEY}-${windowId}`, JSON.stringify(serializeTabs(state)));
  } catch {
    // 配額滿或隱私模式 —— 分頁記不住不該讓 Finder 開不起來
  }
};

// 沒有作用分頁時的 fallback。放模組層級是為了維持同一個參考——見下方用到
// 它們的地方。兩者都只讀不寫。
// 滑鼠側鍵。MouseEvent.button 的規格編號：3 是「上一頁」那顆（實體上的第 4 鍵），
// 4 是「下一頁」。用具名常數是因為 3/4 這種裸數字在事件處理裡完全看不出意思。
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

const DEFAULT_HISTORY: string[] = ["/"];
const EMPTY_SELECTION = new Set<string>();

export const Finder = ({ windowId }: FinderProps) => {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  // ⚠️ tabs 與 activeTabId 存成**一個** state。
  //
  // 原本是兩個 useState，各自呼叫一次 loadPersistedTabs（也就是讀兩次
  // localStorage、parse 兩次），而且沒有任何東西保證 activeTabId 指向存在的
  // 分頁 —— 指不到的話 updateActiveTab 的 map 一個都對不到，導覽／選取／搜尋
  // 全部靜默失效，使用者點資料夾沒反應而且沒有錯誤。
  // 轉換規則與驗證見 finder/tabs.ts。
  const [tabsState, setTabsState] = useState<TabsState>(() => {
    const persisted = restorePersistedTabs(windowId);
    const initial = createTab("/");
    return persisted ?? { tabs: [initial], activeTabId: initial.id };
  });
  const { tabs, activeTabId } = tabsState;
  const setTabs = useCallback((updater: TabState[] | ((prev: TabState[]) => TabState[])) => {
    setTabsState((prev) => ({
      ...prev,
      tabs: typeof updater === "function" ? updater(prev.tabs) : updater,
    }));
  }, []);
  const setActiveTabId = useCallback((id: string) => {
    setTabsState((prev) => ({ ...prev, activeTabId: id }));
  }, []);

  // Get current tab
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  // Derived state from active tab
  const currentPath = activeTab?.path || "/";
  // ⚠️ fallback 用模組層級的常數，不要寫成 `?? ["/"]`：後者每次 render 都是新
  // 陣列，把它放進 useEffect 的相依就等於每 render 重跑一次（見下方同步
  // appState 的那個 effect）。
  const history = activeTab?.history ?? DEFAULT_HISTORY;
  const historyIndex = activeTab?.historyIndex ?? 0;
  // 把兩個分開存的欄位包成 finder/history.ts 認得的形狀。
  // 沒有改狀態的存放方式（tab 上仍然是 history + historyIndex），只是讓
  // 邊界判斷有一個唯一的出處。
  const navHistory: NavHistory = { entries: history, index: historyIndex };
  const isTrashMode = activeTab?.isTrashMode ?? false;
  const selectedTag = activeTab?.selectedTag || null;
  const selectedFiles = activeTab?.selectedFiles ?? EMPTY_SELECTION;
  const searchQuery = activeTab?.searchQuery || "";

  // ⚠️ 這些 wrapper 全部包 useCallback，只認 activeTabId。
  //
  // 它們被好幾個 useEffect 用到（鍵盤、滑鼠側鍵、外部導航請求）。不包的話每次
  // render 都是新的函式，寫進 deps 陣列等於「每 render 重掛一次 listener」，
  // 於是原本乾脆把它們從 deps 裡省略掉 —— 而省略掉就會抓到舊的 activeTabId，
  // 切分頁之後鍵盤操作會作用在**上一個**分頁上。包起來兩邊都對。
  const updateActiveTab = useCallback((updates: Partial<TabState>) => {
    setTabsState((prev) => updateActiveTabIn(prev, updates));
  }, []);

  const setCurrentPath = useCallback(
    (path: string) => updateActiveTab({ path }),
    [updateActiveTab],
  );
  const setHistory = useCallback(
    (h: string[] | ((prev: string[]) => string[])) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? { ...tab, history: typeof h === "function" ? h(tab.history) : h }
            : tab,
        ),
      );
    },
    [activeTabId, setTabs],
  );
  const setHistoryIndex = useCallback(
    (idx: number | ((prev: number) => number)) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? { ...tab, historyIndex: typeof idx === "function" ? idx(tab.historyIndex) : idx }
            : tab,
        ),
      );
    },
    [activeTabId, setTabs],
  );
  const setIsTrashMode = useCallback(
    (mode: boolean) => updateActiveTab({ isTrashMode: mode }),
    [updateActiveTab],
  );
  const setSelectedTag = useCallback(
    (tag: string | null) => updateActiveTab({ selectedTag: tag }),
    [updateActiveTab],
  );
  const setSelectedFiles = useCallback(
    (files: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? {
                ...tab,
                selectedFiles: typeof files === "function" ? files(tab.selectedFiles) : files,
              }
            : tab,
        ),
      );
    },
    [activeTabId, setTabs],
  );
  const setSearchQuery = useCallback(
    (query: string) => updateActiveTab({ searchQuery: query }),
    [updateActiveTab],
  );

  // Tab management functions
  // ⚠️ 用 functional update 而不是讀閉包裡的 tabs/activeTabId：
  // 連續兩次關分頁時，第二次讀到的會是還沒更新的狀態。
  const addTab = useCallback((path = "/") => {
    setTabsState((prev) => addTabTo(prev, path));
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setTabsState((prev) => closeTabIn(prev, tabId));
  }, []);

  // Persist tabs to localStorage whenever they change
  useEffect(() => {
    persistTabs(windowId, tabsState);
  }, [tabsState, windowId]);

  const [isDragging, setIsDragging] = useState(false);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingRenameFolder, setPendingRenameFolder] = useState<string | null>(null);

  const [isEmptyTrashConfirmOpen, setIsEmptyTrashConfirmOpen] = useState(false);
  const [isPermanentDeleteConfirmOpen, setIsPermanentDeleteConfirmOpen] = useState(false);
  const [filesToPermanentlyDelete, setFilesToPermanentlyDelete] = useState<string[]>([]);

  // Share dialog state
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [shareFile, setShareFile] = useState<FileInfo | null>(null);

  // Upload link dialog state
  const [isUploadLinkDialogOpen, setIsUploadLinkDialogOpen] = useState(false);

  // Tag dialog state (moved selectedTag to tab state)
  const [isTagDialogOpen, setIsTagDialogOpen] = useState(false);
  const [tagTargetFile, setTagTargetFile] = useState<FileInfo | null>(null);

  // Sort state (global across tabs)
  const [sortBy, setSortBy] = useState<"name" | "size" | "modified">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const { tasks: uploadTasks } = useUploadStore();
  const { openWindow, updateWindowAppState, windows } = useWindowStore();

  const { handleUploadFiles, resumeUpload } = useFileUpload(); // Use hook

  // Tag hooks
  const { data: userTags = [] } = useUserTags();
  const { data: taggedFiles = [], isLoading: isTagLoading } = useFilesByTag(selectedTag);

  useEffect(() => {
    if (!windowId) return;

    const state = useWindowStore.getState();
    const finderWindow = state.windows.find((w) => w.id === windowId);

    if (finderWindow) {
      if (JSON.stringify(finderWindow.appState?.currentPath) !== JSON.stringify(history)) {
        updateWindowAppState(windowId, { currentPath: history });
      }
    }
  }, [history, updateWindowAppState, windowId]);

  // Listen for external navigation requests (e.g., from desktop folder double-click)
  useEffect(() => {
    if (!windowId) return;

    const finderWindow = windows.find((w) => w.id === windowId);
    if (finderWindow?.appState?.navigateTo) {
      const targetPath = finderWindow.appState.navigateTo;
      // Clear the navigateTo state to prevent re-triggering
      updateWindowAppState(windowId, { navigateTo: undefined });

      const next = pushPath({ entries: history, index: historyIndex }, targetPath);
      // ⚠️ 一次寫完，不要呼叫五個 wrapper——那是五次整個 tabs 陣列的 map。
      //
      // ⚠️ 這裡直接用 setTabsState 而不是 setTabs 那個包裝：包裝被 effect
      // 呼叫的話，set-state-in-effect 的警告會指到**包裝的定義處**而不是這裡，
      // 於是下面那行抑制註解就蓋不到它。
      //
      // 這裡確實是「在 effect 裡 setState」，而那正是這個機制的本質：別的視窗
      // （例如桌面雙擊資料夾）把導航請求寫進 window store，這個 Finder 只能
      // 用 effect 去反應。沒有更直接的管道。
      // oxlint-disable-next-line @eslint-react/set-state-in-effect
      setTabsState((prev) =>
        updateActiveTabIn(prev, {
          isTrashMode: false,
          history: [...next.entries],
          historyIndex: next.index,
          path: targetPath,
          selectedFiles: new Set<string>(),
        }),
      );
    }
  }, [windows, updateWindowAppState, history, historyIndex, windowId]);

  const {
    data: files,
    isLoading,
    refetch,
  } = useFiles({
    path: currentPath,
    sortBy: sortBy,
    order: sortDirection,
    search: searchQuery,
  });
  const { data: trashFiles, isLoading: isTrashLoading, refetch: refetchTrash } = useTrash();
  const { data: favorites } = useFavorites();

  const deleteFile = useDelete();
  const permanentDelete = usePermanentDelete();
  const renameFile = useRename();
  const toggleStar = useToggleStar();
  const restoreFromTrash = useRestoreFromTrash();
  const emptyTrash = useEmptyTrash();
  const downloadFile = useDownload();
  const createShare = useCreateShare();
  const createFolder = useCreateFolder();
  const batchMove = useBatchMove();

  const currentFilesRaw = isTrashMode ? trashFiles : files;
  const isCurrentLoading = selectedTag ? isTagLoading : isTrashMode ? isTrashLoading : isLoading;

  // Convert tagged files to FileInfo format when in tag filter mode
  const tagFilteredFiles = React.useMemo((): FileInfo[] | undefined => {
    if (!selectedTag) return undefined;

    // Convert TaggedFile to FileInfo (return empty array if no files, not undefined)
    return taggedFiles.map((tf) => {
      // Find the tag color from userTags
      const tagInfo = userTags.find((t) => t.name === selectedTag);
      return {
        name: tf.name,
        path: tf.path,
        is_dir: tf.is_dir,
        size: tf.size,
        modified: tf.modified,
        mime_type: null,
        metadata: null,
        tags: [{ name: selectedTag, color: tagInfo?.color || null }],
        is_starred: false,
      };
    });
  }, [selectedTag, taggedFiles, userTags]);

  // Filter and sort files
  const currentFiles = React.useMemo(() => {
    // When filtering by tag, use the tagged files (need client-side sort since tag API may not support sorting)
    if (selectedTag) {
      const sourceFiles = tagFilteredFiles;
      if (!sourceFiles) return undefined;

      // ⚠️ 只有標籤檢視在前端排序 —— 那條路徑的資料來自 tag API、不分頁。
      // 一般檢視的排序在後端（`ORDER BY is_dir DESC, name COLLATE NOCASE`），
      // 因為分頁也是伺服器端的，對單一頁排序等於排錯。
      // 兩者的差異與對齊程度見 finder/sorting.ts 的說明。
      return sortFiles(filterByQuery(sourceFiles, searchQuery), sortBy, sortDirection);
    }

    // For normal file listing and trash mode: backend already handles sorting & search
    // Just return data as-is
    if (!currentFilesRaw) return undefined;
    return currentFilesRaw;
  }, [selectedTag, tagFilteredFiles, currentFilesRaw, searchQuery, sortBy, sortDirection]);

  const handleNavigate = (path: string) => {
    if (path === currentPath && !isTrashMode && !selectedTag) return;
    setIsTrashMode(false);
    setSelectedTag(null); // Clear tag filter when navigating
    const next = pushPath({ entries: history, index: historyIndex }, path);
    setHistory([...next.entries]);
    setHistoryIndex(next.index);
    setCurrentPath(path);
    setSelectedFiles(new Set());
  };

  // Watch for new folder to appear in files list, then enter rename mode
  //
  // ⚠️ 這裡必須是 effect：要等 useFiles 重新抓回列表、新資料夾那一列真的出現在
  //    DOM 裡，才有東西可以聚焦。放在 mutation 的 onSuccess 會太早。
  /* oxlint-disable @eslint-react/set-state-in-effect */
  useEffect(() => {
    if (pendingRenameFolder && files) {
      const newFolder = files.find((f) => f.name === pendingRenameFolder);
      if (newFolder) {
        setRenamingFile(newFolder.name);
        setRenameValue(newFolder.name);
        setPendingRenameFolder(null);
      }
    }
  }, [files, pendingRenameFolder]);
  /* oxlint-enable @eslint-react/set-state-in-effect */

  // Quick Look (Spacebar), Delete keys, and Select All (Cmd+A)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip keyboard handling when dialogs are open
      if (
        isShareDialogOpen ||
        isUploadLinkDialogOpen ||
        isEmptyTrashConfirmOpen ||
        isPermanentDeleteConfirmOpen ||
        isTagDialogOpen
      ) {
        return;
      }

      // Select All - Cmd+A / Ctrl+A
      if ((e.metaKey || e.ctrlKey) && e.key === "a" && !renamingFile) {
        e.preventDefault();
        e.stopPropagation();
        if (currentFiles) {
          setSelectedFiles(new Set(currentFiles.map((f) => f.name)));
        }
        return;
      }

      // Quick Look - Spacebar
      if (e.code === "Space") {
        if (selectedFiles.size === 1 && !renamingFile) {
          e.preventDefault();
          e.stopPropagation();
          const fileName = Array.from(selectedFiles)[0];
          const file = currentFiles?.find((f) => f.name === fileName);
          if (file) {
            const fullPath = file.path || joinPath(currentPath, file.name);
            openWindow("preview", file.name, { file: { ...file, path: fullPath } });
          }
        }
      }

      // Delete keys
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedFiles.size > 0 &&
        !renamingFile
      ) {
        // Ignore Backspace when an input/textarea is focused (avoid accidental deletion while typing)
        if (e.key === "Backspace") {
          const activeEl = document.activeElement;
          if (
            activeEl &&
            (activeEl.tagName === "INPUT" ||
              activeEl.tagName === "TEXTAREA" ||
              (activeEl as HTMLElement).isContentEditable)
          ) {
            return;
          }
        }

        e.preventDefault();
        e.stopPropagation();

        // ⚠️ 「永久刪除」只有在垃圾桶裡才成立。後端沒有「跳過垃圾桶直接刪」
        // 的端點 —— DELETE /api/files/{path} 做的就是移到垃圾桶。
        // 在一般目錄按 Shift+Delete 就走一般刪除，不要顯示一個做不到的確認框。
        if (e.shiftKey && isTrashMode) {
          // 送給 DELETE /api/trash/{filename} 的是**垃圾桶裡的檔名**，
          // 不是原始路徑（見 handlers/trash.rs 的 permanent_delete）。
          setFilesToPermanentlyDelete(Array.from(selectedFiles));
          setIsPermanentDeleteConfirmOpen(true);
        } else {
          // Delete: Move to trash with Toast notification + Undo
          const filesToDelete = Array.from(selectedFiles).map((fileName) => {
            const file = currentFiles?.find((f) => f.name === fileName);
            return {
              name: fileName,
              path: file?.path || joinPath(currentPath, fileName),
            };
          });

          setSelectedFiles(new Set());

          // ⚠️ 復原要送**垃圾桶檔名**，不是原檔名 —— 撞名時後端會存成
          // `原名.<timestamp>`，用原檔名會復原到上一次刪的那個同名檔案。
          // 也因此 toast 必須等刪除回來才跳：原本是先跳 toast 再射出 mutate，
          // 刪除失敗時使用者仍然看到「已移至垃圾桶」跟一個沒用的復原鈕。
          void Promise.allSettled(
            filesToDelete.map(({ path }) => deleteFile.mutateAsync(path)),
          ).then((results) => {
            const { trashed, failed } = collectTrashed(
              filesToDelete.map((f) => f.name),
              results,
            );

            if (failed.length > 0) {
              toast.error(
                failed.length === 1
                  ? `「${failed[0]}」刪除失敗`
                  : `${failed.length} 個項目刪除失敗`,
              );
            }
            if (trashed.length === 0) return;

            const label =
              trashed.length === 1
                ? `「${trashed[0]?.name}」已移至垃圾桶`
                : `${trashed.length} 個項目已移至垃圾桶`;

            toast(label, {
              action: {
                label: "復原",
                onClick: () => {
                  trashed.forEach(({ trashName }) => restoreFromTrash.mutate(trashName));
                },
              },
              duration: 6000,
            });
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [
    selectedFiles,
    currentFiles,
    renamingFile,
    isTrashMode,
    openWindow,
    currentPath,
    deleteFile,
    restoreFromTrash,
    isShareDialogOpen,
    isUploadLinkDialogOpen,
    isEmptyTrashConfirmOpen,
    isPermanentDeleteConfirmOpen,
    isTagDialogOpen,
    setSelectedFiles,
  ]);

  // Mouse back/forward button navigation
  const finderContainerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseButton = (e: MouseEvent) => {
      if (e.button !== MOUSE_BACK && e.button !== MOUSE_FORWARD) {
        return;
      }

      // Always prevent browser navigation for side buttons when in Finder
      if (!finderContainerRef.current?.contains(e.target as Node)) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // Skip navigation when dialogs are open
      if (
        isShareDialogOpen ||
        isUploadLinkDialogOpen ||
        isEmptyTrashConfirmOpen ||
        isPermanentDeleteConfirmOpen ||
        isTagDialogOpen
      ) {
        return;
      }

      // Only handle on mousedown for actual navigation
      if (e.type === "mousedown") {
        // 上面的 guard 已經把 button 收窄成「上一頁或下一頁」兩者之一，
        // 所以這裡不需要再判斷一次 forward。
        const nav: NavHistory = { entries: history, index: historyIndex };
        const next = e.button === MOUSE_BACK ? goBack(nav) : goForward(nav);

        const path = currentHistoryPath(next);
        if (path !== undefined && next.index !== nav.index) {
          setHistoryIndex(next.index);
          setCurrentPath(path);
        }
      }
    };

    // We need to intercept all these events to fully prevent browser back/forward
    const events = ["mousedown", "mouseup", "auxclick"] as const;
    events.forEach((event) => {
      window.addEventListener(event, handleMouseButton, { capture: true });
    });

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleMouseButton, { capture: true });
      });
    };
  }, [
    historyIndex,
    history,
    isShareDialogOpen,
    isUploadLinkDialogOpen,
    isEmptyTrashConfirmOpen,
    isPermanentDeleteConfirmOpen,
    isTagDialogOpen,
    setHistoryIndex,
    setCurrentPath,
  ]);

  const handleTrashMode = () => {
    setIsTrashMode(true);
    setSelectedFiles(new Set());
  };

  // 邊界判斷全部交給 finder/history.ts —— 那裡回傳同一個物件就表示沒動。
  const applyNav = (next: NavHistory) => {
    const path = currentHistoryPath(next);
    if (next === navHistory || path === undefined) return;
    setHistoryIndex(next.index);
    setCurrentPath(path);
  };

  const handleBack = () => applyNav(goBack(navHistory));
  const handleForward = () => applyNav(goForward(navHistory));

  // 記錄最後一次點擊的檔案索引（用於 Shift+Click 範圍選取）
  // Shift 範圍選取的錨點。放 ref 而不是 state：它不影響畫面，
  // 用 state 只會多一次 render。
  const anchorIndexRef = React.useRef<number>(-1);

  const handleFileClick = (file: FileInfo, e: React.MouseEvent) => {
    const fileNames = currentFiles?.map((f) => f.name) ?? [];
    const clickedIndex = fileNames.indexOf(file.name);

    const next = selectOnClick(
      { selected: selectedFiles, anchorIndex: anchorIndexRef.current },
      fileNames,
      clickedIndex,
      { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey },
    );

    anchorIndexRef.current = next.anchorIndex;
    setSelectedFiles(new Set(next.selected));
  };

  const handleFileDoubleClick = (file: FileInfo) => {
    // In trash mode, don't navigate to folders (paths are invalid)
    // Only allow preview for files
    if (isTrashMode) {
      if (!file.is_dir) {
        // Preview the file from trash
        openWindow("preview", file.name, { file: { ...file, path: file.path } });
      }
      // Do nothing for folders in trash - they can't be navigated
      return;
    }

    if (file.is_dir) {
      handleNavigate(joinPath(currentPath, file.name));
    } else {
      const fullPath = file.path || joinPath(currentPath, file.name);
      openWindow("preview", file.name, { file: { ...file, path: fullPath } });
    }
  };

  const handleDelete = (file: FileInfo) => {
    const fullPath = file.path || joinPath(currentPath, file.name);
    // toast 放進 onSuccess：復原要用後端回傳的垃圾桶檔名（見 features/files/trash.ts），
    // 而且刪除失敗時不該還跳一句「已移至垃圾桶」配一個沒用的復原鈕。
    deleteFile.mutate(fullPath, {
      onSuccess: ({ trash_name }) => {
        toast(`「${file.name}」已移至垃圾桶`, {
          action: {
            label: "復原",
            onClick: () => {
              restoreFromTrash.mutate(trash_name);
            },
          },
          duration: 6000,
        });
      },
    });
  };

  const handleRenameStart = (file: FileInfo) => {
    setRenamingFile(file.name);
    setRenameValue(file.name);
  };

  const submitRename = async () => {
    // ⚠️ 先把 null 擋掉，後面 renamingFile 就是 string —— 用 `as string`
    // 斷言的話等於把型別保證丟掉，而這裡本來就有現成的早退。
    if (renamingFile === null) return;

    // 判定規則（trim、空白、不合法字元）抽在 finder/rename.ts，那裡有測試
    const plan = planRename(renamingFile, renameValue);

    if (plan.kind === "cancel") {
      setRenamingFile(null);
      return;
    }

    if (plan.kind === "invalid") {
      // ⚠️ 當場說明哪裡不行，不要送出去等一個籠統的失敗。含 `/` 的名稱
      // 後端會以 403 擋下，而使用者只會看到 "Failed to rename file"。
      toast.error(plan.reason);
      return;
    }

    try {
      await renameFile.mutateAsync({
        path: joinPath(currentPath, renamingFile),
        newName: plan.name,
      });
      setRenamingFile(null);
    } catch (error) {
      console.error("Rename failed:", error);
      toast.error(getApiErrorMessage(error, "重新命名失敗"));
    }
  };

  const handleShare = (file: FileInfo) => {
    setShareFile(file);
    setIsShareDialogOpen(true);
  };

  const handleCreateShareLink = async (options: {
    file_path: string;
    password?: string;
    expires_in_seconds?: number;
  }) => {
    const result = await createShare.mutateAsync({
      file_path: options.file_path,
      password: options.password,
      expires: options.expires_in_seconds,
    });
    return result;
  };

  const handleCreateUploadLink = async (options: {
    target_path: string;
    password?: string;
    expires_in_seconds?: number;
    max_files?: number;
    max_file_size?: number;
  }) => {
    // TODO: Implement upload link API
    const response = await fetch("/api/upload-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        target_path: options.target_path,
        password: options.password,
        expires_in_seconds: options.expires_in_seconds,
        max_files: options.max_files,
        max_file_size: options.max_file_size,
      }),
    });
    if (!response.ok) throw new Error("Failed to create upload link");
    return (await response.json()) as UploadLinkResponse;
  };

  const handleFavoriteClick = (fav: FileInfo) => {
    const fullPath = fav.path.startsWith("/") ? fav.path : `/${fav.path}`;

    if (fav.is_dir) {
      handleNavigate(fullPath);
    } else {
      const parentPath = dirName(fullPath);
      handleNavigate(parentPath);
      setTimeout(() => {
        setSelectedFiles(new Set([fav.name]));
      }, 100);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 內部拖拉移動不是上傳,別顯示「Drop files to upload」遮罩
    if (e.dataTransfer.types.includes(MOVE_MIME)) return;
    if (!isDragging && !isTrashMode) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (isTrashMode) return;

    // 內部拖拉移動(檔案 → 資料夾)由 FileList 的資料夾 onDrop 處理,這裡只管 OS 拖檔上傳
    if (e.dataTransfer.types.includes(MOVE_MIME)) return;

    const items = e.dataTransfer.items;
    if (items.length === 0) return;

    // Helper to read all files from a directory entry recursively
    const readEntriesRecursively = async (
      entry: FileSystemEntry,
      basePath: string,
    ): Promise<{ file: File; relativePath: string }[]> => {
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        return new Promise((resolve, reject) => {
          fileEntry.file((file) => resolve([{ file, relativePath: basePath }]), reject);
        });
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        const reader = dirEntry.createReader();
        const entries: FileSystemEntry[] = [];

        // Read all entries (may require multiple calls for large directories)
        const readEntries = (): Promise<FileSystemEntry[]> =>
          new Promise((resolve, reject) => {
            reader.readEntries(resolve, reject);
          });

        let batch = await readEntries();
        while (batch.length > 0) {
          entries.push(...batch);
          batch = await readEntries();
        }

        const allFiles: { file: File; relativePath: string }[] = [];
        for (const childEntry of entries) {
          const childPath = basePath ? `${basePath}/${childEntry.name}` : childEntry.name;
          const childFiles = await readEntriesRecursively(childEntry, childPath);
          allFiles.push(...childFiles);
        }
        return allFiles;
      }
      return [];
    };

    try {
      const allFilesWithPaths: { file: File; relativePath: string }[] = [];
      const dirsToCreate = new Set<string>();

      // 先「同步」snapshot 所有 entry：DataTransferItemList 只在 drop 事件同步期間有效，
      // 一旦下面第一個 await 發生，瀏覽器就會清空 items → 之前 webkitGetAsEntry() 只有第一個檔案拿得到，
      // 其餘回傳 null（這就是「拖多檔只上傳第一個、要一張一張傳」的根因）。
      const droppedEntries = Array.from(items)
        .map((item) => item.webkitGetAsEntry())
        .filter((entry): entry is FileSystemEntry => entry !== null);

      // Process all dropped items
      for (const entry of droppedEntries) {
        if (entry.isDirectory) {
          // Collect directory path to create
          dirsToCreate.add(entry.name);
        }
        const filesFromEntry = await readEntriesRecursively(
          entry,
          entry.isDirectory ? entry.name : "",
        );

        // Collect all subdirectories that need to be created
        filesFromEntry.forEach(({ relativePath }) => {
          const parts = relativePath.split("/");
          if (parts.length > 1) {
            // Add all parent directories
            let dirPath = "";
            for (let j = 0; j < parts.length - 1; j++) {
              dirPath = dirPath ? `${dirPath}/${parts[j]}` : (parts[j] ?? "");
              dirsToCreate.add(dirPath);
            }
          }
        });

        allFilesWithPaths.push(...filesFromEntry);
      }

      // Create directories first (sorted by depth to create parents first)
      const sortedDirs = Array.from(dirsToCreate).sort(
        (a, b) => a.split("/").length - b.split("/").length,
      );
      for (const dir of sortedDirs) {
        // Split into parent path and folder name
        const dirParts = dir.split("/");
        const folderName = dirParts.pop() || dir;
        const parentDir = dirParts.join("/");
        const fullParentPath = currentPath
          ? parentDir
            ? `${currentPath}/${parentDir}`
            : currentPath
          : parentDir;
        try {
          await createFolder.mutateAsync({ path: fullParentPath, name: folderName });
        } catch (err: unknown) {
          // Ignore if directory already exists (409 Conflict)
          if (getApiErrorStatus(err) !== 409) {
            console.warn(`Failed to create directory ${dir}:`, err);
          }
        }
      }

      // Now upload files with their correct relative paths
      // Group files by target directory for batch upload
      const filesByDir = new Map<string, File[]>();
      for (const { file, relativePath } of allFilesWithPaths) {
        // ⚠️ 這裡**刻意不用** `lib/paths` 的 `dirName`。
        //
        // relativePath 來自資料夾拖放的 webkitRelativePath，是**相對**路徑
        // （"folder/sub/file.txt"），而 dirName 的語意是「絕對路徑、
        // 根目錄是 /」—— 對 "/a.txt" 它回 "/"，這裡要的是 ""。
        // 兩個定義域長得很像但不一樣，混用會產生只在特定輸入下才錯的 bug。
        const targetDir = relativePath.includes("/")
          ? relativePath.substring(0, relativePath.lastIndexOf("/"))
          : "";
        const uploadPath = currentPath
          ? targetDir
            ? `${currentPath}/${targetDir}`
            : currentPath
          : targetDir;

        let group = filesByDir.get(uploadPath);
        if (!group) {
          group = [];
          filesByDir.set(uploadPath, group);
        }
        group.push(file);
      }

      // Upload all groups concurrently (each group uses the upload queue internally)
      const uploadPromises = Array.from(filesByDir.entries()).map(([uploadPath, groupFiles]) =>
        handleUploadFiles(groupFiles, uploadPath),
      );
      await Promise.allSettled(uploadPromises);

      // 後端 watcher 非同步索引 → 輪詢到剛上傳的頂層項目出現(取代單次刷新,免手動重整)
      const topLevelNames = droppedEntries.map((en) => en.name);
      await pollRefetchUntil((list) => topLevelNames.every((n) => list.some((f) => f.name === n)));
    } catch (error) {
      console.error("Folder upload failed:", error);
      // Fallback to simple file upload
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        await handleUploadFiles(files, currentPath);
      }
    }
  };

  // 後端是 watcher 非同步索引(create_folder/upload 只寫 FS,DB 由 watcher 補進)。
  // 單次 refetch 常拿到尚未索引的舊清單 → 改「輪詢到一致為止」,免使用者手動重整。
  const pollRefetchUntil = async (
    predicate: (files: FileInfo[]) => boolean,
    tries = 8,
    intervalMs = 400,
  ) => {
    for (let i = 0; i < tries; i++) {
      const { data } = await refetch();
      if (data && predicate(data)) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };

  // #2 拖拉移動。搬完要輪詢到它們離開目前目錄 —— 後端的 watcher 是非同步
  // 索引的，搬完立刻重抓還會看到舊的一份。
  //
  // 「哪些真的要搬、搬去哪」的判定抽在 finder/move.ts（同目錄、搬進自己、
  // 搬進自己底下、去重），那裡有測試。
  const moveNamesToDir = async (sourceNames: string[], destDir: string) => {
    const plan = planMove(sourceNames, currentPath, destDir);
    if (plan.kind === "noop") return;

    // 輪詢用的是「檔名離開目前目錄」，所以要留原始名稱
    const movedNames = sourceNames.filter((n) =>
      plan.paths.includes(toApiPath(joinPath(currentPath, n))),
    );
    try {
      await batchMove.mutateAsync({ paths: plan.paths, destination: plan.destination });
      setSelectedFiles(new Set());
      await pollRefetchUntil((list) => movedNames.every((n) => !list.some((f) => f.name === n)));
    } catch (error) {
      console.error("Move failed:", error);
      toast.error(getApiErrorMessage(error, "移動失敗"));
    }
  };

  // 拖到資料夾:搬進目前目錄下的該資料夾
  const handleMoveFiles = (sourceNames: string[], targetFolderName: string) =>
    moveNamesToDir(sourceNames, joinPath(currentPath, targetFolderName));

  // 拖到 breadcrumb:搬到該祖先路徑(Home = 根)
  const handleMoveToPath = (sourceNames: string[], destPath: string) =>
    moveNamesToDir(sourceNames, destPath);

  const handleCreateFolder = async () => {
    try {
      // Refetch to get the latest files list for accurate duplicate checking
      const { data: latestFiles } = await refetch();
      const currentFilesList = latestFiles ?? [];

      const name = await createFolderWithUniqueName({
        existing: currentFilesList.map((f) => f.name),
        create: (candidate) => createFolder.mutateAsync({ path: currentPath, name: candidate }),
      });

      // Set pending rename - useEffect will handle entering rename mode when folder appears
      setPendingRenameFolder(name);

      // 後端 watcher 非同步索引 → 輪詢到新資料夾出現(取代單次 refetch,免手動重整)
      await pollRefetchUntil((list) => list.some((f) => f.name === name));
    } catch (error) {
      console.error("Failed to create folder:", error);
      toast.error(getApiErrorMessage(error, "建立資料夾失敗"));
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void handleUploadFiles(Array.from(e.target.files), currentPath);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div
      ref={finderContainerRef}
      className="flex h-full bg-white/50 dark:bg-black/50 backdrop-blur-xl rounded-lg overflow-hidden border border-white/20 shadow-2xl"
    >
      <Sidebar
        currentPath={currentPath}
        isTrashMode={isTrashMode}
        favorites={favorites}
        tags={userTags}
        selectedTag={selectedTag}
        onNavigate={handleNavigate}
        onTrashMode={handleTrashMode}
        onFavoriteClick={handleFavoriteClick}
        onTagClick={(tagName) => {
          setSelectedTag(tagName);
          setIsTrashMode(false);
          setSelectedFiles(new Set());
        }}
        onManageTags={() => setIsTagDialogOpen(true)}
      />

      <div className="flex-1 flex flex-col min-w-0 bg-white/40 dark:bg-black/40 relative">
        {/* Tab Bar */}
        <div className="h-9 flex items-center bg-white/30 dark:bg-black/30 shrink-0">
          <div className="flex-1 flex items-center gap-0.5 px-1 overflow-x-auto scrollbar-none">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const tabName = tab.isTrashMode
                ? "Trash"
                : tab.selectedTag
                  ? tab.selectedTag
                  : tab.path === "/"
                    ? "Home"
                    : tab.path.split("/").filter(Boolean).pop() || "Home";

              return (
                <div
                  key={tab.id}
                  role="tab"
                  tabIndex={0}
                  aria-selected={isActive}
                  onClick={() => setActiveTabId(tab.id)}
                  onKeyDown={activateOnKey(() => setActiveTabId(tab.id))}
                  className={cn(
                    "group flex items-center gap-1.5 h-7 px-3 rounded-md cursor-pointer transition-all duration-150 min-w-0 max-w-[180px]",
                    isActive
                      ? "bg-white/60 dark:bg-white/10 shadow-sm"
                      : "hover:bg-white/40 dark:hover:bg-white/5",
                  )}
                >
                  <span
                    className={cn(
                      "text-xs truncate",
                      isActive
                        ? "text-gray-800 dark:text-gray-200 font-medium"
                        : "text-gray-600 dark:text-gray-400",
                    )}
                  >
                    {tabName}
                  </span>
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      className={cn(
                        "shrink-0 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors",
                        isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                      )}
                    >
                      <X className="w-3 h-3 text-gray-500" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button
            onClick={() => addTab("/")}
            className="shrink-0 p-1.5 mr-1 rounded hover:bg-white/40 dark:hover:bg-white/10 transition-colors"
            title="New Tab"
          >
            <Plus className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <Toolbar
          currentPath={currentPath}
          isTrashMode={isTrashMode}
          viewMode={viewMode}
          historyIndex={historyIndex}
          historyLength={history.length}
          searchQuery={searchQuery}
          onNavigate={handleNavigate}
          onBack={handleBack}
          onForward={handleForward}
          onEmptyTrash={() => setIsEmptyTrashConfirmOpen(true)}
          onUploadClick={() => fileInputRef.current?.click()}
          onCreateUploadLink={() => setIsUploadLinkDialogOpen(true)}
          onViewModeChange={setViewMode}
          onSearchChange={setSearchQuery}
          onMoveToPath={(...args) => void handleMoveToPath(...args)}
        />

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          multiple
          onChange={handleFileInputChange}
        />

        <FileList
          files={currentFiles}
          isLoading={isCurrentLoading}
          viewMode={viewMode}
          currentPath={currentPath}
          selectedFiles={selectedFiles}
          renamingFile={renamingFile}
          renameValue={renameValue}
          isTrashMode={isTrashMode}
          isDragging={isDragging}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onFileClick={handleFileClick}
          onFileDoubleClick={handleFileDoubleClick}
          onSelectionClear={() => setSelectedFiles(new Set())}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(...args) => void handleDrop(...args)}
          onRenameChange={setRenameValue}
          onRenameSubmit={() => void submitRename()}
          onRenameCancel={() => setRenamingFile(null)}
          onRestore={(name) => restoreFromTrash.mutate(name)}
          onPermanentDelete={(trashName) => {
            // 右鍵選單的「Delete Immediately」原本是一個**沒有 onClick 的**
            // ContextMenuItem —— 按下去什麼都不會發生。桌面唯一能永久刪除的
            // 路徑是 Shift+Delete，而手機版的動作面板一直都做得到。
            setFilesToPermanentlyDelete([trashName]);
            setIsPermanentDeleteConfirmOpen(true);
          }}
          onDelete={handleDelete}
          onDownload={(path) => downloadFile.mutate(path)}
          onShare={handleShare}
          onToggleStar={(path) => toggleStar.mutate(path)}
          onRenameStart={handleRenameStart}
          onTag={(file) => {
            setTagTargetFile(file);
            setIsTagDialogOpen(true);
          }}
          onCreateFolder={() => void handleCreateFolder()}
          onUpload={() => fileInputRef.current?.click()}
          onRefresh={() => void (isTrashMode ? refetchTrash() : refetch())}
          onViewModeChange={setViewMode}
          onSortChange={(field) => {
            if (field === sortBy) {
              setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
            } else {
              setSortBy(field);
              setSortDirection("asc");
            }
          }}
          onSelectionChange={setSelectedFiles}
          onMoveFiles={(...args) => void handleMoveFiles(...args)}
        />

        {/* Status Bar */}
        <div className="min-h-[32px] max-h-[120px] flex flex-col justify-center px-4 py-1 border-t border-white/10 bg-white/40 dark:bg-black/40 text-xs text-gray-500 backdrop-blur-md shrink-0">
          {(() => {
            const activeTasks = Object.values(uploadTasks).filter(
              (t) => t.path === currentPath && (t.status === "uploading" || t.status === "error"),
            );
            if (activeTasks.length > 0) {
              const totalTasks = activeTasks.length;
              const completedCount = activeTasks.filter((t) => t.progress === 100).length;
              const avgProgress = Math.round(
                activeTasks.reduce((s, t) => s + t.progress, 0) / totalTasks,
              );
              return (
                <div className="flex flex-col gap-1 w-full py-1 overflow-y-auto scrollbar-thin">
                  {/* Summary line */}
                  <div className="flex items-center gap-2 w-full shrink-0">
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0" />
                    <span className="shrink-0">
                      Uploading {totalTasks} files ({completedCount} done)
                    </span>
                    <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${avgProgress}%` }}
                      />
                    </div>
                    <span className="w-10 text-right shrink-0">{avgProgress}%</span>
                  </div>
                  {/* Individual tasks (only show a few) */}
                  {activeTasks
                    .filter((t) => t.status === "error")
                    .map((task) => (
                      <div key={task.id} className="flex items-center gap-2 w-full shrink-0">
                        <span className="truncate max-w-[150px] text-red-500">
                          {task.file.name}
                        </span>
                        <span className="text-red-500 text-[10px] truncate">{task.error}</span>
                        {task.uploadId && (
                          <button
                            onClick={() => void resumeUpload(task.id)}
                            className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded text-blue-600 dark:text-blue-400"
                            title="Resume Upload"
                          >
                            <RefreshCw className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              );
            }
            return <span>{currentFiles ? `${currentFiles.length} items` : "Loading..."}</span>;
          })()}
        </div>
      </div>

      {/* Empty Trash Confirmation Dialog */}
      <Dialog open={isEmptyTrashConfirmOpen} onOpenChange={setIsEmptyTrashConfirmOpen}>
        <DialogContent className="sm:max-w-[425px] bg-white/95 dark:bg-black/95 backdrop-blur-xl border-white/20">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <Trash2 className="w-5 h-5" />
              Empty Trash?
            </DialogTitle>
            <DialogDescription className="text-gray-600 dark:text-gray-400">
              This will permanently delete all items in the Trash. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsEmptyTrashConfirmOpen(false)}
              className="border-white/20"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                emptyTrash.mutate();
                setIsEmptyTrashConfirmOpen(false);
              }}
              className="bg-red-500 hover:bg-red-600"
            >
              Empty Trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permanent Delete Confirmation Dialog */}
      <Dialog open={isPermanentDeleteConfirmOpen} onOpenChange={setIsPermanentDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-[425px] bg-white/95 dark:bg-black/95 backdrop-blur-xl border-white/20">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <Trash2 className="w-5 h-5" />
              Permanently Delete {filesToPermanentlyDelete.length}{" "}
              {filesToPermanentlyDelete.length === 1 ? "Item" : "Items"}?
            </DialogTitle>
            <DialogDescription className="text-gray-600 dark:text-gray-400">
              This action cannot be undone. The{" "}
              {filesToPermanentlyDelete.length === 1 ? "file" : "files"} will be permanently deleted
              and cannot be recovered.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setIsPermanentDeleteConfirmOpen(false);
                setFilesToPermanentlyDelete([]);
              }}
              className="border-white/20"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                // ⚠️ 這裡原本是 `deleteFile.mutate(path)` 配一句
                // "TODO: Implement permanent delete API call" —— 也就是
                // 「永久刪除」實際上呼叫的是**移到垃圾桶**的端點。
                // 使用者按下確認、沒有任何錯誤，而檔案還在。
                // usePermanentDelete 一直都在，只是沒有任何呼叫點。
                filesToPermanentlyDelete.forEach((name) => {
                  permanentDelete.mutate(name);
                });
                setIsPermanentDeleteConfirmOpen(false);
                setFilesToPermanentlyDelete([]);
                setSelectedFiles(new Set());
              }}
              className="bg-red-500 hover:bg-red-600"
            >
              Permanently Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Dialog */}
      <ShareDialog
        isOpen={isShareDialogOpen}
        onClose={() => {
          setIsShareDialogOpen(false);
          setShareFile(null);
        }}
        fileName={shareFile?.name || ""}
        filePath={
          shareFile?.path ||
          (shareFile
            ? currentPath === "/"
              ? `/${shareFile.name}`
              : `${currentPath}/${shareFile.name}`
            : "")
        }
        isDirectory={shareFile?.is_dir}
        onCreateShare={handleCreateShareLink}
      />

      {/* Upload Link Dialog */}
      <UploadLinkDialog
        isOpen={isUploadLinkDialogOpen}
        onClose={() => setIsUploadLinkDialogOpen(false)}
        targetPath={currentPath}
        onCreateUploadLink={handleCreateUploadLink}
      />

      {/* Tag Dialog */}
      <TagDialog open={isTagDialogOpen} onOpenChange={setIsTagDialogOpen} file={tagTargetFile} />
    </div>
  );
};
