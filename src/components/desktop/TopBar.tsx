'use client';

import React, { useState, useEffect } from 'react';
import {
  Search,
  LogOut,
  Settings,
  Bell,
  Sliders,
  Activity,
  HardDrive,
  Cpu,
  Power,
  RefreshCw,
  User,
  Loader2,
  CheckCircle2,
  XCircle,
  Moon,
  Sun,
  Box,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useLogout } from '@/features/auth/api/useAuth';
import { useSystemStatus, useRescan, useDockerContainers } from '@/features/system/api/useSystem';
import { SpotlightSearch } from './SpotlightSearch';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Job } from '@/types/api';
import { Progress } from "@/components/ui/progress"
import { useWindowStore } from '@/store/window-store';

import { useUploadStore } from '@/store/upload-store';
import { useTransferStore, formatSpeed } from '@/store/transfer-store';

const TaskManager = () => {
  const { data: backendTasks, refetch, isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: async () => {
      try {
        const res = await apiClient.get<Job[]>('/tasks');
        return Array.isArray(res.data) ? res.data : [];
      } catch {
        return [];
      }
    },
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  // Get upload tasks from store
  const uploadTasks = useUploadStore((state) => Object.values(state.tasks));
  const { uploadSpeed, downloadSpeed } = useTransferStore();

  // Combine backend jobs and frontend upload tasks
  const allTasks = [
    ...uploadTasks.map((t) => ({
      id: t.id,
      job_type: 'upload',
      status: t.status === 'uploading' ? 'processing' : t.status,
      progress: t.progress,
      error: t.error,
      file_name: t.file.name,
    })),
    ...(backendTasks?.slice(0, 5) || []).map((t) => ({
      id: String(t.id),
      job_type: t.job_type,
      status: t.status,
      progress: t.progress,
      error: t.error,
      file_name: null,
    })),
  ];

  const activeTasks = allTasks.filter((t) => t.status === 'processing' || t.status === 'pending');
  const displayTasks = allTasks.slice(0, 8);

  return (
    <div className="w-80 p-4">
      {/* Speed indicator at top */}
      {(uploadSpeed > 0 || downloadSpeed > 0) && (
        <div className="flex items-center gap-4 mb-3 pb-3 border-b border-white/10">
          {downloadSpeed > 0 && (
            <div className="flex items-center gap-1 text-sm">
              <span className="text-green-400">↓</span>
              <span>{formatSpeed(downloadSpeed)}</span>
            </div>
          )}
          {uploadSpeed > 0 && (
            <div className="flex items-center gap-1 text-sm">
              <span className="text-blue-400">↑</span>
              <span>{formatSpeed(uploadSpeed)}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <span className="font-semibold">Background Tasks</span>
        <div className="flex items-center gap-2">
          {activeTasks.length > 0 && (
            <span className="text-xs text-blue-500 animate-pulse">{activeTasks.length} running</span>
          )}
          <button
            onClick={() => refetch()}
            disabled={isLoading}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
          </button>
        </div>
      </div>
      <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar">
        {displayTasks.length === 0 ? (
          <div className="text-center text-muted-foreground py-4 text-sm">
            No active tasks
          </div>
        ) : (
          displayTasks.map((task) => (
            <div key={task.id} className="bg-black/5 dark:bg-white/5 rounded-lg p-3 border border-black/5 dark:border-white/5">
              <div className="flex items-start gap-3">
                <div className="mt-1">
                  {task.status === 'processing' ? (
                    <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                  ) : task.status === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  ) : task.status === 'error' ? (
                    <XCircle className="w-4 h-4 text-red-500" />
                  ) : (
                    <Activity className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex justify-between items-start">
                    <span className="text-sm font-medium capitalize truncate">
                      {task.file_name || task.job_type.replace('_', ' ')}
                    </span>
                    <span className="text-[10px] text-muted-foreground capitalize ml-2 shrink-0">{task.status}</span>
                  </div>
                  {task.status === 'processing' && (
                    <div className="h-1.5 w-full bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  )}
                  {task.error && (
                    <p className="text-xs text-red-500 truncate">{task.error}</p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const ControlCenter = () => {
  const { data: systemStatus } = useSystemStatus();
  const rescanMutation = useRescan();
  const { data: containers = [] } = useDockerContainers();
  const openWindow = useWindowStore((state) => state.openWindow);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const usedMemoryPercent = systemStatus 
    ? Math.round((systemStatus.used_memory / systemStatus.total_memory) * 100) 
    : 0;
  
  const containerList = Array.isArray(containers) ? containers : [];
  const runningContainers = containerList.filter(c => c.status === 'running');
  const totalContainers = containerList.length;
  
  // Calculate total disk usage from disks array
  const totalDiskUsed = systemStatus?.disks?.reduce((acc, disk) => acc + (disk.total_space - disk.available_space), 0) || 0;
  const totalDiskSize = systemStatus?.disks?.reduce((acc, disk) => acc + disk.total_space, 0) || 0;
  const diskUsagePercent = totalDiskSize > 0 ? Math.round((totalDiskUsed / totalDiskSize) * 100) : 0;

  return (
    <div className="w-80 p-4 space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar">
      {/* System Status */}
      <div className="bg-black/20 dark:bg-white/10 rounded-xl p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-blue-500 rounded-full text-white">
            <Activity className="w-4 h-4" />
          </div>
          <span className="text-sm font-medium">System</span>
        </div>
        <div className="space-y-2">
          {/* CPU */}
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">CPU</span>
            <span className="font-medium">{systemStatus?.cpu_usage?.toFixed(1) || 0}%</span>
          </div>
          
          {/* RAM */}
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">RAM</span>
            <span className="font-medium">{usedMemoryPercent}%</span>
          </div>

          {/* Storage */}
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Storage</span>
            <span className="font-medium">{diskUsagePercent}%</span>
          </div>

          {/* GPU if available */}
          {systemStatus?.gpu && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">GPU</span>
              <span className="font-medium">{systemStatus.gpu.utilization?.toFixed(0) || 0}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Docker Containers - Click to open Docker app */}
      <button
        onClick={() => openWindow('docker', 'Docker')}
        className="w-full bg-black/20 dark:bg-white/10 rounded-xl p-4 hover:bg-black/30 dark:hover:bg-white/15 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-cyan-500 rounded-full text-white">
            <Box className="w-4 h-4" />
          </div>
          <div>
            <span className="text-sm font-medium block">Docker</span>
            <span className="text-[10px] text-muted-foreground">
              {runningContainers.length}/{totalContainers} running
            </span>
          </div>
        </div>
      </button>

      {/* Quick Actions */}
      <div className="bg-black/20 dark:bg-white/10 rounded-xl p-4">
        <span className="text-sm font-medium mb-3 block">Quick Actions</span>
        <div className="flex gap-2">
          <button
            onClick={() => rescanMutation.mutate()}
            disabled={rescanMutation.isPending}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg text-xs font-medium transition-colors"
          >
            <RefreshCw className={cn("w-3 h-3", rescanMutation.isPending && "animate-spin")} />
            {rescanMutation.isPending ? 'Scanning...' : 'Rescan Files'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ControlCenterPopover = () => {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">
          <Sliders className="w-4 h-4" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 mr-2 bg-white/80 dark:bg-black/80 backdrop-blur-xl border-white/20" align="end" sideOffset={8}>
        {open && <ControlCenter />}
      </PopoverContent>
    </Popover>
  );
};

const TaskManagerPopover = () => {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">
          <Activity className="w-4 h-4" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 mr-2 bg-white/80 dark:bg-black/80 backdrop-blur-xl border-white/20" align="end" sideOffset={8}>
        {open && <TaskManager />}
      </PopoverContent>
    </Popover>
  );
};

import { formatDistanceToNow } from 'date-fns';
import { X } from 'lucide-react';

interface AuditLog {
  id: number;
  user_id: number;
  action: string;
  target: string;
  details: string | null;
  created_at: string;
}

// Map action types to display info
const getActionInfo = (action: string) => {
  const actionMap: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
    'create_file': { icon: Activity, color: 'bg-green-500/20 text-green-600', label: 'Create File' },
    'delete_file': { icon: Activity, color: 'bg-red-500/20 text-red-600', label: 'Delete File' },
    'upload_file': { icon: Activity, color: 'bg-blue-500/20 text-blue-600', label: 'Upload File' },
    'create_folder': { icon: Activity, color: 'bg-purple-500/20 text-purple-600', label: 'Create Folder' },
    'rename_file': { icon: Activity, color: 'bg-yellow-500/20 text-yellow-600', label: 'Rename' },
    'move_file': { icon: Activity, color: 'bg-orange-500/20 text-orange-600', label: 'Move' },
  };
  return actionMap[action] || { icon: Activity, color: 'bg-blue-500/20 text-blue-600', label: action.replace(/_/g, ' ') };
};

const NotificationCenter = () => {
  const queryClient = useQueryClient();
  
  const { data: logs, refetch } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: async () => {
      const res = await apiClient.get<AuditLog[]>('/audit/logs');
      return res.data;
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      await apiClient.delete('/audit/logs');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });

  const deleteOneMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/audit/logs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });

  const notifications = logs?.slice(0, 20) || [];

  const handleClearAll = () => {
    if (notifications.length > 0) {
      clearAllMutation.mutate();
    }
  };

  const handleDeleteOne = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteOneMutation.mutate(id);
  };

  return (
    <div className="w-80 p-4">
      <div className="flex items-center justify-between mb-4">
        <span className="font-semibold">Notifications</span>
        <button 
          onClick={handleClearAll}
          disabled={notifications.length === 0 || clearAllMutation.isPending}
          className={cn(
            "text-xs transition-colors",
            notifications.length === 0 
              ? "text-muted-foreground cursor-not-allowed" 
              : "text-blue-500 hover:text-blue-600 cursor-pointer"
          )}
        >
          {clearAllMutation.isPending ? 'Clearing...' : 'Clear All'}
        </button>
      </div>
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 text-sm">
            No new notifications
          </div>
        ) : (
          notifications.map((log) => {
            const actionInfo = getActionInfo(log.action);
            const IconComponent = actionInfo.icon;
            return (
              <div 
                key={log.id} 
                className="bg-black/5 dark:bg-white/5 rounded-lg p-3 border border-black/5 dark:border-white/5 group hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className={cn("p-1.5 rounded-md shrink-0", actionInfo.color)}>
                    <IconComponent className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-sm font-medium capitalize truncate">{actionInfo.label}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                        </span>
                        <button
                          onClick={(e) => handleDeleteOne(log.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded transition-all"
                          title="Dismiss"
                        >
                          <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate" title={log.target}>
                      {log.target} {log.details ? `- ${log.details}` : ''}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// Menu items for different app types
const getMenuItemsForApp = (appType: string | null) => {
  switch (appType) {
    case 'finder':
      return {
        appName: 'Finder',
        menus: [
          { label: 'File', items: ['New Folder', 'New Window', 'Close Window'] },
          { label: 'Edit', items: ['Cut', 'Copy', 'Paste', 'Select All'] },
          { label: 'View', items: ['as Icons', 'as List', 'as Columns', 'Show Preview'] },
          { label: 'Go', items: ['Back', 'Forward', 'Enclosing Folder', 'Home', 'Desktop'] },
        ]
      };
    case 'photos':
      return {
        appName: 'Photos',
        menus: [
          { label: 'File', items: ['Import', 'Export', 'Share'] },
          { label: 'Edit', items: ['Rotate', 'Crop', 'Adjust Color'] },
          { label: 'View', items: ['Show Sidebar', 'Zoom In', 'Zoom Out'] },
        ]
      };
    case 'terminal':
      return {
        appName: 'Terminal',
        menus: [
          { label: 'Shell', items: ['New Window', 'New Tab', 'Close Tab'] },
          { label: 'Edit', items: ['Copy', 'Paste', 'Select All', 'Clear'] },
          { label: 'View', items: ['Increase Font Size', 'Decrease Font Size'] },
        ]
      };
    case 'docker':
      return {
        appName: 'Docker Manager',
        menus: [
          { label: 'File', items: ['Refresh', 'Settings'] },
          { label: 'Container', items: ['Start', 'Stop', 'Restart', 'Remove'] },
          { label: 'View', items: ['Show Logs', 'Show Stats'] },
        ]
      };
    default:
      return {
        appName: 'Desktop',
        menus: [
          { label: 'File', items: ['New Folder', 'Get Info'] },
          { label: 'Edit', items: ['Undo', 'Redo'] },
          { label: 'View', items: ['Clean Up', 'Sort By'] },
        ]
      };
  }
};

export const TopBar = () => {
  const [time, setTime] = useState<string>('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const logoutMutation = useLogout();
  const { data: systemStatus } = useSystemStatus();
  const { theme, setTheme } = useTheme();
  const { windows, activeWindowId, showDesktop, toggleShowDesktop } = useWindowStore();
  const { uploadSpeed, downloadSpeed } = useTransferStore();

  const activeWindow = windows.find(w => w.id === activeWindowId);
  const menuConfig = getMenuItemsForApp(activeWindow?.appType || null);

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
      window.location.reload();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }));
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed top-0 left-0 right-0 h-8 bg-black/20 backdrop-blur-md border-b border-white/10 flex items-center justify-between px-4 z-50 text-white/90 text-sm font-medium select-none">
      <SpotlightSearch open={isSearchOpen} onOpenChange={setIsSearchOpen} />
      <div className="flex items-center gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger className="outline-none">
            <span className="font-bold text-lg hover:text-white/70 transition-colors cursor-default"></span>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56 bg-black/80 backdrop-blur-xl border-white/10 text-white">
            <DropdownMenuLabel>Koimsurai NAS</DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-default">
              <Settings className="mr-2 h-4 w-4" />
              <span>System Settings...</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-default">
              <Activity className="mr-2 h-4 w-4" />
              <span>Activity Monitor</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-default">
              Sleep
            </DropdownMenuItem>
            <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-default">
              Restart...
            </DropdownMenuItem>
            <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-default">
              <Power className="mr-2 h-4 w-4" />
              <span>Shut Down...</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem
              className="focus:bg-white/10 focus:text-white cursor-default"
              onClick={handleLogout}
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log Out...</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Show Desktop Button */}
        <button
          className={cn(
            "p-1 hover:bg-white/10 rounded-md transition-colors",
            showDesktop && "text-blue-400 bg-white/10"
          )}
          onClick={toggleShowDesktop}
          title="Show Desktop"
        >
          <div className="w-4 h-4 border-2 border-current rounded-[2px] relative flex items-center justify-center">
            <div className="w-2 h-0.5 bg-current" />
          </div>
        </button>

        <span className="hidden sm:inline hover:bg-white/10 px-2 py-0.5 rounded cursor-default transition-colors font-bold">
          {menuConfig.appName}
        </span>

        {menuConfig.menus.map((menu, index) => (
          <DropdownMenu key={index}>
            <DropdownMenuTrigger className="outline-none">
              <span className="hidden sm:inline hover:bg-white/10 px-2 py-0.5 rounded cursor-default transition-colors">
                {menu.label}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-black/80 backdrop-blur-xl border-white/10 text-white">
              {menu.items.map((item, itemIndex) => (
                <DropdownMenuItem
                  key={itemIndex}
                  className="focus:bg-white/10 focus:text-white cursor-default"
                >
                  {item}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {/* System Monitoring Widget */}
        {systemStatus && (
          <div className="hidden lg:flex items-center gap-3 px-3 py-0.5 mr-2 text-xs text-white/70 border-r border-white/10">
            <div className="flex items-center gap-1" title="CPU Usage">
              <Cpu className="w-3 h-3" />
              <span>{Math.round(systemStatus.cpu_usage)}%</span>
            </div>
            <div className="flex items-center gap-1" title="RAM Usage">
              <Activity className="w-3 h-3" />
              <span>{Math.round((systemStatus.used_memory / systemStatus.total_memory) * 100)}%</span>
            </div>
          </div>
        )}

        {/* Network Speed Widget - Shows actual transfer speeds */}
        {(uploadSpeed > 0 || downloadSpeed > 0) && (
          <div className="hidden md:flex items-center gap-3 px-3 py-0.5 mr-2 text-xs text-white/70 border-r border-white/10">
            {downloadSpeed > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-green-400">↓</span>
                <span>{formatSpeed(downloadSpeed)}</span>
              </div>
            )}
            {uploadSpeed > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-blue-400">↑</span>
                <span>{formatSpeed(uploadSpeed)}</span>
              </div>
            )}
          </div>
        )}

        <div
          className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </div>

        <div
          className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors"
          onClick={() => setIsSearchOpen(true)}
        >
          <Search className="w-4 h-4" />
        </div>

        <ControlCenterPopover />

        <Popover>
          <PopoverTrigger asChild>
            <div className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">
              <div className="relative">
                <Bell className="w-4 h-4" />
                <span className="absolute top-0 right-0 w-1.5 h-1.5 bg-red-500 rounded-full border border-black" />
              </div>
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 mr-2 bg-white/80 dark:bg-black/80 backdrop-blur-xl border-white/20" align="end" sideOffset={8}>
            <NotificationCenter />
          </PopoverContent>
        </Popover>

        <div className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors min-w-[80px] text-center">
          {time}
        </div>
      </div>
    </div>
  );
};