'use client';

import React, { useState, useEffect } from 'react';
import { Command } from 'cmdk';
import { Search, AppWindow } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { FileTypeIcon } from '@/lib/file-icons';
import { apiClient } from '@/lib/api-client';
import { useWindowStore } from '@/store/window-store';
import { FileInfo } from '@/types/api';

interface SearchResult {
  path: string;
  name: string;
  tag?: string;
  confidence?: number;
}

export const SpotlightSearch = ({ 
  open, 
  onOpenChange 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void; 
}) => {
  const [query, setQuery] = useState('');
  const { openWindow } = useWindowStore();

  // Search Files
  const { data: fileResults } = useQuery({
    queryKey: ['search', query],
    queryFn: async () => {
      if (!query) return [];
      const res = await apiClient.get<FileInfo[]>(`/api/search?q=${encodeURIComponent(query)}`);
      return res.data;
    },
    enabled: query.length > 1,
  });

  // Search AI Tags
  const { data: aiResults } = useQuery({
    queryKey: ['search-ai', query],
    queryFn: async () => {
      if (!query) return [];
      const res = await apiClient.get<SearchResult[]>(`/api/search/ai-tags?q=${encodeURIComponent(query)}`);
      return res.data;
    },
    enabled: query.length > 1,
  });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange]);

  const handleSelect = (path: string, type: 'file' | 'app') => {
    onOpenChange(false);
    if (type === 'app') {
      // Handle app launching if we add apps to search
    } else {
      // Open file in Finder or Preview
      // For now, let's just open Finder at the location
      // Ideally we would open the specific file
      openWindow('finder', 'Finder');
    }
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Global Search"
      className="fixed top-[20%] left-1/2 -translate-x-1/2 w-[640px] max-w-[90vw] bg-white/80 dark:bg-black/80 backdrop-blur-xl rounded-xl border border-white/20 shadow-2xl z-[100] overflow-hidden"
    >
      <div className="flex items-center border-b border-white/10 px-4">
        <Search className="w-5 h-5 text-muted-foreground mr-2" />
        <Command.Input 
          value={query}
          onValueChange={setQuery}
          placeholder="Search files, apps, or AI tags (e.g. 'cat', 'beach')..."
          className="flex-1 h-14 bg-transparent outline-none text-lg placeholder:text-muted-foreground/50"
        />
      </div>
      
      <Command.List className="max-h-[400px] overflow-y-auto p-2">
        <Command.Empty className="py-6 text-center text-muted-foreground">
          No results found.
        </Command.Empty>

        {fileResults && fileResults.length > 0 && (
          <Command.Group heading="Files">
            {fileResults.map((file) => (
              <Command.Item
                key={file.path}
                onSelect={() => handleSelect(file.path, 'file')}
                className="flex items-center gap-3 px-3 py-2 rounded-lg aria-selected:bg-blue-500/20 aria-selected:text-blue-500 cursor-pointer"
              >
                <FileTypeIcon filename={file.name} isDir={file.is_dir} mimeType={file.mime_type ?? undefined} size="sm" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{file.name}</span>
                  <span className="text-xs text-muted-foreground">{file.path}</span>
                </div>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {aiResults && aiResults.length > 0 && (
          <Command.Group heading="AI Smart Search">
            {aiResults.map((item) => (
              <Command.Item
                key={item.path}
                onSelect={() => handleSelect(item.path, 'file')}
                className="flex items-center gap-3 px-3 py-2 rounded-lg aria-selected:bg-purple-500/20 aria-selected:text-purple-500 cursor-pointer"
              >
                <FileTypeIcon filename={item.name || ''} isDir={false} size="sm" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{item.name}</span>
                  <span className="text-xs text-muted-foreground">
                    Matched "{item.tag}" ({Math.round((item.confidence || 0) * 100)}%)
                  </span>
                </div>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading="Applications">
          <Command.Item 
            onSelect={() => {
              openWindow('finder');
              onOpenChange(false);
            }}
            className="flex items-center gap-3 px-3 py-2 rounded-lg aria-selected:bg-white/10 cursor-pointer"
          >
            <AppWindow className="w-4 h-4" />
            <span>Finder</span>
          </Command.Item>
          <Command.Item 
            onSelect={() => {
              openWindow('docker');
              onOpenChange(false);
            }}
            className="flex items-center gap-3 px-3 py-2 rounded-lg aria-selected:bg-white/10 cursor-pointer"
          >
            <AppWindow className="w-4 h-4" />
            <span>Docker Manager</span>
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
};