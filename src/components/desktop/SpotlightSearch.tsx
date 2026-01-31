'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Command } from 'cmdk';
import { 
  Search, 
  Folder, 
  LayoutGrid, 
  Image as ImageIcon, 
  Container, 
  Settings, 
  Calculator, 
  Terminal, 
  Activity,
  Trash2,
  FileText,
  Music,
  Video,
  Archive,
  Code,
  Equal,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { FileTypeIcon } from '@/lib/file-icons';
import { apiClient } from '@/lib/api-client';
import { useWindowStore, AppType } from '@/store/window-store';
import { FileInfo } from '@/types/api';

interface SearchResult {
  path: string;
  name: string;
  tag?: string;
  confidence?: number;
}

// App definitions for search
const APPS = [
  { id: 'finder', name: 'Finder', icon: Folder, keywords: ['files', 'folders', 'explorer', '檔案', '資料夾'] },
  { id: 'launchpad', name: 'Launchpad', icon: LayoutGrid, keywords: ['apps', 'applications', '應用程式', '啟動台'] },
  { id: 'dashboard', name: 'Dashboard', icon: Activity, keywords: ['system', 'monitor', 'cpu', 'memory', 'gpu', '儀表板', '監控'] },
  { id: 'photos', name: 'Photos', icon: ImageIcon, keywords: ['images', 'pictures', 'gallery', '照片', '圖片'] },
  { id: 'docker', name: 'Docker Manager', icon: Container, keywords: ['containers', 'docker', '容器'] },
  { id: 'terminal', name: 'Terminal', icon: Terminal, keywords: ['console', 'shell', 'bash', 'command', '終端機', '命令'] },
  { id: 'calculator', name: 'Calculator', icon: Calculator, keywords: ['math', 'calc', '計算機', '數學'] },
  { id: 'settings', name: 'Settings', icon: Settings, keywords: ['preferences', 'config', '設定', '偏好設定'] },
  { id: 'trash', name: 'Trash', icon: Trash2, keywords: ['delete', 'recycle', 'bin', '垃圾桶', '刪除'] },
];

// Simple math expression evaluator
const evaluateMath = (expr: string): { result: number; valid: boolean } => {
  try {
    // Only allow safe characters: numbers, operators, parentheses, decimal points
    const sanitized = expr.replace(/\s/g, '');
    if (!/^[\d+\-*/().%^]+$/.test(sanitized)) {
      return { result: 0, valid: false };
    }
    // Replace ^ with ** for exponentiation
    const jsExpr = sanitized.replace(/\^/g, '**');
    // eslint-disable-next-line no-eval
    const result = Function(`"use strict"; return (${jsExpr})`)();
    if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
      return { result, valid: true };
    }
    return { result: 0, valid: false };
  } catch {
    return { result: 0, valid: false };
  }
};

export const SpotlightSearch = ({ 
  open, 
  onOpenChange 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void; 
}) => {
  const [query, setQuery] = useState('');
  const { openWindow } = useWindowStore();

  // Reset query when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  // Search Files
  const { data: fileResults, isLoading: isSearching } = useQuery({
    queryKey: ['search', query],
    queryFn: async () => {
      if (!query) return [];
      const res = await apiClient.get<FileInfo[]>(`/search?q=${encodeURIComponent(query)}`);
      return res.data;
    },
    enabled: query.length > 1 && open,
    staleTime: 5000,
  });

  // Search AI Tags
  const { data: aiResults } = useQuery({
    queryKey: ['search-ai', query],
    queryFn: async () => {
      if (!query) return [];
      const res = await apiClient.get<SearchResult[]>(`/search/ai-tags?q=${encodeURIComponent(query)}`);
      return res.data;
    },
    enabled: query.length > 1 && open,
    staleTime: 5000,
  });

  // Filter apps based on query
  const matchedApps = useMemo(() => {
    if (!query) return APPS;
    const q = query.toLowerCase();
    return APPS.filter(app => 
      app.name.toLowerCase().includes(q) ||
      app.keywords.some(k => k.toLowerCase().includes(q))
    );
  }, [query]);

  // Check if query is a math expression
  const mathResult = useMemo(() => {
    if (!query || query.length < 2) return null;
    const result = evaluateMath(query);
    if (result.valid) {
      return result.result;
    }
    return null;
  }, [query]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange]);

  const handleFileSelect = (file: FileInfo) => {
    onOpenChange(false);
    
    if (file.is_dir) {
      // Open folder in Finder
      openWindow('finder', 'Finder', { navigateTo: file.path });
    } else {
      // Determine file type and open appropriately
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
      const videoExts = ['mp4', 'webm', 'mkv', 'avi', 'mov'];
      const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg'];
      
      if (imageExts.includes(ext) || videoExts.includes(ext) || audioExts.includes(ext)) {
        openWindow('preview', file.name, { file });
      } else {
        // Open containing folder
        const parentPath = file.path.substring(0, file.path.lastIndexOf('/')) || '/';
        openWindow('finder', 'Finder', { navigateTo: parentPath });
      }
    }
  };

  const handleAppSelect = (appId: string) => {
    onOpenChange(false);
    openWindow(appId as AppType);
  };

  const handleCopyMathResult = () => {
    if (mathResult !== null) {
      navigator.clipboard.writeText(mathResult.toString());
      onOpenChange(false);
    }
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Global Search"
      className="fixed top-[20%] left-1/2 -translate-x-1/2 w-[640px] max-w-[90vw] bg-white/90 dark:bg-black/90 backdrop-blur-xl rounded-2xl border border-white/20 shadow-2xl z-[100] overflow-hidden"
    >
      <div className="flex items-center border-b border-white/10 px-4">
        <Search className="w-5 h-5 text-muted-foreground mr-2" />
        <Command.Input 
          value={query}
          onValueChange={setQuery}
          placeholder="Search files, apps, or AI tags (e.g. 'cat', 'beach')..."
          className="flex-1 h-14 bg-transparent outline-none text-lg placeholder:text-muted-foreground/50"
          autoFocus
        />
        {isSearching && (
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        )}
      </div>
      
      <Command.List className="max-h-[400px] overflow-y-auto p-2">
        <Command.Empty className="py-6 text-center text-muted-foreground">
          {query ? 'No results found.' : 'Start typing to search...'}
        </Command.Empty>

        {/* Math Result */}
        {mathResult !== null && (
          <Command.Group heading="Calculator">
            <Command.Item
              onSelect={handleCopyMathResult}
              className="flex items-center gap-3 px-3 py-3 rounded-lg aria-selected:bg-green-500/20 cursor-pointer"
            >
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center">
                <Equal className="w-5 h-5 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-semibold">{mathResult}</span>
                <span className="text-xs text-muted-foreground">{query} = {mathResult} (Click to copy)</span>
              </div>
            </Command.Item>
          </Command.Group>
        )}

        {/* Applications */}
        {matchedApps.length > 0 && (
          <Command.Group heading="Applications">
            {matchedApps.slice(0, query ? 5 : 3).map((app) => {
              const Icon = app.icon;
              return (
                <Command.Item
                  key={app.id}
                  value={`app-${app.id}`}
                  onSelect={() => handleAppSelect(app.id)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg aria-selected:bg-blue-500/20 cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-sm font-medium">{app.name}</span>
                </Command.Item>
              );
            })}
          </Command.Group>
        )}

        {/* File Results */}
        {fileResults && fileResults.length > 0 && (
          <Command.Group heading="Files">
            {fileResults.slice(0, 10).map((file) => (
              <Command.Item
                key={file.path}
                value={`file-${file.path}`}
                onSelect={() => handleFileSelect(file)}
                className="flex items-center gap-3 px-3 py-2 rounded-lg aria-selected:bg-blue-500/20 cursor-pointer"
              >
                <FileTypeIcon filename={file.name} isDir={file.is_dir} mimeType={file.mime_type ?? undefined} size="sm" />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">{file.name}</span>
                  <span className="text-xs text-muted-foreground truncate">{file.path}</span>
                </div>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {/* AI Results */}
        {aiResults && aiResults.length > 0 && (
          <Command.Group heading="AI Smart Search">
            {aiResults.slice(0, 5).map((item) => (
              <Command.Item
                key={item.path}
                value={`ai-${item.path}`}
                onSelect={() => handleFileSelect({ path: item.path, name: item.name, is_dir: false, size: 0, modified: '', mime_type: null, metadata: null, tags: [], is_starred: false })}
                className="flex items-center gap-3 px-3 py-2 rounded-lg aria-selected:bg-purple-500/20 cursor-pointer"
              >
                <FileTypeIcon filename={item.name || ''} isDir={false} size="sm" />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">{item.name}</span>
                  <span className="text-xs text-muted-foreground">
                    Matched "{item.tag}" ({Math.round((item.confidence || 0) * 100)}%)
                  </span>
                </div>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>

      {/* Footer */}
      <div className="border-t border-white/10 px-4 py-2 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono">↑↓</kbd>
          <span>Navigate</span>
        </div>
        <div className="flex items-center gap-2">
          <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono">↵</kbd>
          <span>Open</span>
        </div>
        <div className="flex items-center gap-2">
          <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono">Esc</kbd>
          <span>Close</span>
        </div>
      </div>
    </Command.Dialog>
  );
};