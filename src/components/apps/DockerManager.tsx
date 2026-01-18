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
  Cpu,
  Activity,
  Shell,
  Search,
  Network,
  Download,
  HardDrive,
  LayoutGrid,
  List
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useContainerStats,
  useContainerLogs,
  useContainerActions,
  useContainers,
  useImages,
  useNetworks,
  usePullImage,
  useRemoveImage,
  type ContainerInfo,
  type ImageInfo,
  type NetworkInfo
} from '@/features/docker/api/useDocker';
import { useWindowStore } from '../../store/window-store';
import dynamic from 'next/dynamic';
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

const TerminalView = dynamic(() => import('./TerminalView').then(mod => mod.TerminalView), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#1e1e1e] animate-pulse" />
});



type TabType = 'containers' | 'images' | 'networks';
type ViewMode = 'grid' | 'list';

// ==================== 容器卡片 (Grid Mode) ====================
const ContainerCard = ({ container }: { container: ContainerInfo }) => {
  const { start, stop, restart, remove } = useContainerActions();
  const { data: stats } = useContainerStats(container.id, container.state === 'running');
  const [showLogs, setShowLogs] = useState(false);
  const { openWindow } = useWindowStore();
  const { data: logs, isLoading: isLoadingLogs } = useContainerLogs(container.id, showLogs);

  const isRunning = container.state === 'running';
  const webPort = container.ports.find(p => p.public_port);

  return (
    <div className="bg-white/40 dark:bg-black/40 backdrop-blur-md border border-white/10 rounded-xl p-4 flex flex-col gap-3 group hover:bg-white/50 dark:hover:bg-black/50 transition-colors min-w-0">
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center text-white shadow-lg shrink-0",
            isRunning ? "bg-green-500" : "bg-gray-500"
          )}>
            <Box className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate" title={container.names[0]}>
              {container.names[0].replace(/^\//, '')}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate" title={container.image}>
              {container.image}
            </p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded shrink-0">
            <MoreVertical className="w-4 h-4 text-gray-500" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setShowLogs(true)}>
              <Terminal className="mr-2 h-4 w-4" /> Logs
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openWindow('terminal', `Terminal - ${container.names[0]}`, { containerId: container.id })}>
              <Shell className="mr-2 h-4 w-4" /> Terminal
            </DropdownMenuItem>
            <DropdownMenuItem className="text-red-600" onClick={() => remove.mutate(container.id)}>
              <Trash2 className="mr-2 h-4 w-4" /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{stats ? `${stats.cpu_percent.toFixed(1)}%` : '--'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <HardDrive className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{stats ? `${(stats.memory_usage / 1024 / 1024).toFixed(0)} MB` : '--'}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-white/10">
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

// ==================== 容器列表項 (List Mode) ====================
const ContainerListItem = ({ container }: { container: ContainerInfo }) => {
  const { start, stop, restart, remove } = useContainerActions();
  const { data: stats } = useContainerStats(container.id, container.state === 'running');
  const [showLogs, setShowLogs] = useState(false);
  const { openWindow } = useWindowStore();
  const { data: logs, isLoading: isLoadingLogs } = useContainerLogs(container.id, showLogs);

  const isRunning = container.state === 'running';
  const webPort = container.ports.find(p => p.public_port);

  return (
    <>
      <div className="flex items-center gap-4 p-3 bg-white/40 dark:bg-black/40 backdrop-blur-md border border-white/10 rounded-lg hover:bg-white/50 dark:hover:bg-black/50 transition-colors group">
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0",
          isRunning ? "bg-green-500" : "bg-gray-500"
        )}>
          <Box className="w-5 h-5" />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-sm truncate" title={container.names[0]}>
            {container.names[0].replace(/^\//, '')}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate" title={container.image}>
            {container.image}
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 shrink-0">
          <div className="flex items-center gap-1">
            <Cpu className="w-3.5 h-3.5" />
            <span>{stats ? `${stats.cpu_percent.toFixed(1)}%` : '--'}</span>
          </div>
          <div className="flex items-center gap-1">
            <HardDrive className="w-3.5 h-3.5" />
            <span>{stats ? `${(stats.memory_usage / 1024 / 1024).toFixed(0)} MB` : '--'}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
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

          <DropdownMenu>
            <DropdownMenuTrigger className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-opacity">
              <MoreVertical className="w-4 h-4 text-gray-500" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowLogs(true)}>
                <Terminal className="mr-2 h-4 w-4" /> Logs
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openWindow('terminal', `Terminal - ${container.names[0]}`, { containerId: container.id })}>
                <Shell className="mr-2 h-4 w-4" /> Terminal
              </DropdownMenuItem>
              <DropdownMenuItem className="text-red-600" onClick={() => remove.mutate(container.id)}>
                <Trash2 className="mr-2 h-4 w-4" /> Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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


    </>
  );
};

// ==================== 映像卡片 ====================
const ImageCard = ({ image, viewMode }: { image: ImageInfo; viewMode: ViewMode }) => {
  const removeImage = useRemoveImage();

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  const displayName = image.tags?.[0] || image.id.slice(0, 12);

  if (viewMode === 'list') {
    return (
      <div className="flex items-center gap-4 p-3 bg-white/40 dark:bg-black/40 backdrop-blur-md border border-white/10 rounded-lg hover:bg-white/50 dark:hover:bg-black/50 transition-colors group">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 bg-purple-500">
          <Layers className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-sm truncate" title={displayName}>{displayName}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{image.id.replace('sha256:', '').slice(0, 12)}</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 shrink-0">
          <span>{formatSize(image.size)}</span>
          <span>{formatDate(image.created)}</span>
        </div>
        <button
          onClick={() => removeImage.mutate(image.id)}
          className="p-1.5 rounded-md hover:bg-red-500/10 text-red-600 transition-colors shrink-0"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white/40 dark:bg-black/40 backdrop-blur-md border border-white/10 rounded-xl p-4 flex flex-col gap-3 group hover:bg-white/50 dark:hover:bg-black/50 transition-colors min-w-0">
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white shadow-lg shrink-0 bg-purple-500">
            <Layers className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate" title={displayName}>{displayName}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{image.id.replace('sha256:', '').slice(0, 12)}</p>
          </div>
        </div>
        <button
          onClick={() => removeImage.mutate(image.id)}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/10 text-red-600 rounded transition-all shrink-0"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-1.5">
          <HardDrive className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{formatSize(image.size)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{formatDate(image.created)}</span>
        </div>
      </div>
    </div>
  );
};

// ==================== 網絡卡片 ====================
const NetworkCard = ({ network, viewMode }: { network: NetworkInfo; viewMode: ViewMode }) => {
  if (viewMode === 'list') {
    return (
      <div className="flex items-center gap-4 p-3 bg-white/40 dark:bg-black/40 backdrop-blur-md border border-white/10 rounded-lg hover:bg-white/50 dark:hover:bg-black/50 transition-colors">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 bg-blue-500">
          <Network className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-sm truncate" title={network.name}>{network.name}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{network.id.slice(0, 12)}</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 shrink-0">
          <span>{network.driver}</span>
          <span>{network.scope}</span>
          <span>{network.containers} containers</span>
        </div>
        {network.internal && (
          <span className="px-1.5 py-0.5 bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200 rounded text-xs shrink-0">
            Internal
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white/40 dark:bg-black/40 backdrop-blur-md border border-white/10 rounded-xl p-4 flex flex-col gap-3 hover:bg-white/50 dark:hover:bg-black/50 transition-colors min-w-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white shadow-lg shrink-0 bg-blue-500">
          <Network className="w-6 h-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-sm truncate" title={network.name}>{network.name}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{network.id.slice(0, 12)}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
        <div><span className="font-medium">Driver:</span> {network.driver}</div>
        <div><span className="font-medium">Scope:</span> {network.scope}</div>
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-white/10">
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Box className="w-3.5 h-3.5" />
          <span>{network.containers} containers</span>
        </div>
        {network.internal && (
          <span className="px-1.5 py-0.5 bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200 rounded text-xs">
            Internal
          </span>
        )}
      </div>
    </div>
  );
};

// ==================== Pull Image 對話框 ====================
const PullImageDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const [imageName, setImageName] = useState('');
  const [tag, setTag] = useState('latest');
  const pullImage = usePullImage();

  const handlePull = () => {
    if (imageName.trim()) {
      pullImage.mutate({ image: imageName.trim(), tag: tag.trim() || 'latest' });
      onOpenChange(false);
      setImageName('');
      setTag('latest');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5" />
            Pull Image
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Image Name</label>
            <input
              type="text"
              placeholder="e.g. nginx, ubuntu, mysql"
              value={imageName}
              onChange={(e) => setImageName(e.target.value)}
              className="mt-1 w-full h-10 px-3 text-sm bg-black/5 dark:bg-white/10 rounded-md border border-transparent focus:border-blue-500 focus:outline-none text-gray-700 dark:text-gray-200 placeholder:text-gray-500"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tag</label>
            <input
              type="text"
              placeholder="latest"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              className="mt-1 w-full h-10 px-3 text-sm bg-black/5 dark:bg-white/10 rounded-md border border-transparent focus:border-blue-500 focus:outline-none text-gray-700 dark:text-gray-200 placeholder:text-gray-500"
            />
          </div>
          <button
            onClick={handlePull}
            disabled={!imageName.trim() || pullImage.isPending}
            className="w-full h-10 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded-md text-sm font-medium transition-colors"
          >
            {pullImage.isPending ? 'Pulling...' : 'Pull Image'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ==================== 主組件 ====================
export const DockerManager = () => {
  const [activeTab, setActiveTab] = useState<TabType>('containers');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filter, setFilter] = useState('');
  const [showPullDialog, setShowPullDialog] = useState(false);

  const { data: containers, isLoading: containersLoading } = useContainers();
  const { data: images, isLoading: imagesLoading } = useImages();
  const { data: networks, isLoading: networksLoading } = useNetworks();

  const containerList = Array.isArray(containers) ? containers : [];
  const imageList = Array.isArray(images) ? images : [];
  const networkList = Array.isArray(networks) ? networks : [];

  const filteredContainers = containerList.filter(c =>
    c.names.some(n => n.toLowerCase().includes(filter.toLowerCase())) ||
    c.image.toLowerCase().includes(filter.toLowerCase())
  );

  const filteredImages = imageList.filter(img =>
    img.tags?.some(t => t.toLowerCase().includes(filter.toLowerCase())) ||
    img.id.toLowerCase().includes(filter.toLowerCase())
  );

  const filteredNetworks = networkList.filter(n =>
    n.name.toLowerCase().includes(filter.toLowerCase()) ||
    n.driver.toLowerCase().includes(filter.toLowerCase())
  );

  const isLoading = activeTab === 'containers' ? containersLoading :
    activeTab === 'images' ? imagesLoading : networksLoading;

  const getTabTitle = () => {
    switch (activeTab) {
      case 'containers': return 'Containers';
      case 'images': return 'Images';
      case 'networks': return 'Networks';
    }
  };

  const getSearchPlaceholder = () => {
    switch (activeTab) {
      case 'containers': return 'Search containers...';
      case 'images': return 'Search images...';
      case 'networks': return 'Search networks...';
    }
  };

  return (
    <div className="flex h-full bg-white/50 dark:bg-black/50 backdrop-blur-xl rounded-lg overflow-hidden border border-white/20 shadow-2xl">
      {/* Sidebar */}
      <div className="w-48 flex flex-col gap-6 p-4 border-r border-white/10 bg-zinc-50/80 dark:bg-zinc-900/80 backdrop-blur-xl shrink-0">
        <div className="space-y-1">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-2 mb-2">Docker</div>
          <button
            onClick={() => setActiveTab('containers')}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-colors",
              activeTab === 'containers'
                ? "bg-blue-500 text-white"
                : "text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10"
            )}
          >
            <Box className="w-4 h-4" />
            <span>Containers</span>
          </button>
          <button
            onClick={() => setActiveTab('images')}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-colors",
              activeTab === 'images'
                ? "bg-blue-500 text-white"
                : "text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10"
            )}
          >
            <Layers className="w-4 h-4" />
            <span>Images</span>
          </button>
          <button
            onClick={() => setActiveTab('networks')}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-colors",
              activeTab === 'networks'
                ? "bg-blue-500 text-white"
                : "text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10"
            )}
          >
            <Network className="w-4 h-4" />
            <span>Networks</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-white/40 dark:bg-black/40">
        {/* Toolbar */}
        <div className="h-14 flex items-center justify-between px-6 border-b border-white/10 bg-white/40 dark:bg-black/40 backdrop-blur-md shrink-0 gap-4">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-gray-800 dark:text-white shrink-0">{getTabTitle()}</h1>
            <div className="h-6 w-px bg-gray-300 dark:bg-gray-700 shrink-0" />
            <div className="relative group flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-blue-500 transition-colors" />
              <input
                type="text"
                placeholder={getSearchPlaceholder()}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full h-9 pl-9 pr-3 text-sm bg-black/5 dark:bg-white/10 rounded-md border border-transparent focus:border-blue-500 focus:outline-none text-gray-700 dark:text-gray-200 placeholder:text-gray-500 transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-black/5 dark:bg-white/10 rounded-md p-0.5">
              <button
                onClick={() => setViewMode('grid')}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  viewMode === 'grid'
                    ? "bg-white dark:bg-gray-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                )}
                title="Grid View"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  viewMode === 'list'
                    ? "bg-white dark:bg-gray-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                )}
                title="List View"
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            {activeTab === 'images' && (
              <button
                onClick={() => setShowPullDialog(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-sm font-medium transition-colors shadow-sm"
              >
                <Download className="w-4 h-4" />
                <span>Pull Image</span>
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 custom-scrollbar">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              Loading {getTabTitle().toLowerCase()}...
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {activeTab === 'containers' && filteredContainers.map((container) => (
                <ContainerCard key={container.id} container={container} />
              ))}
              {activeTab === 'images' && filteredImages.map((image) => (
                <ImageCard key={image.id} image={image} viewMode={viewMode} />
              ))}
              {activeTab === 'networks' && filteredNetworks.map((network) => (
                <NetworkCard key={network.id} network={network} viewMode={viewMode} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {activeTab === 'containers' && filteredContainers.map((container) => (
                <ContainerListItem key={container.id} container={container} />
              ))}
              {activeTab === 'images' && filteredImages.map((image) => (
                <ImageCard key={image.id} image={image} viewMode={viewMode} />
              ))}
              {activeTab === 'networks' && filteredNetworks.map((network) => (
                <NetworkCard key={network.id} network={network} viewMode={viewMode} />
              ))}
            </div>
          )}
        </div>
      </div>

      <PullImageDialog open={showPullDialog} onOpenChange={setShowPullDialog} />
    </div>
  );
};