import { create } from 'zustand';

export interface UploadTask {
  id: string;
  file: File;
  path: string;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
  uploadId?: string;
  error?: string;
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
    set((state) => ({
      tasks: {
        ...state.tasks,
        [id]: { ...state.tasks[id], ...updates },
      },
    })),

  removeTask: (id) =>
    set((state) => {
      const newTasks = { ...state.tasks };
      delete newTasks[id];
      return { tasks: newTasks };
    }),

  toggleExpanded: () =>
    set((state) => ({ isExpanded: !state.isExpanded })),

  setExpanded: (expanded) =>
    set({ isExpanded: expanded }),

  clearCompleted: () =>
    set((state) => {
      const newTasks = { ...state.tasks };
      Object.keys(newTasks).forEach((key) => {
        if (newTasks[key].status === 'completed') {
          delete newTasks[key];
        }
      });
      return { tasks: newTasks };
    }),
}));