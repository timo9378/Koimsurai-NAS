import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DockerStats, JobUpdate, Job } from '@/types/api';

type WebSocketMessage =
  | { type: 'docker_stats'; data: DockerStats }
  | { type: 'job_update'; data: JobUpdate };

export const useSocket = () => {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    // In a real app, handle reconnection logic and auth tokens if needed
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws`;
    
    const ws = new WebSocket(wsUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setSocket(ws);

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        
        switch (message.type) {
          case 'docker_stats':
            // Update specific docker stats query or cache
            // For example, if we had a query for specific container stats
            queryClient.setQueryData(['docker', 'stats', message.data.container_id], message.data);
            break;
          case 'job_update':
            // Update job list or specific job status
            queryClient.setQueryData(['jobs', message.data.job_id], (old: Job | undefined) => {
              if (!old) return undefined;
              return {
                ...old,
                ...message.data
              };
            });
            // Also invalidate list to refresh status
            queryClient.invalidateQueries({ queryKey: ['jobs'] });
            break;
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message', error);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };

    return () => {
      ws.close();
    };
  }, [queryClient]);

  return socket;
};

export const useJobProgress = (jobId: string) => {
  // This is a simplified example. In reality, you might want to subscribe to specific topics
  // or filter messages in the main socket handler.
  // For now, we rely on the global socket handler updating the query cache.
  useSocket();
};

export const useDockerStats = (containerId: string) => {
  useSocket();
};