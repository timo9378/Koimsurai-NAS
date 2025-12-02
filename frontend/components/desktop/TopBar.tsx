'use client';

import React, { useState, useEffect } from 'react';
import { Wifi, Battery, Search, Command } from 'lucide-react';
import { cn } from '@/lib/utils';

export const TopBar = () => {
  const [time, setTime] = useState<string>('');

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
        <span className="font-bold text-lg"></span>
        <span className="hidden sm:inline hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">Finder</span>
        <span className="hidden sm:inline hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">File</span>
        <span className="hidden sm:inline hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">Edit</span>
        <span className="hidden sm:inline hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">View</span>
        <span className="hidden sm:inline hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">Go</span>
        <span className="hidden sm:inline hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">Window</span>
        <span className="hidden sm:inline hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer transition-colors">Help</span>
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