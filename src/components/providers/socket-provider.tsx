"use client";

import { createContext, use, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Job, WsServerMessage } from "@/types/api";
import { jobLabel } from "@/components/desktop/jobs";

// 協定型別由 Rust 產生（`pnpm export:types`）。這裡刻意不再手刻一份 —— 先前那份
// 手寫的 WebSocketMessage 比對的是 'docker_stats' / 'job_update' / 'file_change'，
// 而後端當時送的是 PascalCase 的 { type: "DockerStats", payload }，三個分支
// 全部永遠不會命中。現在兩邊共用同一個定義，對不上就編不過。

interface SocketContextType {
  socket: WebSocket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
});

// React 19 起 `use()` 取代 `useContext()`（它還能在條件式裡呼叫，
// 也能讀 Promise，是同一個 API 的超集）
export const useSocket = () => use(SocketContext);

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    // In a real app, handle reconnection logic and auth tokens if needed
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // Use localhost:3000 for development if not in production, or derive from window.location
    // Assuming the backend is on the same host/port or proxied.
    // If backend is on 3000 and frontend on 3001, we need to point to 3000.
    // For now, let's assume proxy or same origin. If dev, hardcode port 3000 if needed.
    const host = window.location.hostname === "localhost" ? "localhost:3000" : window.location.host;
    const wsUrl = `${protocol}//${host}/api/ws`;

    let ws: WebSocket | undefined;
    let reconnectTimer: NodeJS.Timeout | undefined;

    const connect = () => {
      // Don't connect if we are on the login page
      if (window.location.pathname.startsWith("/login")) {
        return;
      }

      // ⚠️ handler 裡一律用這個 `socket`，不要用外層的 `ws`。
      // 重連後 `ws` 指向**新的**連線，而舊連線的 onerror 仍會執行 —— 那時
      // `ws.close()` 關掉的是剛建立的那條，症狀是「連上又立刻斷、無限重連」。
      const socket = new WebSocket(wsUrl);
      ws = socket;

      socket.onopen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
        setSocket(socket);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as WsServerMessage;

          switch (message.type) {
            case "job_update": {
              const jobUpdate = message.payload;

              // ⚠️ key 是 `["tasks"]`。這裡原本寫 `["jobs"]` —— 而 `useTasks`
              // （通知中心的背景工作面板）用的是 `["tasks"]`，兩邊對不上，
              // 於是 WebSocket 推進來的更新從來沒有讓面板重整過。
              void queryClient.invalidateQueries({ queryKey: ["tasks"] });

              // ⚠️ 完成**不發** toast。每一個工作都會廣播完成，而 index_file 與
              // generate_thumbnail 是每上傳一個檔案就各跑一次 —— 上傳 50 張照片
              // 原本會跳出 50 個「工作完成：<uuid>」。完成不需要使用者做任何事，
              // 進度看通知中心的面板就好。
              if (jobUpdate.status === "failed") {
                // job_id 是 UUID，對使用者沒有意義。能從快取查到類型就用類型。
                const known = queryClient
                  .getQueryData<Job[]>(["tasks"])
                  ?.find((job) => job.id === jobUpdate.job_id);
                toast.error(known ? `${jobLabel(known.job_type)}失敗` : "背景工作失敗", {
                  description: jobUpdate.error ?? "執行過程中發生錯誤。",
                });
              }
              break;
            }
            case "docker_stats":
              queryClient.setQueryData(
                ["docker", "stats", message.payload.container_id],
                message.payload,
              );
              break;
            case "docker_stats_error":
              console.error(
                `Docker 統計失敗 (${message.payload.container_id}):`,
                message.payload.error,
              );
              break;
            case "error":
              console.error("WebSocket 伺服器回報錯誤:", message.payload.message);
              break;
            case "pong":
              break;
            default: {
              // 窮盡檢查：Rust 端加了新的 WsServerMessage variant 而這裡沒接，
              // 這行會編譯失敗 —— 而不是安靜地被 switch 漏掉。
              const unhandled: never = message;
              console.warn("未處理的 WebSocket 訊息", unhandled);
            }
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message", error);
        }
      };

      socket.onclose = () => {
        console.log("WebSocket disconnected");
        setIsConnected(false);
        setSocket(null);
        // Reconnect after 3 seconds
        reconnectTimer = setTimeout(connect, 3000);
      };

      socket.onerror = (error) => {
        // Only log error if not on login page (to avoid noise when auth fails)
        if (!window.location.pathname.startsWith("/login")) {
          console.error("WebSocket error:", error);
        }
        socket.close();
      };
    };

    connect();

    return () => {
      if (ws) ws.close();
      clearTimeout(reconnectTimer);
    };
  }, [queryClient]);

  return (
    // React 19 起 Context 本身就能當 Provider 用，不必再寫 .Provider
    <SocketContext value={{ socket, isConnected }}>{children}</SocketContext>
  );
};
