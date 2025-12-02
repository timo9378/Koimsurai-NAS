'use client';

import React, { useState, useEffect } from 'react';
import { Wifi, Battery, Search, Command, LogOut, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useLogout } from '@/features/auth/api/useAuth';

export const TopBar = () => {
  const [time, setTime] = useState<string>('');
  const logoutMutation = useLogout();

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
      <div className="flex items-center gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger className="outline-none">
            <span className="font-bold text-lg hover:text-white/70 transition-colors cursor-default"></span>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56 bg-black/80 backdrop-blur-xl border-white/10 text-white">
            <DropdownMenuLabel>System</DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-default">
              <Settings className="mr-2 h-4 w-4" />
              <span>System Settings...</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-default">
              Sleep
            </DropdownMenuItem>
            <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-default">
              Restart...
            </DropdownMenuItem>
            <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-default">
              Shut Down...
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
        
        <span className="hidden sm:inline hover:bg-white/10 px-2 py-0.5 rounded cursor-default transition-colors">Finder</span>
        <span className="hidden sm:inline hover:bg-white/10 px-2 py-0.5 rounded cursor-default transition-colors">File</span>
        <span className="hidden sm:inline hover:bg-white/10 px-2 py-0.5 rounded cursor-default transition-colors">Edit</span>
        <span className="hidden sm:inline hover:bg-white/10 px-2 py-0.5 rounded cursor-default transition-colors">View</span>
        <span className="hidden sm:inline hover:bg-white/10 px-2 py-0.5 rounded cursor-default transition-colors">Go</span>
        <span className="hidden sm:inline hover:bg-white/10 px-2 py-0.5 rounded cursor-default transition-colors">Window</span>
        <span className="hidden sm:inline hover:bg-white/10 px-2 py-0.5 rounded cursor-default transition-colors">Help</span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">
          <Battery className="w-4 h-4" />
          <span className="text-xs">100%</span>
        </div>
        <div className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">
          <Wifi className="w-4 h-4" />
        </div>
        <div className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">
          <Search className="w-4 h-4" />
        </div>
        <div className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">
          <Command className="w-4 h-4" />
        </div>
        <div className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors min-w-[80px] text-center">
          {time}
        </div>
      </div>
    </div>
  );
};