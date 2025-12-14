'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DockerStats, JobUpdate, Job } from '@/types/api';

type WebSocketMessage =
  | { type: 'docker_stats'; data: DockerStats }
  | { type: 'job_update'; data: JobUpdate };

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
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setSocket(ws);
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          
          switch (message.type) {
            case 'docker_stats':
              queryClient.setQueryData(['docker', 'stats', message.data.container_id], message.data);
              break;
            case 'job_update':
              const jobUpdate = message.data;
              
              // Update job list or specific job status
              queryClient.setQueryData(['jobs', jobUpdate.job_id], (old: Job | undefined) => {
                if (!old) return undefined;
                return {
                  ...old,
                  ...jobUpdate
                };
              });
              
              // Invalidate list to refresh status
              queryClient.invalidateQueries({ queryKey: ['jobs'] });

              // Show toast notification for completed/failed jobs
              if (jobUpdate.status === 'completed') {
                toast.success(`Task Completed: ${jobUpdate.type || 'Operation'}`, {
                  description: 'The background task has finished successfully.'
                });
              } else if (jobUpdate.status === 'failed') {
                toast.error(`Task Failed: ${jobUpdate.type || 'Operation'}`, {
                  description: jobUpdate.error || 'An error occurred during the operation.'
                });
              }
              break;
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
        console.error('WebSocket error:', error);
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