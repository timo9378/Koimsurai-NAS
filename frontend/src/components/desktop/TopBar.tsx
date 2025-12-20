'use client';

import React, { useState, useEffect } from 'react';
import {
  Wifi,
  Battery,
  Search,
  Command,
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
  Sun
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
import { useSystemStatus } from '@/features/system/api/useSystem';
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { SpotlightSearch } from './SpotlightSearch';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Job } from '@/types/api';
import { Progress } from "@/components/ui/progress"
import { useWindowStore } from '@/store/window-store';

const TaskManager = () => {
  const { data: tasks } = useQuery({
    queryKey: ['jobs'],
    queryFn: async () => {
      const res = await apiClient.get<Job[]>('/api/tasks');
      return res.data;
    },
    refetchInterval: 2000, // Fallback if WS fails
  });

  const activeTasks = tasks?.filter(t => t.status === 'processing' || t.status === 'pending') || [];
  const recentTasks = tasks?.slice(0, 5) || [];

  return (
    <div className="w-80 p-4">
      <div className="flex items-center justify-between mb-4">
        <span className="font-semibold">Background Tasks</span>
        {activeTasks.length > 0 && (
          <span className="text-xs text-blue-500 animate-pulse">{activeTasks.length} running</span>
        )}
      </div>
      <div className="space-y-3 max-h-[300px] overflow-y-auto">
        {recentTasks.length === 0 ? (
          <div className="text-center text-muted-foreground py-4 text-sm">
            No active tasks
          </div>
        ) : (
          recentTasks.map((task) => (
            <div key={task.id} className="bg-black/5 dark:bg-white/5 rounded-lg p-3 border border-black/5 dark:border-white/5">
              <div className="flex items-start gap-3">
                <div className="mt-1">
                  {task.status === 'processing' ? (
                    <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                  ) : task.status === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  ) : task.status === 'failed' ? (
                    <XCircle className="w-4 h-4 text-red-500" />
                  ) : (
                    <Activity className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex justify-between items-start">
                    <span className="text-sm font-medium capitalize">{task.job_type.replace('_', ' ')}</span>
                    <span className="text-[10px] text-muted-foreground capitalize">{task.status}</span>
                  </div>
                  {task.status === 'processing' && (
                    <div className="h-1.5 w-full bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-500"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  )}
                  {task.error && (
                    <p className="text-xs text-red-500">{task.error}</p>
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
  return (
    <div className="w-80 p-4 grid grid-cols-2 gap-3">
      <div className="col-span-2 bg-black/20 dark:bg-white/10 rounded-xl p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500 rounded-full text-white">
            <Wifi className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium">Wi-Fi</span>
            <span className="text-xs text-muted-foreground">Koimsurai-5G</span>
          </div>
        </div>
        <Switch checked />
      </div>

      <div className="col-span-2 bg-black/20 dark:bg-white/10 rounded-xl p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500 rounded-full text-white">
            <Activity className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium">Performance</span>
            <span className="text-xs text-muted-foreground">Balanced</span>
          </div>
        </div>
        <Switch checked />
      </div>

      <div className="bg-black/20 dark:bg-white/10 rounded-xl p-3 flex flex-col gap-2">
        <div className="p-2 bg-orange-500 w-fit rounded-full text-white">
          <HardDrive className="w-4 h-4" />
        </div>
        <span className="text-sm font-medium">SMB</span>
        <span className="text-xs text-muted-foreground">On</span>
      </div>

      <div className="bg-black/20 dark:bg-white/10 rounded-xl p-3 flex flex-col gap-2">
        <div className="p-2 bg-green-500 w-fit rounded-full text-white">
          <Cpu className="w-4 h-4" />
        </div>
        <span className="text-sm font-medium">Docker</span>
        <span className="text-xs text-muted-foreground">Running</span>
      </div>

      <div className="col-span-2 bg-black/20 dark:bg-white/10 rounded-xl p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Fan Speed</span>
          <span className="text-xs text-muted-foreground">Auto</span>
        </div>
        <Slider defaultValue={[50]} max={100} step={1} />
      </div>
    </div>
  );
};

import { formatDistanceToNow } from 'date-fns';

interface AuditLog {
  id: number;
  user_id: number;
  action: string;
  resource: string;
  details: string | null;
  created_at: string;
}

const NotificationCenter = () => {
  const { data: logs } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: async () => {
      const res = await apiClient.get<AuditLog[]>('/api/audit/logs');
      return res.data;
    },
  });

  const notifications = logs?.slice(0, 10) || [];

  return (
    <div className="w-80 p-4">
      <div className="flex items-center justify-between mb-4">
        <span className="font-semibold">Notifications</span>
        <span className="text-xs text-blue-500 cursor-pointer">Clear All</span>
      </div>
      <div className="space-y-3 max-h-[400px] overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="text-center text-muted-foreground py-4 text-sm">
            No new notifications
          </div>
        ) : (
          notifications.map((log) => (
            <div key={log.id} className="bg-black/5 dark:bg-white/5 rounded-lg p-3 border border-black/5 dark:border-white/5">
              <div className="flex items-start gap-3">
                <div className="p-1.5 bg-blue-500/20 text-blue-600 rounded-md">
                  <Activity className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <span className="text-sm font-medium capitalize">{log.action.replace('_', ' ')}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {log.resource} {log.details ? `- ${log.details}` : ''}
                  </p>
                </div>
              </div>
            </div>
          ))
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
  const { windows, activeWindowId } = useWindowStore();

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
        {/* Network Speed Widget */}
        <div className="hidden md:flex items-center gap-3 px-3 py-0.5 mr-2 text-xs text-white/70 border-r border-white/10">
          <div className="flex items-center gap-1">
            <span className="text-green-400">↓</span>
            <span>12.5 MB/s</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-blue-400">↑</span>
            <span>5.2 MB/s</span>
          </div>
        </div>

        <div
          className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </div>

        <div className="flex items-center gap-2 hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">
          <Battery className="w-4 h-4" />
          <span className="text-xs">100%</span>
        </div>
        
        <div className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">
          <Wifi className="w-4 h-4" />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <div className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">
              <RefreshCw className="w-4 h-4" />
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 mr-2 bg-white/80 dark:bg-black/80 backdrop-blur-xl border-white/20" align="end" sideOffset={8}>
            <TaskManager />
          </PopoverContent>
        </Popover>

        <div
          className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors"
          onClick={() => setIsSearchOpen(true)}
        >
          <Search className="w-4 h-4" />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <div className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">
              <Sliders className="w-4 h-4" />
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 mr-2 bg-white/80 dark:bg-black/80 backdrop-blur-xl border-white/20" align="end" sideOffset={8}>
            <ControlCenter />
          </PopoverContent>
        </Popover>

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