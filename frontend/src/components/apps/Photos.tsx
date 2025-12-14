'use client';

import React, { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { FileInfo } from '@/types/api';
import { format, parseISO } from 'date-fns';
import { Search, Image as ImageIcon, Film, Calendar } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FilePreview } from './FilePreview';

interface MediaItem extends FileInfo {
  date: string; // YYYY-MM-DD
}

interface TimelineGroup {
  date: string;
  items: MediaItem[];
}

export const Photos = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const { data: timeline, isLoading } = useQuery({
    queryKey: ['media', 'timeline', searchQuery],
    queryFn: async () => {
      // In a real implementation, we would pass searchQuery to the backend
      // For now, we fetch all and filter client-side or assume backend handles it
      const res = await apiClient.get<TimelineGroup[]>(`/api/media/timeline?group_by=day`);
      return res.data;
    },
  });

  // Flatten for virtualization if needed, but for now let's just render groups
  // Virtualization with variable height groups (headers + grids) is complex.
  // We'll stick to standard rendering for this iteration unless performance is terrible.
  
  return (
    <div className="flex h-full bg-white/50 dark:bg-black/50 backdrop-blur-xl rounded-lg overflow-hidden border border-white/20 shadow-2xl flex-col">
      {/* Toolbar */}
      <div className="h-14 flex items-center justify-between px-6 border-b border-white/10 bg-white/40 dark:bg-black/40 backdrop-blur-md z-10">
        <div className="flex items-center gap-4">
          <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg text-white shadow-lg">
            <ImageIcon className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white">Photos</h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative group">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-blue-500 transition-colors" />
            <input 
              type="text" 
              placeholder="Search photos (e.g. 'Dog', 'Beach')..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 h-9 pl-9 pr-3 text-sm bg-black/5 dark:bg-white/10 rounded-full border border-transparent focus:border-blue-500 focus:outline-none text-gray-700 dark:text-gray-200 placeholder:text-gray-500 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6" ref={parentRef}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            Loading your memories...
          </div>
        ) : !timeline || timeline.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-4">
            <ImageIcon className="w-16 h-16 opacity-20" />
            <p>No photos found</p>
          </div>
        ) : (
          <div className="space-y-8 max-w-6xl mx-auto">
            {timeline.map((group) => (
              <div key={group.date} className="space-y-4">
                <div className="flex items-center gap-2 sticky top-0 bg-white/80 dark:bg-black/80 backdrop-blur-md py-2 z-10 -mx-2 px-2 rounded-lg">
                  <Calendar className="w-4 h-4 text-gray-500" />
                  <h3 className="font-medium text-gray-900 dark:text-white">
                    {format(parseISO(group.date), 'MMMM d, yyyy')}
                  </h3>
                  <span className="text-xs text-gray-500">
                    {group.items.length} items
                  </span>
                </div>
                
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1">
                  {group.items.map((item) => (
                    <div 
                      key={item.path}
                      className="aspect-square relative group cursor-pointer overflow-hidden rounded-md bg-gray-100 dark:bg-white/5"
                      onClick={() => setPreviewFile(item)}
                    >
                      <img
                        src={`/api/thumbnail/medium${item.path}`}
                        alt={item.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                        loading="lazy"
                      />
                      {item.mime_type?.startsWith('video/') && (
                        <div className="absolute top-2 right-2 p-1 bg-black/50 rounded-full text-white">
                          <Film className="w-3 h-3" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {previewFile && (
        <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
    </div>
  );
};