'use client';

import React, { useState, useEffect } from 'react';
import { FileInfo } from '@/types/api';
import { File, Download, Loader2 } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { apiClient } from '@/lib/api-client';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useWindowStore } from '@/store/window-store';

interface FilePreviewProps {
  file: FileInfo;
  windowId?: string;
  onClose?: () => void; // Optional now as it's handled by window manager
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export const FilePreview = ({ file, windowId }: FilePreviewProps) => {
  const { updateWindowSize } = useWindowStore();
  const isImage = file.mime_type?.startsWith('image/');
  const isVideo = file.mime_type?.startsWith('video/');
  const isText = file.mime_type?.startsWith('text/') || 
                 file.name.endsWith('.json') || 
                 file.name.endsWith('.md') || 
                 file.name.endsWith('.ts') || 
                 file.name.endsWith('.tsx') ||
                 file.name.endsWith('.js') ||
                 file.name.endsWith('.css') ||
                 file.name.endsWith('.html');

  // Construct URLs with proper encoding
  // We use the /api/download endpoint which maps to the backend's download_file handler
  // This handler supports Range requests for video streaming and serves file content
  
  // Remove leading slash for the API call as per useFiles.ts pattern
  const cleanPath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
  const encodedPath = encodeURIComponent(cleanPath);
  
  // The download endpoint: /api/download/{encoded_path}
  const fileUrl = `/api/download/${encodedPath}`;
  
  // For video, we use the same endpoint as it supports Range requests
  // We can also try /api/media/stream if download doesn't work, but user indicated download_file is ready.
  // Let's use the same URL for consistency.
  const videoUrl = fileUrl;

  // Fetch text content
  const { data: textContent, isLoading: isTextLoading } = useQuery({
    queryKey: ['file-content', file.path],
    queryFn: async () => {
      if (!isText) return null;
      // For text, we can use the same download URL to get the content
      const res = await apiClient.get(fileUrl, { responseType: 'text' });
      return res.data;
    },
    enabled: isText,
  });

  return (
    <div className="flex flex-col h-full w-full bg-transparent">
      {/* Toolbar */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-gray-200 dark:border-white/10 bg-white/50 dark:bg-white/5 shrink-0 backdrop-blur-sm">
        <div className="flex flex-col overflow-hidden">
          <span className="font-medium truncate text-sm">{file.name}</span>
          <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a 
            href={`/api/download${file.path}`} 
            download
            className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative flex items-center justify-center p-4">
        {isImage ? (
          <img
            src={fileUrl}
            alt={file.name}
            className="max-w-full max-h-full object-contain shadow-lg rounded-lg"
            onLoad={(e) => {
              if (windowId) {
                const img = e.currentTarget;
                const naturalWidth = img.naturalWidth;
                const naturalHeight = img.naturalHeight;
                
                // Calculate optimal window size
                // Max width/height: 80% of screen or reasonable limit
                // Adjusted for new maximized window constraints (padding)
                const maxWidth = window.innerWidth * 0.85;
                const maxHeight = window.innerHeight * 0.85;
                
                let width = naturalWidth;
                let height = naturalHeight;
                
                // Add padding for toolbar (48px) and window borders/padding (32px)
                const chromeHeight = 48 + 32;
                const chromeWidth = 32;
                
                // Scale down if too large
                if (width > maxWidth || height > maxHeight) {
                  const ratio = Math.min(maxWidth / width, (maxHeight - chromeHeight) / height);
                  width *= ratio;
                  height *= ratio;
                }
                
                // Ensure minimum size
                width = Math.max(width + chromeWidth, 400);
                height = Math.max(height + chromeHeight, 300);
                
                updateWindowSize(windowId, { width, height });
              }
            }}
            onError={(e) => {
              // Fallback or error handling
              console.error('Image load failed', e);
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : isVideo ? (
          <div className="w-full h-full flex flex-col bg-black rounded-lg overflow-hidden shadow-2xl">
            <video
              src={videoUrl}
              controls
              className="w-full h-full"
              controlsList="nodownload"
              crossOrigin="use-credentials"
              style={{
                objectFit: 'contain',
              }}
              onError={(e) => console.error('Video playback error:', e)}
            />
            {/* Custom overlay for better UX - optional */}
            <style jsx global>{`
              video::-webkit-media-controls-panel {
                background-image: linear-gradient(transparent, rgba(0,0,0,0.7)) !important;
              }
              video::-webkit-media-controls-play-button {
                background-color: rgba(255,255,255,0.9);
                border-radius: 50%;
              }
              video::-webkit-media-controls-timeline {
                background-color: rgba(255,255,255,0.2);
                border-radius: 4px;
              }
            `}</style>
          </div>
        ) : isText ? (
          isTextLoading ? (
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          ) : (
            <div className="w-full h-full border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden shadow-sm">
              <Editor
                height="100%"
                defaultLanguage={file.name.split('.').pop()}
                value={textContent || ''}
                theme="vs-dark"
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 14,
                  scrollBeyondLastLine: false,
                  padding: { top: 16, bottom: 16 },
                }}
              />
            </div>
          )
        ) : (
          <div className="flex flex-col items-center gap-4 text-gray-500">
            <File className="w-24 h-24 opacity-20" />
            <div className="text-center">
              <p className="text-lg font-medium text-gray-900 dark:text-white">Preview not available</p>
              <p className="text-sm">Try downloading the file to view it.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};