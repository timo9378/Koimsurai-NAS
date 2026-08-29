'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Job, WsServerMessage } from '@/types/api';

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

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    // In a real app, handle reconnection logic and auth tokens if needed
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use localhost:3000 for development if not in production, or derive from window.location
    // Assuming the backend is on the same host/port or proxied. 
    // If backend is on 3000 and frontend on 3001, we need to point to 3000.
    // For now, let's assume proxy or same origin. If dev, hardcode port 3000 if needed.
    const host = window.location.hostname === 'localhost' ? 'localhost:3000' : window.location.host;
    const wsUrl = `${protocol}//${host}/api/ws`;
    
    let ws: WebSocket;
    let reconnectTimer: NodeJS.Timeout;

    const connect = () => {
      // Don't connect if we are on the login page
      if (window.location.pathname.startsWith('/login')) {
        return;
      }

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setSocket(ws);
      };

      ws.onmessage = (event) => {
        try {
          const message: WsServerMessage = JSON.parse(event.data);

          switch (message.type) {
            case 'job_update': {
              const jobUpdate = message.payload;

              queryClient.setQueryData(['jobs', jobUpdate.job_id], (old: Job | undefined) =>
                old ? { ...old, ...jobUpdate } : undefined,
              );
              void queryClient.invalidateQueries({ queryKey: ['jobs'] });

              if (jobUpdate.status === 'completed') {
                toast.success(`工作完成：${jobUpdate.job_id}`, {
                  description: '背景工作已順利結束。',
                });
              } else if (jobUpdate.status === 'failed') {
                toast.error(`工作失敗：${jobUpdate.job_id}`, {
                  description: jobUpdate.error ?? '執行過程中發生錯誤。',
                });
              }
              break;
            }
            case 'docker_stats':
              queryClient.setQueryData(
                ['docker', 'stats', message.payload.container_id],
                message.payload,
              );
              break;
            case 'docker_stats_error':
              console.error(
                `Docker 統計失敗 (${message.payload.container_id}):`,
                message.payload.error,
              );
              break;
            case 'error':
              console.error('WebSocket 伺服器回報錯誤:', message.payload.message);
              break;
            case 'pong':
              break;
            default: {
              // 窮盡檢查：Rust 端加了新的 WsServerMessage variant 而這裡沒接，
              // 這行會編譯失敗 —— 而不是安靜地被 switch 漏掉。
              const unhandled: never = message;
              console.warn('未處理的 WebSocket 訊息', unhandled);
            }
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message', error);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        setSocket(null);
        // Reconnect after 3 seconds
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = (error) => {
        // Only log error if not on login page (to avoid noise when auth fails)
        if (!window.location.pathname.startsWith('/login')) {
           console.error('WebSocket error:', error);
        }
        ws.close();
      };
    };

    connect();

    return () => {
      if (ws) ws.close();
      clearTimeout(reconnectTimer);
    };
  }, [queryClient]);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};