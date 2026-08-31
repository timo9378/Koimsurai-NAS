import { useQueryClient } from "@tanstack/react-query";
import { useUpload } from "../api/useFiles";
import { useUploadStore } from "@/store/upload-store";
import { apiClient } from "@/lib/api-client";
import { startTusUpload } from "../tus-upload";
import type { FileInfo } from "@/types/api";
import { getApiErrorMessage, isNetworkError } from "@/lib/errors";

// Concurrency-limited upload queue utility
const createUploadQueue = (concurrency: number) => {
  let running = 0;
  const queue: (() => Promise<void>)[] = [];

  const run = async () => {
    if (running >= concurrency || queue.length === 0) return;
    const task = queue.shift();
    if (!task) return;
    running++;
    try {
      await task();
    } finally {
      running--;
      void run(); // Process next in queue
    }
  };

  return {
    add: (task: () => Promise<void>): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        queue.push(async () => {
          try {
            await task();
            resolve();
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
        void run();
      });
    },
    get pending() {
      return queue.length;
    },
    get active() {
      return running;
    },
  };
};

// Global upload queue: max 4 concurrent uploads
const uploadQueue = createUploadQueue(4);

export const useFileUpload = () => {
  const queryClient = useQueryClient();
  const uploadFile = useUpload();
  const { addTask, updateTask, tasks: uploadTasks } = useUploadStore();

  const handleUploadFiles = async (files: File[], currentPath: string) => {
    const uploadPromises = files.map((file) => {
      return uploadQueue.add(async () => {
        const taskId = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        addTask({ id: taskId, file, path: currentPath, progress: 0, status: "uploading" });

        try {
          // Use chunked upload for files > 1MB to bypass Next.js body size limits
          if (file.size > 1 * 1024 * 1024) {
            await processTusUpload(taskId, file, currentPath);
          } else {
            await uploadFile.mutateAsync({
              file,
              path: currentPath,
            });
            updateTask(taskId, { progress: 100, status: "completed" });
          }
        } catch (error: unknown) {
          if (isNetworkError(error)) {
            console.warn(`Network Error for ${file.name}, verifying if upload succeeded...`);

            await new Promise((resolve) => setTimeout(resolve, 1500));
            await queryClient.invalidateQueries({ queryKey: ["files"] });

            try {
              const cleanPath = currentPath.startsWith("/") ? currentPath.slice(1) : currentPath;
              const endpoint = cleanPath === "" ? "/files" : `/files/${cleanPath}`;
              const params = new URLSearchParams();
              params.append("sort_by", "name");
              params.append("_t", Date.now().toString());

              const res = await apiClient.get<FileInfo[]>(`${endpoint}?${params.toString()}`);
              const freshFiles = res.data;

              if (freshFiles.some((f) => f.name === file.name)) {
                console.log(`File ${file.name} found despite Network Error. Marking as complete.`);
                updateTask(taskId, { progress: 100, status: "completed" });
                return; // Skip error logging
              }
            } catch (verifyError) {
              console.error("Verification failed", verifyError);
            }
          }

          console.error(`Failed to upload ${file.name}:`, error);
          updateTask(taskId, {
            status: "error",
            error: getApiErrorMessage(error, "Upload failed"),
          });
        }
      });
    });

    // Wait for all queued uploads to complete
    await Promise.allSettled(uploadPromises);

    // 整批結束後只刷新一次檔案列表（先前每檔都 invalidate(['files']) → 數百請求撞 nginx 429）
    await queryClient.invalidateQueries({ queryKey: ["files"] });
  };

  /**
   * 大檔走 tus 1.0.0（`features/files/tus-upload.ts`）。
   *
   * ⚠️ 這裡不再自己算分塊位置。舊版用 `planChunks(file.size, startOffset)`
   * 由客戶端決定從哪裡續，而 offset 到底在哪只有伺服器知道 —— 那個不一致
   * 正是先前那個「續傳重送已傳位元組」的 bug。tus 每次續傳前先 HEAD 問一次，
   * 客戶端沒有猜測的餘地。
   *
   * `chunk-plan.ts` 沒有刪：`CHUNK_SIZE` 仍是這裡的分塊大小，而那支模組的
   * property test 仍然守著「分塊剛好鋪滿且不重疊」這條性質。
   */
  const processTusUpload = async (taskId: string, file: File, currentPath: string) =>
    new Promise<void>((resolve, reject) => {
      void startTusUpload(file, currentPath, {
        onProgress: (progress) => updateTask(taskId, { progress }),
        // 存起來讓「暫停 → 繼續」找得回同一份上傳
        onUrl: (uploadId) => updateTask(taskId, { uploadId }),
        onSuccess: () => {
          updateTask(taskId, { progress: 100, status: "completed" });
          resolve();
        },
        onError: (error) => {
          updateTask(taskId, {
            status: "error",
            error: getApiErrorMessage(error, "Upload interrupted"),
          });
          reject(error);
        },
      }).catch(reject);
    });

  /**
   * 「繼續」按鈕。
   *
   * ⚠️ 不需要先去問伺服器傳到哪 —— `startTusUpload` 內部會用檔案指紋找回
   * 上一次的上傳 URL（存在 localStorage），再由 tus 自己 HEAD 取得 offset。
   * 舊版要先 `GET /upload/session/{id}` 拿 `uploaded_size` 再自己算分塊，
   * 而那個數字與伺服器實際狀態之間有一個可以不一致的縫。
   */
  const resumeUpload = async (taskId: string) => {
    const task = uploadTasks[taskId];
    if (!task) return;

    updateTask(taskId, { status: "uploading", error: undefined });
    try {
      await processTusUpload(taskId, task.file, task.path);
    } catch (error: unknown) {
      console.error("Failed to resume upload:", error);
      updateTask(taskId, { status: "error", error: "Failed to resume upload" });
    }
  };

  return {
    handleUploadFiles,
    resumeUpload,
  };
};
