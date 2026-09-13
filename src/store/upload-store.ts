import { create } from "zustand";

export interface UploadTask {
  id: string;
  file: File;
  path: string;
  progress: number;
  status: "uploading" | "completed" | "error";
  uploadId?: string;
  error?: string;
  /**
   * 已完成、但使用者必須注意（例如 0 bytes，見 `features/files/upload-warning.ts`）。
   * 刻意不做成第四種 status：「完成」這件事是真的，手機版與 Finder 對
   * `status` 的判斷都不需要跟著改。
   */
  warning?: string;
}

interface UploadStore {
  tasks: Record<string, UploadTask>;
  isExpanded: boolean;

  addTask: (task: UploadTask) => void;
  updateTask: (id: string, updates: Partial<UploadTask>) => void;
  removeTask: (id: string) => void;
  toggleExpanded: () => void;
  setExpanded: (expanded: boolean) => void;
  clearCompleted: () => void;
}

export const useUploadStore = create<UploadStore>((set) => ({
  tasks: {},
  isExpanded: true,

  addTask: (task) =>
    set((state) => ({
      tasks: { ...state.tasks, [task.id]: task },
      isExpanded: true, // Auto expand when new task added
    })),

  updateTask: (id, updates) =>
    set((state) => {
      if (!state.tasks[id]) return state;
      return {
        tasks: {
          ...state.tasks,
          [id]: { ...state.tasks[id], ...updates },
        },
      };
    }),

  removeTask: (id) =>
    set((state) => {
      const newTasks = { ...state.tasks };
      delete newTasks[id];
      return { tasks: newTasks };
    }),

  toggleExpanded: () => set((state) => ({ isExpanded: !state.isExpanded })),

  setExpanded: (expanded) => set({ isExpanded: expanded }),

  clearCompleted: () =>
    set((state) => {
      const newTasks = { ...state.tasks };
      Object.keys(newTasks).forEach((key) => {
        // ⚠️ 有警告的不清。批次上傳幾百個檔案後最可能做的事就是按清除 ——
        // 警告跟著被清掉，就又回到「使用者完全不會知道」。要逐筆按 X 才移除。
        if (newTasks[key]?.status === "completed" && !newTasks[key].warning) {
          delete newTasks[key];
        }
      });
      return { tasks: newTasks };
    }),
}));
