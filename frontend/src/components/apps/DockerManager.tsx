'use client';

import React, { useState } from 'react';
import { 
  Play, 
  Square, 
  RotateCw, 
  Trash2, 
  Terminal, 
  ExternalLink, 
  MoreVertical,
  Box,
  Layers,
  Plus,
  Search,
  Cpu,
  Activity
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useContainers,
  useContainerActions,
  useContainerStats,
  useContainerLogs,
  ContainerInfo
} from '@/features/docker/api/useDocker';
import { TerminalView } from './TerminalView';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ContainerCard = ({ container }: { container: ContainerInfo }) => {
  const { start, stop, restart, remove } = useContainerActions();
  const { data: stats } = useContainerStats(container.id, container.state === 'running');
  const [showLogs, setShowLogs] = useState(false);
  const { data: logs, isLoading: isLoadingLogs } = useContainerLogs(container.id, showLogs);

  const isRunning = container.state === 'running';
  const webPort = container.ports.find(p => p.public_port);

  return (
    <div className="bg-white/40 dark:bg-black/40 backdrop-blur-md border border-white/10 rounded-xl p-4 flex flex-col gap-4 group hover:bg-white/50 dark:hover:bg-black/50 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center text-white shadow-lg",
            isRunning ? "bg-green-500" : "bg-gray-500"
          )}>
            <Box className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-medium text-sm truncate max-w-[150px]" title={container.names[0]}>
              {container.names[0].replace(/^\//, '')}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px]" title={container.image}>
              {container.image}
            </p>
          </div>
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded">
            <MoreVertical className="w-4 h-4 text-gray-500" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setShowLogs(true)}>
              <Terminal className="mr-2 h-4 w-4" /> Logs
            </DropdownMenuItem>
            <DropdownMenuItem className="text-red-600" onClick={() => remove.mutate(container.id)}>
              <Trash2 className="mr-2 h-4 w-4" /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5" />
          <span>{stats ? `${stats.cpu_usage.toFixed(1)}%` : '--'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" />
          <span>{stats ? `${(stats.memory_usage / 1024 / 1024).toFixed(0)} MB` : '--'}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-auto pt-2 border-t border-white/10">
        {isRunning ? (
          <button
            onClick={() => stop.mutate(container.id)}
            className="p-1.5 rounded-md hover:bg-red-500/10 text-red-600 transition-colors"
            title="Stop"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>
        ) : (
          <button
            onClick={() => start.mutate(container.id)}
            className="p-1.5 rounded-md hover:bg-green-500/10 text-green-600 transition-colors"
            title="Start"
          >
            <Play className="w-4 h-4 fill-current" />
          </button>
        )}
        
        <button
          onClick={() => restart.mutate(container.id)}
          className="p-1.5 rounded-md hover:bg-blue-500/10 text-blue-600 transition-colors"
          title="Restart"
        >
          <RotateCw className="w-4 h-4" />
        </button>

        {webPort && isRunning && (
          <a
            href={`http://${window.location.hostname}:${webPort.public_port}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-500 text-white text-xs font-medium hover:bg-blue-600 transition-colors"
          >
            Open <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      <Dialog open={showLogs} onOpenChange={setShowLogs}>
        <DialogContent className="max-w-3xl h-[600px] flex flex-col bg-[#1e1e1e] text-white border-white/10">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5" />
              {container.names[0]} - Logs
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 bg-black rounded-md overflow-hidden">
            <TerminalView logs={logs || ''} isLoading={isLoadingLogs} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const DockerManager = () => {
  const { data: containers, isLoading } = useContainers();
  const [filter, setFilter] = useState('');

  const filteredContainers = containers?.filter(c => 
    c.names.some(n => n.toLowerCase().includes(filter.toLowerCase())) ||
    c.image.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="flex h-full bg-white/50 dark:bg-black/50 backdrop-blur-xl rounded-lg overflow-hidden border border-white/20 shadow-2xl">
      {/* Sidebar */}
      <div className="w-48 flex flex-col gap-6 p-4 border-r border-white/10 bg-zinc-50/80 dark:bg-zinc-900/80 backdrop-blur-xl">
        <div className="space-y-1">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-2 mb-2">Docker</div>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-blue-500 text-white text-sm font-medium cursor-pointer">
            <Box className="w-4 h-4" />
            <span>Containers</span>
          </div>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 text-sm cursor-pointer transition-colors">
            <Layers className="w-4 h-4" />
            <span>Images</span>
          </div>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 text-sm cursor-pointer transition-colors">
            <Activity className="w-4 h-4" />
            <span>Networks</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-white/40 dark:bg-black/40">
        {/* Toolbar */}
        <div className="h-14 flex items-center justify-between px-6 border-b border-white/10 bg-white/40 dark:bg-black/40 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-gray-800 dark:text-white">Containers</h1>
            <div className="h-6 w-px bg-gray-300 dark:bg-gray-700" />
            <div className="relative group">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-blue-500 transition-colors" />
              <input 
                type="text" 
                placeholder="Search containers..." 
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-64 h-9 pl-9 pr-3 text-sm bg-black/5 dark:bg-white/10 rounded-md border border-transparent focus:border-blue-500 focus:outline-none text-gray-700 dark:text-gray-200 placeholder:text-gray-500 transition-all"
              />
            </div>
          </div>

          <button className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-sm font-medium transition-colors shadow-sm">
            <Plus className="w-4 h-4" />
            <span>Add Container</span>
          </button>
        </div>

        {/* Container Grid */}
        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-gray-500">Loading containers...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredContainers?.map((container) => (
                <ContainerCard key={container.id} container={container} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};