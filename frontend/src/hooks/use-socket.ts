import { useSocket as useSocketProvider } from '@/components/providers/socket-provider';

export const useSocket = () => {
  const { socket } = useSocketProvider();
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