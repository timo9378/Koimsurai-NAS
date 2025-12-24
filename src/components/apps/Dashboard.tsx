'use client';

import React, { useState, useEffect } from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
} from 'recharts';
import { Cpu, HardDrive, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSystemStatus } from '@/features/system/api/useSystem';

const Widget = ({ title, icon: Icon, children, className, value }: { title: string, icon: React.ElementType, children: React.ReactNode, className?: string, value?: string }) => (
  <div className={cn("bg-white/30 dark:bg-black/30 backdrop-blur-xl border border-white/20 dark:border-white/10 rounded-2xl p-6 flex flex-col shadow-lg", className)}>
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3 text-gray-600 dark:text-zinc-400">
        <div className="p-2 bg-white/40 dark:bg-white/5 rounded-lg shadow-sm">
          <Icon className="w-5 h-5" />
        </div>
        <span className="font-medium text-sm tracking-wide uppercase">{title}</span>
      </div>
      {value && (
        <span className="text-2xl font-bold text-gray-800 dark:text-white tracking-tight">{value}</span>
      )}
    </div>
    <div className="flex-1 min-h-0 relative">
      {children}
    </div>
  </div>
);

export const Dashboard = () => {
  const { data: systemStatus } = useSystemStatus();
  const [history, setHistory] = useState<{ time: string; cpu: number; ram: number }[]>([]);

  // Update history when new data arrives
  useEffect(() => {
    if (systemStatus) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const newData = {
        time: timeStr,
        cpu: systemStatus.cpu_usage,
        ram: (systemStatus.used_memory / systemStatus.total_memory) * 100
      };
      
      // Use setTimeout to avoid synchronous state update warning
      const timer = setTimeout(() => {
        setHistory(prev => {
          // Check if the last data point is the same to avoid duplicates
          if (prev.length > 0 && prev[prev.length - 1].time === timeStr) {
            return prev;
          }
          
          const newHistory = [...prev, newData];
          // Keep last 20 data points
          if (newHistory.length > 20) {
            return newHistory.slice(newHistory.length - 20);
          }
          return newHistory;
        });
      }, 0);

      return () => clearTimeout(timer);
    }
  }, [systemStatus?.cpu_usage, systemStatus?.used_memory, systemStatus?.total_memory]);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getProgressColor = (percentage: number) => {
    if (percentage > 90) return "from-red-500 to-rose-600";
    if (percentage > 75) return "from-amber-400 to-orange-500";
    return "from-emerald-400 to-teal-500";
  };

  return (
    <div className="h-full p-8 overflow-auto bg-white/20 dark:bg-zinc-950/20 backdrop-blur-3xl">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 h-full max-h-[800px]">
        {/* CPU Usage */}
        <Widget 
          title="CPU Usage" 
          icon={Cpu} 
          className="col-span-2 row-span-1"
          value={systemStatus ? `${systemStatus.cpu_usage.toFixed(1)}%` : '--'}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history}>
              <defs>
                <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.5}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.1)" vertical={false} />
              <XAxis 
                dataKey="time" 
                stroke="rgba(128,128,128,0.5)" 
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                stroke="rgba(128,128,128,0.5)" 
                domain={[0, 100]} 
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${value}%`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '12px', backdropFilter: 'blur(8px)', color: '#000' }}
                itemStyle={{ color: '#3b82f6' }}
                labelStyle={{ color: 'rgba(0,0,0,0.5)', marginBottom: '0.5rem' }}
              />
              <Area 
                type="monotone" 
                dataKey="cpu" 
                stroke="#3b82f6" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorCpu)" 
                animationDuration={500}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Widget>

        {/* Storage */}
        <Widget title="Storage" icon={HardDrive} className="col-span-1 row-span-2">
          <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2 custom-scrollbar">
            {systemStatus?.disks.map((disk, i) => {
              const used = disk.total_space - disk.available_space;
              const percentage = (used / disk.total_space) * 100;
              
              return (
                <div key={i} className="space-y-3">
                  <div className="flex justify-between items-end">
                    <div className="flex flex-col">
                      <span className="text-gray-800 dark:text-white font-medium truncate max-w-[140px]" title={disk.name || `Disk ${i + 1}`}>
                        {disk.name || `Disk ${i + 1}`}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-zinc-500">Local Disk</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm text-gray-600 dark:text-zinc-300 font-medium">{formatBytes(used)}</span>
                      <span className="text-xs text-gray-400 dark:text-zinc-500 ml-1">/ {formatBytes(disk.total_space)}</span>
                    </div>
                  </div>
                  
                  <div className="h-3 bg-gray-200 dark:bg-zinc-800/50 rounded-full overflow-hidden ring-1 ring-black/5 dark:ring-white/5">
                    <div
                      className={cn("h-full rounded-full transition-all duration-500 bg-gradient-to-r", getProgressColor(percentage))}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Widget>

        {/* RAM Usage */}
        <Widget 
          title="Memory Usage" 
          icon={Activity} 
          className="col-span-2 row-span-1"
          value={systemStatus ? `${((systemStatus.used_memory / systemStatus.total_memory) * 100).toFixed(1)}%` : '--'}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history}>
              <defs>
                <linearGradient id="colorRam" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.5}/>
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.1)" vertical={false} />
              <XAxis 
                dataKey="time" 
                stroke="rgba(128,128,128,0.5)" 
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                stroke="rgba(128,128,128,0.5)" 
                domain={[0, 100]} 
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${value}%`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '12px', backdropFilter: 'blur(8px)', color: '#000' }}
                itemStyle={{ color: '#8b5cf6' }}
                labelStyle={{ color: 'rgba(0,0,0,0.5)', marginBottom: '0.5rem' }}
              />
              <Area 
                type="monotone" 
                dataKey="ram" 
                stroke="#8b5cf6" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorRam)" 
                animationDuration={500}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Widget>
      </div>
    </div>
  );
};