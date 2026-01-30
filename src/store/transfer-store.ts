'use client';

import { create } from 'zustand';

export interface TransferTask {
    id: string;
    name: string;
    type: 'upload' | 'download';
    size: number;
    progress: number;
    bytesTransferred: number;
    status: 'pending' | 'active' | 'completed' | 'error';
    speed: number; // bytes per second
    startTime: number;
    error?: string;
}

interface TransferStore {
    tasks: Record<string, TransferTask>;
    uploadSpeed: number; // total upload speed in bytes/s
    downloadSpeed: number; // total download speed in bytes/s

    addTask: (task: Omit<TransferTask, 'speed' | 'startTime' | 'bytesTransferred'>) => void;
    updateTask: (id: string, updates: Partial<TransferTask>) => void;
    updateProgress: (id: string, bytesTransferred: number) => void;
    removeTask: (id: string) => void;
    clearCompleted: () => void;
}

// Calculate speed using time window
const calculateSpeed = (task: TransferTask, newBytes: number): number => {
    const elapsed = (Date.now() - task.startTime) / 1000; // seconds
    if (elapsed <= 0) return 0;
    return newBytes / elapsed;
};

// Aggregate speeds by type
const aggregateSpeeds = (tasks: Record<string, TransferTask>) => {
    let uploadSpeed = 0;
    let downloadSpeed = 0;

    Object.values(tasks).forEach((task) => {
        if (task.status === 'active') {
            if (task.type === 'upload') {
                uploadSpeed += task.speed;
            } else {
                downloadSpeed += task.speed;
            }
        }
    });

    return { uploadSpeed, downloadSpeed };
};

export const useTransferStore = create<TransferStore>((set, get) => ({
    tasks: {},
    uploadSpeed: 0,
    downloadSpeed: 0,

    addTask: (task) =>
        set((state) => {
            const newTask: TransferTask = {
                ...task,
                speed: 0,
                startTime: Date.now(),
                bytesTransferred: 0,
            };
            return {
                tasks: { ...state.tasks, [task.id]: newTask },
            };
        }),

    updateTask: (id, updates) =>
        set((state) => {
            if (!state.tasks[id]) return state;
            const updatedTasks = {
                ...state.tasks,
                [id]: { ...state.tasks[id], ...updates },
            };
            const speeds = aggregateSpeeds(updatedTasks);
            return {
                tasks: updatedTasks,
                ...speeds,
            };
        }),

    updateProgress: (id, bytesTransferred) =>
        set((state) => {
            const task = state.tasks[id];
            if (!task) return state;

            const speed = calculateSpeed(task, bytesTransferred);
            const progress = task.size > 0 ? (bytesTransferred / task.size) * 100 : 0;

            const updatedTasks = {
                ...state.tasks,
                [id]: {
                    ...task,
                    bytesTransferred,
                    progress,
                    speed,
                    status: progress >= 100 ? 'completed' : 'active',
                } as TransferTask,
            };

            const speeds = aggregateSpeeds(updatedTasks);
            return {
                tasks: updatedTasks,
                ...speeds,
            };
        }),

    removeTask: (id) =>
        set((state) => {
            const newTasks = { ...state.tasks };
            delete newTasks[id];
            const speeds = aggregateSpeeds(newTasks);
            return { tasks: newTasks, ...speeds };
        }),

    clearCompleted: () =>
        set((state) => {
            const newTasks = { ...state.tasks };
            Object.keys(newTasks).forEach((key) => {
                if (newTasks[key].status === 'completed') {
                    delete newTasks[key];
                }
            });
            const speeds = aggregateSpeeds(newTasks);
            return { tasks: newTasks, ...speeds };
        }),
}));

// Helper to format bytes per second to human readable
export const formatSpeed = (bytesPerSec: number): string => {
    if (bytesPerSec === 0) return '0 B/s';

    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const k = 1024;
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    const value = bytesPerSec / Math.pow(k, i);

    return `${value.toFixed(1)} ${units[i]}`;
};
