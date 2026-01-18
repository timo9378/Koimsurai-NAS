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
import { Cpu, HardDrive, Activity, Thermometer, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSystemStatus } from '@/features/system/api/useSystem';

type TabType = 'cpu' | 'memory' | 'gpu' | 'storage';

const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
  { id: 'cpu', label: 'CPU', icon: Cpu },
  { id: 'memory', label: 'Memory', icon: Activity },
  { id: 'gpu', label: 'GPU', icon: Monitor },
  { id: 'storage', label: 'Storage', icon: HardDrive },
];

// GPU Icon SVG component
const GpuIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <rect x="9" y="9" width="6" height="6" />
    <line x1="9" y1="1" x2="9" y2="4" />
    <line x1="15" y1="1" x2="15" y2="4" />
    <line x1="9" y1="20" x2="9" y2="23" />
    <line x1="15" y1="20" x2="15" y2="23" />
    <line x1="20" y1="9" x2="23" y2="9" />
    <line x1="20" y1="14" x2="23" y2="14" />
    <line x1="1" y1="9" x2="4" y2="9" />
    <line x1="1" y1="14" x2="4" y2="14" />
  </svg>
);

export const Dashboard = () => {
  const { data: systemStatus } = useSystemStatus();
  const [history, setHistory] = useState<{ time: string; cpu: number; ram: number; gpu?: number }[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('cpu');

  // Update history when new data arrives
  useEffect(() => {
    if (systemStatus) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const newData = {
        time: timeStr,
        cpu: systemStatus.cpu_usage,
        ram: (systemStatus.used_memory / systemStatus.total_memory) * 100,
        gpu: systemStatus.gpu?.utilization
      };

      const timer = setTimeout(() => {
        setHistory(prev => {
          if (prev.length > 0 && prev[prev.length - 1].time === timeStr) {
            return prev;
          }

          const newHistory = [...prev, newData];
          if (newHistory.length > 20) {
            return newHistory.slice(newHistory.length - 20);
          }
          return newHistory;
        });
      }, 0);

      return () => clearTimeout(timer);
    }
  }, [systemStatus?.cpu_usage, systemStatus?.used_memory, systemStatus?.total_memory, systemStatus?.gpu?.utilization]);

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

  const getDiskDisplayName = (disk: { name: string; mount_point: string; disk_type: string }) => {
    if (disk.mount_point === '/') {
      return { name: 'System', subtitle: disk.disk_type };
    }
    const parts = disk.mount_point.split('/').filter(Boolean);
    const name = parts[parts.length - 1] || disk.name;
    return { name, subtitle: disk.disk_type };
  };

  const renderCpuTab = () => (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <Cpu className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <div className="text-sm text-zinc-400">CPU Usage</div>
            <div className="text-3xl font-bold text-white">
              {systemStatus ? `${systemStatus.cpu_usage.toFixed(1)}%` : '--'}
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={history}>
            <defs>
              <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.5} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.1)" vertical={false} />
            <XAxis dataKey="time" stroke="rgba(128,128,128,0.5)" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
            <YAxis stroke="rgba(128,128,128,0.5)" domain={['dataMin - 5', 'dataMax + 10']} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(value) => `${Math.round(value)}%`} />
            <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff' }} />
            <Area type="monotone" dataKey="cpu" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorCpu)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  const renderMemoryTab = () => (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <Activity className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <div className="text-sm text-zinc-400">Memory Usage</div>
            <div className="text-3xl font-bold text-white">
              {systemStatus ? `${((systemStatus.used_memory / systemStatus.total_memory) * 100).toFixed(1)}%` : '--'}
            </div>
          </div>
        </div>
        {systemStatus && (
          <div className="text-right text-sm text-zinc-400">
            {formatBytes(systemStatus.used_memory)} / {formatBytes(systemStatus.total_memory)}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={history}>
            <defs>
              <linearGradient id="colorRam" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.5} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.1)" vertical={false} />
            <XAxis dataKey="time" stroke="rgba(128,128,128,0.5)" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
            <YAxis stroke="rgba(128,128,128,0.5)" domain={['dataMin - 5', 'dataMax + 10']} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(value) => `${Math.round(value)}%`} />
            <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff' }} />
            <Area type="monotone" dataKey="ram" stroke="#8b5cf6" strokeWidth={3} fillOpacity={1} fill="url(#colorRam)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  const renderGpuTab = () => {
    if (!systemStatus?.gpu) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-zinc-400">
          <Monitor className="w-16 h-16 mb-4 opacity-50" />
          <div className="text-lg">No GPU Detected</div>
        </div>
      );
    }

    const gpu = systemStatus.gpu;
    const vramPercent = (gpu.memory_used / gpu.memory_total) * 100;

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <GpuIcon className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <div className="text-sm text-zinc-400">{gpu.name}</div>
              <div className="text-3xl font-bold text-white">{gpu.utilization}%</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-orange-400">
            <Thermometer className="w-5 h-5" />
            <span className="text-xl font-semibold">{gpu.temperature}°C</span>
          </div>
        </div>

        <div className="flex-1 min-h-[200px] mb-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history}>
              <defs>
                <linearGradient id="colorGpu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.1)" vertical={false} />
              <XAxis dataKey="time" stroke="rgba(128,128,128,0.5)" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis stroke="rgba(128,128,128,0.5)" domain={['dataMin - 5', 'dataMax + 10']} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(value) => `${Math.round(value)}%`} />
              <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff' }} />
              <Area type="monotone" dataKey="gpu" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorGpu)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* VRAM Usage */}
        <div className="bg-white/5 rounded-xl p-4">
          <div className="flex justify-between mb-2">
            <span className="text-sm text-zinc-400">VRAM</span>
            <span className="text-sm text-white">{formatBytes(gpu.memory_used)} / {formatBytes(gpu.memory_total)}</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full bg-gradient-to-r", getProgressColor(vramPercent))} style={{ width: `${vramPercent}%` }} />
          </div>
        </div>
      </div>
    );
  };

  const renderStorageTab = () => (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-orange-500/20 rounded-lg">
          <HardDrive className="w-6 h-6 text-orange-400" />
        </div>
        <div className="text-lg font-semibold text-white">Storage Devices</div>
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar space-y-4">
        {systemStatus?.disks?.map((disk, i) => {
          const percentage = ((disk.total_space - disk.available_space) / disk.total_space) * 100;
          const display = getDiskDisplayName(disk);
          return (
            <div key={i} className="bg-white/5 rounded-xl p-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="font-medium text-white">{display.name}</div>
                  <div className="text-xs text-zinc-500">{display.subtitle}</div>
                </div>
                <div className="text-right">
                  <span className="text-xl font-bold text-white">{formatBytes(disk.available_space)}</span>
                  <span className="text-zinc-400 text-sm"> / {formatBytes(disk.total_space)}</span>
                </div>
              </div>
              <div className="h-3 bg-white/10 rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full bg-gradient-to-r transition-all", getProgressColor(percentage))} style={{ width: `${percentage}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'cpu': return renderCpuTab();
      case 'memory': return renderMemoryTab();
      case 'gpu': return renderGpuTab();
      case 'storage': return renderStorageTab();
    }
  };

  return (
    <div className="h-full flex flex-col bg-white/20 dark:bg-zinc-950/20 backdrop-blur-3xl">
      {/* Tab Bar */}
      <div className="flex border-b border-white/10">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-all",
                activeTab === tab.id
                  ? "text-white bg-white/10 border-b-2 border-blue-500"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              )}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 p-6 overflow-hidden">
        {renderTabContent()}
      </div>
    </div>
  );
};