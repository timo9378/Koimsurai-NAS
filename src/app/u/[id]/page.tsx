'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Lock,
  Clock,
  AlertCircle,
  Check,
  File,
  X,
  FolderUp,
  CloudUpload,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface UploadLinkInfo {
  id: string;
  target_folder: string;
  is_password_protected: boolean;
  expires_at: string | null;
  max_files: number | null;
  max_file_size: number | null;
  uploaded_count: number;
  created_at: string;
}

type UploadStatus = 'loading' | 'ready' | 'password_required' | 'expired' | 'not_found' | 'error' | 'uploading' | 'success';

interface FileToUpload {
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

export default function UploadPage() {
  const params = useParams();
  const uploadId = params.id as string;

  const [status, setStatus] = useState<UploadStatus>('loading');
  const [uploadInfo, setUploadInfo] = useState<UploadLinkInfo | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<FileToUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);

  useEffect(() => {
    fetchUploadInfo();
  }, [uploadId]);

  const fetchUploadInfo = async () => {
    try {
      const response = await fetch(`/api/upload-link/${uploadId}/info`);
      
      if (response.status === 404) {
        setStatus('not_found');
        setError('此上傳連結不存在或已被刪除');
        return;
      }
      
      if (response.status === 410) {
        setStatus('expired');
        setError('此上傳連結已過期');
        return;
      }

      if (!response.ok) {
        setError('無法載入上傳連結資訊');
        setStatus('error');
        return;
      }

      const data: UploadLinkInfo = await response.json();
      setUploadInfo(data);

      if (data.is_password_protected) {
        setStatus('password_required');
      } else {
        setStatus('ready');
      }
    } catch (err) {
      console.error('Fetch upload info error:', err);
      setError('載入上傳連結資訊時發生錯誤');
      setStatus('error');
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password) {
      setStatus('ready');
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles) {
      addFiles(Array.from(selectedFiles));
    }
    e.target.value = '';
  };

  const addFiles = (newFiles: File[]) => {
    // Check file size limits
    if (uploadInfo?.max_file_size) {
      const oversizedFiles = newFiles.filter(f => f.size > uploadInfo.max_file_size!);
      if (oversizedFiles.length > 0) {
        setError(`部分檔案超過大小限制 (${formatFileSize(uploadInfo.max_file_size)})`);
        newFiles = newFiles.filter(f => f.size <= uploadInfo.max_file_size!);
      }
    }

    // Check file count limits
    if (uploadInfo?.max_files) {
      const remainingSlots = uploadInfo.max_files - (uploadInfo.uploaded_count + files.length);
      if (newFiles.length > remainingSlots) {
        setError(`只能再上傳 ${remainingSlots} 個檔案`);
        newFiles = newFiles.slice(0, remainingSlots);
      }
    }

    const fileItems: FileToUpload[] = newFiles.map(file => ({
      file,
      progress: 0,
      status: 'pending',
    }));

    setFiles(prev => [...prev, ...fileItems]);
    setError(null);
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const uploadFiles = async () => {
    if (files.length === 0) return;

    setStatus('uploading');

    for (let i = 0; i < files.length; i++) {
      const fileItem = files[i];
      if (fileItem.status !== 'pending') continue;

      setFiles(prev => prev.map((f, idx) => 
        idx === i ? { ...f, status: 'uploading' } : f
      ));

      try {
        const formData = new FormData();
        formData.append('file', fileItem.file);

        const url = uploadInfo?.is_password_protected
          ? `/api/upload-link/${uploadId}/upload?pwd=${encodeURIComponent(password)}`
          : `/api/upload-link/${uploadId}/upload`;

        const xhr = new XMLHttpRequest();
        
        await new Promise<void>((resolve, reject) => {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const progress = (e.loaded / e.total) * 100;
              setFiles(prev => prev.map((f, idx) => 
                idx === i ? { ...f, progress } : f
              ));
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              setFiles(prev => prev.map((f, idx) => 
                idx === i ? { ...f, status: 'done', progress: 100 } : f
              ));
              resolve();
            } else {
              reject(new Error('Upload failed'));
            }
          };

          xhr.onerror = () => reject(new Error('Network error'));

          xhr.open('POST', url);
          xhr.send(formData);
        });
      } catch (err) {
        setFiles(prev => prev.map((f, idx) => 
          idx === i ? { ...f, status: 'error', error: '上傳失敗' } : f
        ));
      }
    }

    setUploadComplete(true);
    setStatus('success');
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-TW', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Loading state
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-purple-950/20 to-zinc-900 flex items-center justify-center p-4">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="h-8 w-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full"
        />
      </div>
    );
  }

  // Error states
  if (status === 'not_found' || status === 'expired' || status === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-purple-950/20 to-zinc-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-zinc-900/90 backdrop-blur-xl border-zinc-700/50">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="p-4 rounded-full bg-red-500/20">
                <AlertCircle className="h-8 w-8 text-red-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">
                  {status === 'not_found' && '連結不存在'}
                  {status === 'expired' && '連結已過期'}
                  {status === 'error' && '發生錯誤'}
                </h2>
                <p className="text-sm text-zinc-400 mt-1">{error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Password required
  if (status === 'password_required') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-purple-950/20 to-zinc-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-zinc-900/90 backdrop-blur-xl border-zinc-700/50">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="p-4 rounded-full bg-purple-500/20">
                <Lock className="h-8 w-8 text-purple-400" />
              </div>
            </div>
            <CardTitle className="text-zinc-100">需要密碼</CardTitle>
            <CardDescription>請輸入密碼以使用此上傳連結</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="請輸入密碼..."
                className="bg-zinc-800/50 border-zinc-700/50 text-zinc-100"
              />
              <Button
                type="submit"
                disabled={!password}
                className="w-full bg-purple-600 hover:bg-purple-700"
              >
                確認
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state
  if (status === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-purple-950/20 to-zinc-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-zinc-900/90 backdrop-blur-xl border-zinc-700/50">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                className="p-4 rounded-full bg-green-500/20"
              >
                <Check className="h-8 w-8 text-green-400" />
              </motion.div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">上傳完成</h2>
                <p className="text-sm text-zinc-400 mt-1">
                  成功上傳 {files.filter(f => f.status === 'done').length} 個檔案
                </p>
              </div>
              <Button
                onClick={() => {
                  setFiles([]);
                  setStatus('ready');
                  setUploadComplete(false);
                }}
                className="bg-purple-600 hover:bg-purple-700"
              >
                繼續上傳
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Ready / Uploading state
  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-purple-950/20 to-zinc-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl bg-zinc-900/90 backdrop-blur-xl border-zinc-700/50">
        <CardHeader className="border-b border-zinc-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/20">
              <FolderUp className="h-6 w-6 text-purple-400" />
            </div>
            <div>
              <CardTitle className="text-zinc-100">
                上傳檔案到「{uploadInfo?.target_folder}」
              </CardTitle>
              <CardDescription>
                {uploadInfo?.expires_at
                  ? `有效期至 ${formatDate(uploadInfo.expires_at)}`
                  : '此連結永不過期'}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {/* Limits Info */}
          {(uploadInfo?.max_files || uploadInfo?.max_file_size) && (
            <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
              {uploadInfo.max_file_size && (
                <div className="flex items-center gap-1.5">
                  <File className="h-4 w-4" />
                  <span>單檔限制: {formatFileSize(uploadInfo.max_file_size)}</span>
                </div>
              )}
              {uploadInfo.max_files && (
                <div className="flex items-center gap-1.5">
                  <Upload className="h-4 w-4" />
                  <span>
                    檔案數量: {uploadInfo.uploaded_count + files.length} / {uploadInfo.max_files}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'border-2 border-dashed rounded-xl p-8 text-center transition-all',
              isDragging
                ? 'border-purple-500 bg-purple-500/10'
                : 'border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800/30'
            )}
          >
            <input
              type="file"
              id="file-input"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <label htmlFor="file-input" className="cursor-pointer">
              <CloudUpload className={cn(
                'h-12 w-12 mx-auto mb-4 transition-colors',
                isDragging ? 'text-purple-400' : 'text-zinc-500'
              )} />
              <p className="text-zinc-300 font-medium">
                拖放檔案到此處，或點擊選擇檔案
              </p>
              <p className="text-sm text-zinc-500 mt-1">
                支援多檔案上傳
              </p>
            </label>
          </div>

          {/* Error Message */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* File List */}
          <AnimatePresence>
            {files.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2"
              >
                {files.map((fileItem, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50"
                  >
                    <File className="h-5 w-5 text-zinc-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{fileItem.file.name}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500">
                          {formatFileSize(fileItem.file.size)}
                        </span>
                        {fileItem.status === 'uploading' && (
                          <Progress value={fileItem.progress} className="h-1 flex-1" />
                        )}
                        {fileItem.status === 'done' && (
                          <Check className="h-4 w-4 text-green-400" />
                        )}
                        {fileItem.status === 'error' && (
                          <span className="text-xs text-red-400">{fileItem.error}</span>
                        )}
                      </div>
                    </div>
                    {fileItem.status === 'pending' && (
                      <button
                        onClick={() => removeFile(index)}
                        className="p-1 rounded hover:bg-zinc-700/50 text-zinc-500 hover:text-zinc-300"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    {fileItem.status === 'uploading' && (
                      <Loader2 className="h-4 w-4 text-purple-400 animate-spin" />
                    )}
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Upload Button */}
          {files.length > 0 && status !== 'uploading' && (
            <Button
              onClick={uploadFiles}
              className="w-full bg-purple-600 hover:bg-purple-700"
            >
              <Upload className="mr-2 h-4 w-4" />
              上傳 {files.filter(f => f.status === 'pending').length} 個檔案
            </Button>
          )}

          {/* Uploading Status */}
          {status === 'uploading' && (
            <div className="flex items-center justify-center gap-2 text-purple-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>正在上傳...</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
