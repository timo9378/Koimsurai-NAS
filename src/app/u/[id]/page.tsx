'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Folder,
  CloudUpload,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

type PageStatus = 'loading' | 'ready' | 'password_required' | 'expired' | 'not_found' | 'error' | 'uploading' | 'success';

/** A logical group — one folder, or one individual file */
interface UploadGroup {
  id: string;
  name: string;
  isFolder: boolean;
  files: { file: File; relativePath?: string }[];
  totalSize: number;
  fileCount: number;
  // upload progress
  status: 'pending' | 'uploading' | 'done' | 'error';
  uploadedCount: number;
  failedCount: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

let groupIdCounter = 0;
const nextGroupId = () => `g-${++groupIdCounter}`;

function formatFileSize(bytes: number) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('zh-TW', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Read ALL entries from a directory reader (readEntries returns batches of ~100) */
async function readAllDirectoryEntries(reader: any): Promise<any[]> {
  const all: any[] = [];
  let batch: any[];
  do {
    batch = await new Promise<any[]>((resolve, reject) =>
      reader.readEntries(resolve, reject)
    );
    all.push(...batch);
  } while (batch.length > 0);
  return all;
}

/** Recursively collect files from a FileSystemEntry tree */
async function collectFilesFromEntry(
  entry: any,
  basePath: string
): Promise<{ file: File; relativePath: string }[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      entry.file(resolve, reject)
    );
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    return [{ file, relativePath }];
  }
  if (entry.isDirectory) {
    const reader = entry.createDirectoryReader();
    const children = await readAllDirectoryEntries(reader);
    const dirPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const results: { file: File; relativePath: string }[] = [];
    for (const child of children) {
      results.push(...(await collectFilesFromEntry(child, dirPath)));
    }
    return results;
  }
  return [];
}

/** Group flat file entries by their top-level folder name */
function groupByTopFolder(entries: { file: File; relativePath: string }[]): UploadGroup[] {
  const map = new Map<string, { file: File; relativePath: string }[]>();
  for (const e of entries) {
    const slash = e.relativePath.indexOf('/');
    const folder = slash > 0 ? e.relativePath.slice(0, slash) : '__root__';
    if (!map.has(folder)) map.set(folder, []);
    map.get(folder)!.push(e);
  }
  const groups: UploadGroup[] = [];
  for (const [folder, files] of map) {
    const totalSize = files.reduce((s, f) => s + f.file.size, 0);
    if (folder === '__root__') {
      // Top-level files — each as individual group
      for (const f of files) {
        groups.push({
          id: nextGroupId(), name: f.file.name, isFolder: false,
          files: [f], totalSize: f.file.size, fileCount: 1,
          status: 'pending', uploadedCount: 0, failedCount: 0,
        });
      }
    } else {
      groups.push({
        id: nextGroupId(), name: folder, isFolder: true,
        files, totalSize, fileCount: files.length,
        status: 'pending', uploadedCount: 0, failedCount: 0,
      });
    }
  }
  return groups;
}

/* ================================================================== */
/*  Component                                                          */
/* ================================================================== */

export default function UploadPage() {
  const params = useParams();
  const uploadId = params.id as string;

  const [status, setStatus] = useState<PageStatus>('loading');
  const [uploadInfo, setUploadInfo] = useState<UploadLinkInfo | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [folderMode, setFolderMode] = useState(false);
  const [isScanning, setIsScanning] = useState(false); // scanning dropped folder

  // Upload groups (folders / individual files)
  const [groups, setGroups] = useState<UploadGroup[]>([]);
  // Overall upload progress
  const [uploadProgress, setUploadProgress] = useState({ done: 0, failed: 0, total: 0 });
  // For folder detail expand
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const abortRef = useRef(false);

  const totalFileCount = groups.reduce((s, g) => s + g.fileCount, 0);
  const totalSize = groups.reduce((s, g) => s + g.totalSize, 0);

  /* ---- Fetch upload link info ---- */
  useEffect(() => { fetchUploadInfo(); }, [uploadId]);

  const fetchUploadInfo = async () => {
    try {
      const response = await fetch(`/api/upload-link/${uploadId}/info`);
      if (response.status === 404) { setStatus('not_found'); setError('此上傳連結不存在或已被刪除'); return; }
      if (response.status === 410) { setStatus('expired'); setError('此上傳連結已過期'); return; }
      if (!response.ok) { setError('無法載入上傳連結資訊'); setStatus('error'); return; }
      const data: UploadLinkInfo = await response.json();
      setUploadInfo(data);
      setStatus(data.is_password_protected ? 'password_required' : 'ready');
    } catch {
      setError('載入上傳連結資訊時發生錯誤');
      setStatus('error');
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password) setStatus('ready');
  };

  /* ---- Drag & Drop ---- */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    // Collect entries via webkitGetAsEntry (supports folders)
    const topEntries: any[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = (items[i] as any).webkitGetAsEntry?.();
      if (entry) topEntries.push(entry);
    }

    if (topEntries.length === 0) {
      // Fallback: plain files
      const droppedFiles = Array.from(e.dataTransfer.files);
      addIndividualFiles(droppedFiles);
      return;
    }

    // Determine if any directory was dropped
    const hasDir = topEntries.some((e: any) => e.isDirectory);

    if (hasDir) {
      setIsScanning(true);
      try {
        const newGroups: UploadGroup[] = [];
        for (const entry of topEntries) {
          if (entry.isDirectory) {
            const files = await collectFilesFromEntry(entry, '');
            // files already have relativePaths like "folderName/sub/file.txt"
            // Group under the top entry name
            const totalSize = files.reduce((s, f) => s + f.file.size, 0);
            newGroups.push({
              id: nextGroupId(), name: entry.name, isFolder: true,
              files, totalSize, fileCount: files.length,
              status: 'pending', uploadedCount: 0, failedCount: 0,
            });
          } else {
            const file = await new Promise<File>((resolve, reject) =>
              entry.file(resolve, reject)
            );
            newGroups.push({
              id: nextGroupId(), name: file.name, isFolder: false,
              files: [{ file, relativePath: file.name }], totalSize: file.size, fileCount: 1,
              status: 'pending', uploadedCount: 0, failedCount: 0,
            });
          }
        }
        setGroups(prev => [...prev, ...newGroups]);
      } finally {
        setIsScanning(false);
      }
    } else {
      // Only files dropped
      const droppedFiles: File[] = [];
      for (const entry of topEntries) {
        if (entry.isFile) {
          const file = await new Promise<File>((resolve, reject) =>
            entry.file(resolve, reject)
          );
          droppedFiles.push(file);
        }
      }
      addIndividualFiles(droppedFiles);
    }
  }, []);

  /* ---- File / Folder selection ---- */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    const filesArray = Array.from(selectedFiles);
    const hasRelativePaths = filesArray.some(f => (f as any).webkitRelativePath);

    if (hasRelativePaths) {
      // Folder selection via <input webkitdirectory>
      const entries = filesArray.map(f => ({
        file: f,
        relativePath: ((f as any).webkitRelativePath || f.name) as string,
      }));
      const folderGroups = groupByTopFolder(entries);
      setGroups(prev => [...prev, ...folderGroups]);
    } else {
      addIndividualFiles(filesArray);
    }
    e.target.value = '';
  };

  const addIndividualFiles = (newFiles: File[]) => {
    let filtered = newFiles;
    if (uploadInfo?.max_file_size) {
      const oversized = filtered.filter(f => f.size > uploadInfo.max_file_size!);
      if (oversized.length > 0) {
        setError(`部分檔案超過大小限制 (${formatFileSize(uploadInfo.max_file_size)})`);
        filtered = filtered.filter(f => f.size <= uploadInfo.max_file_size!);
      }
    }
    const newGroups: UploadGroup[] = filtered.map(file => ({
      id: nextGroupId(), name: file.name, isFolder: false,
      files: [{ file }], totalSize: file.size, fileCount: 1,
      status: 'pending', uploadedCount: 0, failedCount: 0,
    }));
    setGroups(prev => [...prev, ...newGroups]);
    if (filtered.length > 0) setError(null);
  };

  const removeGroup = (id: string) => {
    setGroups(prev => prev.filter(g => g.id !== id));
  };

  /* ---- Upload ---- */
  const uploadAll = async () => {
    if (groups.length === 0) return;
    abortRef.current = false;
    setStatus('uploading');
    setUploadProgress({ done: 0, failed: 0, total: totalFileCount });

    const url = uploadInfo?.is_password_protected
      ? `/api/upload-link/${uploadId}/upload?pwd=${encodeURIComponent(password)}`
      : `/api/upload-link/${uploadId}/upload`;

    let globalDone = 0;
    let globalFailed = 0;

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      if (group.status !== 'pending') continue;
      if (abortRef.current) break;

      // Mark group as uploading
      setGroups(prev => prev.map(g => g.id === group.id ? { ...g, status: 'uploading' } : g));

      let groupDone = 0;
      let groupFailed = 0;
      const BATCH_SIZE = 10; // files per request

      for (let fi = 0; fi < group.files.length; fi += BATCH_SIZE) {
        if (abortRef.current) break;

        const batch = group.files.slice(fi, fi + BATCH_SIZE);
        const formData = new FormData();
        for (const entry of batch) {
          if (entry.relativePath) {
            formData.append('relative_path', entry.relativePath);
          }
          formData.append('file', entry.file);
        }

        try {
          const resp = await fetch(url, { method: 'POST', body: formData });
          if (resp.ok) {
            groupDone += batch.length;
            globalDone += batch.length;
          } else {
            groupFailed += batch.length;
            globalFailed += batch.length;
          }
        } catch {
          groupFailed += batch.length;
          globalFailed += batch.length;
        }

        // Update group progress
        setGroups(prev => prev.map(g =>
          g.id === group.id
            ? { ...g, uploadedCount: groupDone, failedCount: groupFailed }
            : g
        ));
        setUploadProgress({ done: globalDone, failed: globalFailed, total: totalFileCount });
      }

      // Mark group final status
      const finalStatus = groupFailed === group.fileCount ? 'error' : 'done';
      setGroups(prev => prev.map(g =>
        g.id === group.id ? { ...g, status: finalStatus } : g
      ));
    }

    if (globalDone > 0) {
      setStatus('success');
    } else {
      setError('所有檔案上傳失敗，請稍後再試');
      setStatus('ready');
    }
  };

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

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
              <Button type="submit" disabled={!password} className="w-full bg-purple-600 hover:bg-purple-700">
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
                  成功上傳 {uploadProgress.done} 個檔案
                  {uploadProgress.failed > 0 && `，${uploadProgress.failed} 個失敗`}
                </p>
              </div>
              <Button
                onClick={() => {
                  setGroups([]);
                  setUploadProgress({ done: 0, failed: 0, total: 0 });
                  setStatus('ready');
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

  // ---- Ready / Uploading state ----
  const pendingGroups = groups.filter(g => g.status === 'pending');
  const pendingFileCount = pendingGroups.reduce((s, g) => s + g.fileCount, 0);
  const isUploading = status === 'uploading';
  const overallPct = uploadProgress.total > 0
    ? Math.round(((uploadProgress.done + uploadProgress.failed) / uploadProgress.total) * 100)
    : 0;

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
              {uploadInfo!.max_file_size && (
                <div className="flex items-center gap-1.5">
                  <File className="h-4 w-4" />
                  <span>單檔限制: {formatFileSize(uploadInfo!.max_file_size)}</span>
                </div>
              )}
              {uploadInfo!.max_files && (
                <div className="flex items-center gap-1.5">
                  <Upload className="h-4 w-4" />
                  <span>檔案數量: {uploadInfo!.uploaded_count + totalFileCount} / {uploadInfo!.max_files}</span>
                </div>
              )}
            </div>
          )}

          {/* Upload Mode Toggle */}
          {!isUploading && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/30 border border-zinc-700/50">
              <button
                onClick={() => setFolderMode(false)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all',
                  !folderMode
                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50'
                    : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-700/30'
                )}
              >
                <File className="h-4 w-4" />
                檔案上傳
              </button>
              <button
                onClick={() => setFolderMode(true)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all',
                  folderMode
                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50'
                    : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-700/30'
                )}
              >
                <FolderUp className="h-4 w-4" />
                資料夾上傳
              </button>
            </div>
          )}

          {/* Drop Zone */}
          {!isUploading && (
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
              <input type="file" id="file-input" multiple onChange={handleFileSelect} className="hidden" />
              <input
                type="file" id="folder-input" onChange={handleFileSelect} className="hidden"
                {...({ webkitdirectory: '', directory: '' } as any)}
              />
              <label htmlFor={folderMode ? 'folder-input' : 'file-input'} className="cursor-pointer">
                {isScanning ? (
                  <>
                    <Loader2 className="h-12 w-12 mx-auto mb-4 text-purple-400 animate-spin" />
                    <p className="text-zinc-300 font-medium">正在掃描資料夾結構...</p>
                  </>
                ) : (
                  <>
                    <CloudUpload className={cn(
                      'h-12 w-12 mx-auto mb-4 transition-colors',
                      isDragging ? 'text-purple-400' : 'text-zinc-500'
                    )} />
                    <p className="text-zinc-300 font-medium">
                      {folderMode
                        ? '拖放資料夾到此處，或點擊選擇資料夾'
                        : '拖放檔案到此處，或點擊選擇檔案'}
                    </p>
                    <p className="text-sm text-zinc-500 mt-1">
                      {folderMode ? '將保留資料夾結構' : '支援多檔案上傳'}
                    </p>
                  </>
                )}
              </label>
            </div>
          )}

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

          {/* Group List */}
          {groups.length > 0 && (
            <div className="space-y-2">
              {/* Summary bar */}
              <div className="flex items-center justify-between text-sm text-zinc-400 px-1">
                <span>{groups.length} 個項目 · {totalFileCount} 個檔案 · {formatFileSize(totalSize)}</span>
                {!isUploading && groups.length > 0 && (
                  <button
                    onClick={() => setGroups([])}
                    className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
                  >
                    全部清除
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
                {groups.map((group) => (
                  <div
                    key={group.id}
                    className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 overflow-hidden"
                  >
                    {/* Group header */}
                    <div className="flex items-center gap-3 p-3">
                      {/* Icon */}
                      {group.isFolder ? (
                        <button
                          onClick={() => setExpandedGroup(expandedGroup === group.id ? null : group.id)}
                          className="shrink-0 text-zinc-400 hover:text-zinc-200"
                        >
                          {expandedGroup === group.id
                            ? <ChevronDown className="h-4 w-4" />
                            : <ChevronRight className="h-4 w-4" />}
                        </button>
                      ) : (
                        <span className="shrink-0 w-4" />
                      )}
                      {group.isFolder
                        ? <Folder className="h-5 w-5 text-blue-400 shrink-0" />
                        : <File className="h-5 w-5 text-zinc-400 shrink-0" />}

                      {/* Name & info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-200 truncate">{group.name}</p>
                        <p className="text-xs text-zinc-500">
                          {group.isFolder && `${group.fileCount} 個檔案 · `}
                          {formatFileSize(group.totalSize)}
                          {group.status === 'uploading' && ` · ${group.uploadedCount}/${group.fileCount} 已上傳`}
                          {group.status === 'done' && group.failedCount > 0 && ` · ${group.failedCount} 個失敗`}
                        </p>
                        {/* Progress bar for uploading groups */}
                        {group.status === 'uploading' && (
                          <Progress
                            value={group.fileCount > 0 ? (group.uploadedCount / group.fileCount) * 100 : 0}
                            className="h-1 mt-1.5"
                          />
                        )}
                      </div>

                      {/* Status / actions */}
                      {group.status === 'pending' && !isUploading && (
                        <button
                          onClick={() => removeGroup(group.id)}
                          className="p-1 rounded hover:bg-zinc-700/50 text-zinc-500 hover:text-zinc-300 shrink-0"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                      {group.status === 'uploading' && (
                        <Loader2 className="h-4 w-4 text-purple-400 animate-spin shrink-0" />
                      )}
                      {group.status === 'done' && (
                        <Check className="h-4 w-4 text-green-400 shrink-0" />
                      )}
                      {group.status === 'error' && (
                        <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                      )}
                    </div>

                    {/* Expanded file list for folders — show first 50 files */}
                    {group.isFolder && expandedGroup === group.id && (
                      <div className="border-t border-zinc-700/30 px-3 py-2 max-h-48 overflow-y-auto">
                        {group.files.slice(0, 50).map((f, i) => (
                          <div key={i} className="flex items-center gap-2 py-0.5 text-xs text-zinc-500">
                            <File className="h-3 w-3 shrink-0" />
                            <span className="truncate">{f.relativePath}</span>
                            <span className="shrink-0 ml-auto">{formatFileSize(f.file.size)}</span>
                          </div>
                        ))}
                        {group.files.length > 50 && (
                          <p className="text-xs text-zinc-600 mt-1 text-center">
                            ...還有 {group.files.length - 50} 個檔案
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Overall Upload Progress */}
          {isUploading && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 text-purple-400 animate-spin shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-zinc-300">正在上傳...</span>
                    <span className="text-zinc-400">
                      {uploadProgress.done + uploadProgress.failed} / {uploadProgress.total} · {overallPct}%
                    </span>
                  </div>
                  <Progress value={overallPct} className="h-2" />
                </div>
              </div>
            </div>
          )}

          {/* Upload Button */}
          {!isUploading && pendingFileCount > 0 && (
            <Button onClick={uploadAll} className="w-full bg-purple-600 hover:bg-purple-700">
              <Upload className="mr-2 h-4 w-4" />
              上傳 {pendingFileCount} 個檔案 ({formatFileSize(totalSize)})
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
