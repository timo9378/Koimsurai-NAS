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
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Cpu, HardDrive, Activity, Thermometer, Monitor, Loader2, LayoutGrid, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSystemStatus } from '@/features/system/api/useSystem';

type TabType = 'overview' | 'cpu' | 'memory' | 'gpu' | 'storage';

const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
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
  const [activeTab, setActiveTab] = useState<TabType>('overview');

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

  // Calculate totals for overview
  const memoryPercent = systemStatus ? (systemStatus.used_memory / systemStatus.total_memory) * 100 : 0;
  const swapPercent = systemStatus && systemStatus.total_swap > 0 ? (systemStatus.used_swap / systemStatus.total_swap) * 100 : 0;
  const totalDiskUsed = systemStatus?.disks?.reduce((acc, disk) => acc + (disk.total_space - disk.available_space), 0) || 0;
  const totalDiskSize = systemStatus?.disks?.reduce((acc, disk) => acc + disk.total_space, 0) || 0;
  const diskPercent = totalDiskSize > 0 ? (totalDiskUsed / totalDiskSize) * 100 : 0;

  const renderOverviewTab = () => {
    const topProcesses = systemStatus?.top_processes || [];

    return (
      <div className="flex flex-col h-full overflow-auto custom-scrollbar">
        {/* Alerts Section */}
        {(memoryPercent > 90 || (systemStatus?.cpu_usage || 0) > 90) && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-2 text-red-400 mb-2">
              <AlertTriangle className="w-5 h-5" />
              <span className="font-semibold">Resource Alerts</span>
            </div>
            <div className="space-y-1 text-sm">
              {(systemStatus?.cpu_usage || 0) > 90 && (
                <div className="text-red-300">• System CPU usage is critical ({systemStatus?.cpu_usage.toFixed(1)}%)</div>
              )}
              {memoryPercent > 90 && (
                <div className="text-red-300">• System memory usage is critical ({memoryPercent.toFixed(1)}%)</div>
              )}
            </div>
          </div>
        )}

        {/* Main Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {/* CPU */}
          <div className="bg-white/5 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Cpu className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-zinc-400">CPU</span>
            </div>
            <div className="text-2xl font-bold text-white">{systemStatus?.cpu_usage.toFixed(1) || '--'}%</div>
            {systemStatus?.cpu_temp && (
              <div className="text-xs text-orange-400 mt-1">{systemStatus.cpu_temp.toFixed(0)}°C</div>
            )}
            <div className="h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${systemStatus?.cpu_usage || 0}%` }} />
            </div>
          </div>

          {/* Memory */}
          <div className="bg-white/5 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-zinc-400">Memory</span>
            </div>
            <div className="text-2xl font-bold text-white">{memoryPercent.toFixed(1)}%</div>
            <div className="text-xs text-zinc-500 mt-1">{formatBytes(systemStatus?.used_memory || 0)} / {formatBytes(systemStatus?.total_memory || 0)}</div>
            <div className="h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-purple-500 transition-all" style={{ width: `${memoryPercent}%` }} />
            </div>
          </div>

          {/* Swap */}
          <div className="bg-white/5 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <HardDrive className="w-4 h-4 text-cyan-400" />
              <span className="text-xs text-zinc-400">Swap</span>
            </div>
            <div className="text-2xl font-bold text-white">{swapPercent.toFixed(1)}%</div>
            <div className="text-xs text-zinc-500 mt-1">{formatBytes(systemStatus?.used_swap || 0)} / {formatBytes(systemStatus?.total_swap || 0)}</div>
            <div className="h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-cyan-500 transition-all" style={{ width: `${swapPercent}%` }} />
            </div>
          </div>

          {/* GPU */}
          {systemStatus?.gpu ? (
            <div className="bg-white/5 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <GpuIcon className="w-4 h-4 text-green-400" />
                <span className="text-xs text-zinc-400">GPU</span>
              </div>
              <div className="text-2xl font-bold text-white">{systemStatus.gpu.utilization}%</div>
              <div className="text-xs text-orange-400 mt-1">{systemStatus.gpu.temperature}°C • {formatBytes(systemStatus.gpu.memory_used)}</div>
              <div className="h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden">
                <div className="h-full bg-green-500 transition-all" style={{ width: `${systemStatus.gpu.utilization}%` }} />
              </div>
            </div>
          ) : (
            <div className="bg-white/5 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <HardDrive className="w-4 h-4 text-orange-400" />
                <span className="text-xs text-zinc-400">Storage</span>
              </div>
              <div className="text-2xl font-bold text-white">{diskPercent.toFixed(1)}%</div>
              <div className="text-xs text-zinc-500 mt-1">{formatBytes(totalDiskUsed)} / {formatBytes(totalDiskSize)}</div>
              <div className="h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden">
                <div className="h-full bg-orange-500 transition-all" style={{ width: `${diskPercent}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Second Row: Top Processes + Storage */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
          {/* Top Processes by CPU */}
          <div className="bg-white/5 rounded-xl p-4 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium text-white">Top Processes</span>
              </div>
              <span className="text-xs text-zinc-400">by CPU usage</span>
            </div>

            {/* Header */}
            <div className="grid grid-cols-12 gap-2 text-[10px] text-zinc-500 mb-2 px-2">
              <div className="col-span-5">Process</div>
              <div className="col-span-2 text-right">PID</div>
              <div className="col-span-2 text-right">CPU</div>
              <div className="col-span-3 text-right">Memory</div>
            </div>

            <div className="flex-1 overflow-auto custom-scrollbar space-y-1">
              {topProcesses.length === 0 ? (
                <div className="flex items-center justify-center h-full text-zinc-500 text-xs">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Loading processes...
                </div>
              ) : (
                topProcesses.slice(0, 12).map((proc, i) => (
                  <div 
                    key={`${proc.pid}-${i}`} 
                    className={cn(
                      "grid grid-cols-12 gap-2 text-xs px-2 py-1.5 rounded-lg",
                      proc.cpu_usage > 50 ? "bg-red-500/10" : proc.cpu_usage > 20 ? "bg-orange-500/10" : "bg-white/5"
                    )}
                  >
                    <div className="col-span-5 text-white truncate" title={proc.name}>{proc.name}</div>
                    <div className="col-span-2 text-right text-zinc-400">{proc.pid}</div>
                    <div className={cn(
                      "col-span-2 text-right font-medium",
                      proc.cpu_usage > 50 ? "text-red-400" : proc.cpu_usage > 20 ? "text-orange-400" : "text-white"
                    )}>
                      {proc.cpu_usage.toFixed(1)}%
                    </div>
                    <div className="col-span-3 text-right text-zinc-300">{formatBytes(proc.memory_bytes)}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Storage Summary */}
          <div className="bg-white/5 rounded-xl p-4 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-medium text-white">Storage Devices</span>
              </div>
              <span className="text-xs text-zinc-400">{systemStatus?.disks?.length || 0} disks</span>
            </div>

            <div className="flex-1 overflow-auto custom-scrollbar space-y-3">
              {systemStatus?.disks?.map((disk, i) => {
                const used = disk.total_space - disk.available_space;
                const percent = (used / disk.total_space) * 100;
                const display = getDiskDisplayName(disk);
                return (
                  <div key={i} className="bg-white/5 rounded-lg p-3">
                    <div className="flex justify-between items-center mb-2">
                      <div>
                        <div className="text-sm text-white font-medium">{display.name}</div>
                        <div className="text-[10px] text-zinc-500">{display.subtitle} • {disk.mount_point}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-white">{formatBytes(disk.available_space)} free</div>
                        <div className="text-[10px] text-zinc-500">of {formatBytes(disk.total_space)}</div>
                      </div>
                    </div>
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full bg-gradient-to-r transition-all", getProgressColor(percent))} style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Real-time Chart */}
        <div className="bg-white/5 rounded-xl p-4 mt-4">
          <div className="text-sm font-medium text-white mb-3">Resource History</div>
          <div className="h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="colorCpuOverview" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorRamOverview" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.1)" vertical={false} />
                <XAxis dataKey="time" stroke="rgba(128,128,128,0.3)" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(128,128,128,0.3)" domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: 12 }} />
                <Area type="monotone" dataKey="cpu" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorCpuOverview)" name="CPU" />
                <Area type="monotone" dataKey="ram" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#colorRamOverview)" name="RAM" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-2 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-1 bg-blue-500 rounded" />
              <span className="text-zinc-400">CPU</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-1 bg-purple-500 rounded" />
              <span className="text-zinc-400">RAM</span>
            </div>
          </div>
        </div>
      </div>
    );
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
        {systemStatus?.cpu_temp && (
          <div className="flex items-center gap-2 text-orange-400">
            <Thermometer className="w-5 h-5" />
            <span className="text-xl font-semibold">{systemStatus.cpu_temp.toFixed(0)}°C</span>
          </div>
        )}
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
      case 'overview': return renderOverviewTab();
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