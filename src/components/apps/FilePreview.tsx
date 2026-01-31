'use client';

import React, { useState, useEffect } from 'react';
import { FileInfo } from '@/types/api';
import { File, Download, Loader2 } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { apiClient } from '@/lib/api-client';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useWindowStore } from '@/store/window-store';
import { VideoPlayer } from '@/components/ui/video-player';
import { AudioPlayer } from '@/components/ui/audio-player';

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
  const isAudio = file.mime_type?.startsWith('audio/') ||
    !!file.name.match(/\.(mp3|wav|flac|aac|ogg|m4a|wma|opus)$/i);
  const isPdf = file.mime_type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isOffice = !!file.name.match(/\.(docx?|xlsx?|pptx?)$/i);
  const isText = file.mime_type?.startsWith('text/') ||
    !!file.name.match(/\.(txt|json|md|ts|tsx|js|jsx|css|html|xml|yaml|yml|toml|ini|cfg|conf|sh|bash|zsh|py|rb|rs|go|java|c|cpp|h|hpp|sql|log|env|gitignore|dockerignore|editorconfig|prettierrc|eslintrc)$/i);

  // Construct URLs with proper encoding
  // We use the /api/download endpoint which maps to the backend's download_file handler
  // This handler supports Range requests for video streaming and serves file content

  // Remove leading slash for the API call as per useFiles.ts pattern
  const cleanPath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
  // Encode each path segment separately to handle special characters (e.g. Chinese, spaces)
  const encodedPath = cleanPath.split('/').map(encodeURIComponent).join('/');

  // The download endpoint: /api/download/{encoded_path}
  const fileUrl = `/api/download/${encodedPath}`;

  // For video, we use the same endpoint as it supports Range requests
  // We can also try /api/media/stream if download doesn't work, but user indicated download_file is ready.
  // Let's use the same URL for consistency.
  const videoUrl = fileUrl;

  // Fetch text content
  const { data: textContent, isLoading: isTextLoading, error: textError } = useQuery({
    queryKey: ['file-content', file.path],
    queryFn: async () => {
      if (!isText) return null;
      // For text, we need to fetch the raw content
      // Use responseType: 'text' to get the raw text and transformResponse to prevent JSON parsing
      const res = await apiClient.get(fileUrl, { 
        responseType: 'text',
        transformResponse: [(data) => data], // Prevent automatic JSON parsing
      });
      // Ensure we return a string
      return typeof res.data === 'string' ? res.data : String(res.data ?? '');
    },
    enabled: isText,
    retry: 1,
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
          <div className="w-full h-full rounded-lg overflow-hidden shadow-2xl">
            <VideoPlayer
              src={videoUrl}
              title={file.name}
              onError={(e) => console.error('Video playback error:', e)}
            />
          </div>
        ) : isAudio ? (
          <div className="w-full max-w-md mx-auto h-full flex items-center justify-center">
            <AudioPlayer
              src={fileUrl}
              title={file.name.replace(/\.[^/.]+$/, '')}
              windowId={windowId}
              onError={(e) => console.error('Audio playback error:', e)}
            />
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
        ) : isPdf ? (
          <div className="w-full h-full rounded-lg overflow-hidden shadow-lg bg-white">
            <iframe
              src={`${fileUrl}#toolbar=1&navpanes=0`}
              className="w-full h-full border-0"
              title={file.name}
            />
          </div>
        ) : isOffice ? (
          <div className="flex flex-col items-center gap-4 text-gray-500">
            <File className="w-24 h-24 opacity-20" />
            <div className="text-center">
              <p className="text-lg font-medium text-gray-900 dark:text-white">Office 文件預覽</p>
              <p className="text-sm">目前不支援直接預覽 Office 文件</p>
              <p className="text-sm mt-2">請下載後使用相關軟體開啟</p>
            </div>
          </div>
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