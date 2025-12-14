'use client';

import React from 'react';
import { FileInfo } from '@/types/api';
import { X, File, Download, ExternalLink } from 'lucide-react';
import Editor from '@monaco-editor/react';
import ReactPlayer from 'react-player';
import { apiClient } from '@/lib/api-client';
import { useQuery } from '@tanstack/react-query';

interface FilePreviewProps {
  file: FileInfo;
  onClose: () => void;
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export const FilePreview = ({ file, onClose }: FilePreviewProps) => {
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

  const fileUrl = `/api/files${file.path}`;

  // Fetch text content if it's a text file
  const { data: textContent } = useQuery({
    queryKey: ['file-content', file.path],
    queryFn: async () => {
      if (!isText) return null;
      const res = await apiClient.get(fileUrl, { responseType: 'text' });
      return res.data;
    },
    enabled: isText,
  });

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#1e1e1e] rounded-xl shadow-2xl overflow-hidden flex flex-col max-w-4xl max-h-[85%] w-full mx-8 animate-in zoom-in-95 duration-200 border border-white/10"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-12 flex items-center justify-between px-4 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
          <div className="flex flex-col">
            <span className="font-medium truncate max-w-md">{file.name}</span>
            <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
          </div>
          <div className="flex items-center gap-2">
            <a 
              href={`/api/download${file.path}`} 
              download
              className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors"
              title="Download"
            >
              <Download className="w-4 h-4" />
            </a>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex items-center justify-center bg-gray-100 dark:bg-[#1e1e1e] overflow-hidden relative">
          {isImage ? (
            <img
              src={fileUrl}
              alt={file.name}
              className="max-w-full max-h-full object-contain shadow-lg"
            />
          ) : isVideo ? (
            <div className="w-full h-full bg-black">
              {/* @ts-ignore - ReactPlayer types are tricky */}
              <ReactPlayer
                url={`/api/media/stream?path=${encodeURIComponent(file.path)}`}
                controls
                width="100%"
                height="100%"
                playing
              />
            </div>
          ) : isText ? (
            <div className="w-full h-full">
              <Editor
                height="100%"
                defaultLanguage={file.name.split('.').pop()}
                value={textContent || 'Loading...'}
                theme="vs-dark"
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 14,
                  scrollBeyondLastLine: false,
                }}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 text-gray-500">
              <File className="w-24 h-24" />
              <div className="text-center">
                <p className="text-lg font-medium text-gray-900 dark:text-white">Preview not available</p>
                <p className="text-sm">Try downloading the file to view it.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};