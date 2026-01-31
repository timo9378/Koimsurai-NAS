'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Download, 
  Lock, 
  FileIcon, 
  Clock, 
  Shield, 
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Share2,
  HardDrive
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileTypeIcon } from '@/lib/file-icons';
import { cn } from '@/lib/utils';

interface ShareInfo {
  id: string;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  is_password_protected: boolean;
  expires_at: string | null;
  created_at: string;
}

type ShareStatus = 'loading' | 'ready' | 'password_required' | 'expired' | 'not_found' | 'error';

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getTimeRemaining(expiresAt: string): string {
  const now = new Date();
  const expiry = new Date(expiresAt);
  const diff = expiry.getTime() - now.getTime();
  
  if (diff <= 0) return '已過期';
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (days > 0) return `${days} 天 ${hours} 小時後過期`;
  if (hours > 0) return `${hours} 小時 ${minutes} 分鐘後過期`;
  return `${minutes} 分鐘後過期`;
}

export default function SharePage() {
  const params = useParams();
  const router = useRouter();
  const shareId = params.id as string;
  
  const [status, setStatus] = useState<ShareStatus>('loading');
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchShareInfo();
  }, [shareId]);

  const fetchShareInfo = async () => {
    try {
      setStatus('loading');
      const response = await fetch(`/api/share/${shareId}/info`);
      
      if (response.status === 404) {
        setStatus('not_found');
        return;
      }
      
      if (response.status === 410) {
        setStatus('expired');
        return;
      }
      
      if (!response.ok) {
        setStatus('error');
        setError('無法載入分享連結資訊');
        return;
      }
      
      const data = await response.json();
      setShareInfo(data);
      
      if (data.is_password_protected) {
        setStatus('password_required');
      } else {
        setStatus('ready');
      }
    } catch (err) {
      console.error('Fetch share info error:', err);
      setStatus('error');
      setError('網路錯誤，請稍後再試');
    }
  };

  const handleDownload = async () => {
    if (!shareInfo) return;
    
    setIsDownloading(true);
    setError(null);
    
    try {
      const url = password 
        ? `/api/share/${shareId}/download?pwd=${encodeURIComponent(password)}`
        : `/api/share/${shareId}/download`;
      
      const response = await fetch(url);
      
      if (response.status === 401) {
        setError('密碼錯誤');
        setIsDownloading(false);
        return;
      }
      
      if (!response.ok) {
        setError('下載失敗');
        setIsDownloading(false);
        return;
      }
      
      // Get content length for progress
      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      
      // Create a reader
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Unable to read response');
      }
      
      const chunks: BlobPart[] = [];
      let receivedLength = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        chunks.push(value);
        receivedLength += value.length;
        
        if (total > 0) {
          setDownloadProgress((receivedLength / total) * 100);
        }
      }
      
      // Combine chunks
      const blob = new Blob(chunks);
      const downloadUrl = URL.createObjectURL(blob);
      
      // Create download link
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = shareInfo.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
      
      setStatus('ready');
    } catch (err) {
      console.error('Download error:', err);
      setError('下載過程中發生錯誤');
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.trim()) {
      setStatus('ready');
    }
  };

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4 bg-cover bg-center"
      style={{ 
        backgroundImage: 'url(https://images.unsplash.com/photo-1506905925346-21bda4d32df4?q=80&w=2070&auto=format&fit=crop)',
      }}
    >
      {/* Backdrop blur overlay */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-xl" />
      
      {/* Content */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-md"
      >
        <Card className="bg-white/10 dark:bg-black/20 backdrop-blur-2xl border-white/20 shadow-2xl">
          {/* Header with logo */}
          <div className="flex justify-center pt-8 pb-4">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg"
            >
              <HardDrive className="w-8 h-8 text-white" />
            </motion.div>
          </div>
          
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-white text-xl font-medium">
              Koimsurai NAS
            </CardTitle>
            <CardDescription className="text-white/60">
              安全檔案分享
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6 pb-8">
            <AnimatePresence mode="wait">
              {/* Loading State */}
              {status === 'loading' && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center py-8 space-y-4"
                >
                  <Loader2 className="w-10 h-10 text-white/60 animate-spin" />
                  <p className="text-white/60 text-sm">載入中...</p>
                </motion.div>
              )}
              
              {/* Not Found State */}
              {status === 'not_found' && (
                <motion.div
                  key="not_found"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center py-8 space-y-4"
                >
                  <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-red-400" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-white font-medium text-lg">找不到分享連結</h3>
                    <p className="text-white/60 text-sm mt-1">此連結不存在或已被刪除</p>
                  </div>
                  <Button
                    variant="outline"
                    className="mt-4 bg-white/10 border-white/20 text-white hover:bg-white/20"
                    onClick={() => router.push('/')}
                  >
                    返回首頁
                  </Button>
                </motion.div>
              )}
              
              {/* Expired State */}
              {status === 'expired' && (
                <motion.div
                  key="expired"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center py-8 space-y-4"
                >
                  <div className="w-16 h-16 rounded-full bg-yellow-500/20 flex items-center justify-center">
                    <Clock className="w-8 h-8 text-yellow-400" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-white font-medium text-lg">連結已過期</h3>
                    <p className="text-white/60 text-sm mt-1">此分享連結已超過有效期限</p>
                  </div>
                  <Button
                    variant="outline"
                    className="mt-4 bg-white/10 border-white/20 text-white hover:bg-white/20"
                    onClick={() => router.push('/')}
                  >
                    返回首頁
                  </Button>
                </motion.div>
              )}
              
              {/* Error State */}
              {status === 'error' && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center py-8 space-y-4"
                >
                  <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-red-400" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-white font-medium text-lg">發生錯誤</h3>
                    <p className="text-white/60 text-sm mt-1">{error || '無法載入分享連結'}</p>
                  </div>
                  <Button
                    variant="outline"
                    className="mt-4 bg-white/10 border-white/20 text-white hover:bg-white/20"
                    onClick={fetchShareInfo}
                  >
                    重試
                  </Button>
                </motion.div>
              )}
              
              {/* Password Required State */}
              {status === 'password_required' && shareInfo && (
                <motion.div
                  key="password"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-6"
                >
                  {/* File Preview */}
                  <div className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="flex-shrink-0">
                      <FileTypeIcon 
                        filename={shareInfo.file_name} 
                        isDir={false} 
                        mimeType={shareInfo.mime_type ?? undefined}
                        size="xl"
                        className="opacity-80"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium truncate">{shareInfo.file_name}</p>
                      <p className="text-white/50 text-sm">{formatFileSize(shareInfo.file_size)}</p>
                    </div>
                    <Lock className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                  </div>
                  
                  {/* Password Form */}
                  <form onSubmit={handlePasswordSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-white/70 text-sm flex items-center gap-2">
                        <Shield className="w-4 h-4" />
                        此檔案需要密碼才能存取
                      </label>
                      <div className="relative">
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="輸入密碼"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="bg-white/10 border-white/20 text-white placeholder:text-white/40 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    
                    <Button
                      type="submit"
                      disabled={!password.trim()}
                      className="w-full bg-blue-500 hover:bg-blue-600 text-white"
                    >
                      確認
                    </Button>
                  </form>
                </motion.div>
              )}
              
              {/* Ready State */}
              {status === 'ready' && shareInfo && (
                <motion.div
                  key="ready"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-6"
                >
                  {/* File Card */}
                  <div className="p-6 rounded-xl bg-white/5 border border-white/10 space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="flex-shrink-0">
                        <FileTypeIcon 
                          filename={shareInfo.file_name} 
                          isDir={false} 
                          mimeType={shareInfo.mime_type ?? undefined}
                          size="xl"
                          className="opacity-80"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium truncate text-lg">{shareInfo.file_name}</p>
                        <p className="text-white/50 text-sm">{formatFileSize(shareInfo.file_size)}</p>
                      </div>
                    </div>
                    
                    {/* File Info */}
                    <div className="pt-4 border-t border-white/10 space-y-2">
                      <div className="flex items-center gap-2 text-white/50 text-sm">
                        <Share2 className="w-4 h-4" />
                        <span>分享於 {formatDate(shareInfo.created_at)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-white/50 text-sm">
                        <Clock className="w-4 h-4" />
                        <span>
                          {shareInfo.expires_at 
                            ? getTimeRemaining(shareInfo.expires_at)
                            : '永不過期'}
                        </span>
                      </div>
                      {shareInfo.is_password_protected && (
                        <div className="flex items-center gap-2 text-green-400/80 text-sm">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>密碼驗證成功</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Error Message */}
                  {error && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/20 border border-red-500/30">
                      <AlertCircle className="w-4 h-4 text-red-400" />
                      <span className="text-red-300 text-sm">{error}</span>
                    </div>
                  )}
                  
                  {/* Download Button */}
                  <Button
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className="w-full h-12 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium shadow-lg"
                  >
                    {isDownloading ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>下載中... {downloadProgress > 0 ? `${downloadProgress.toFixed(0)}%` : ''}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Download className="w-5 h-5" />
                        <span>下載檔案</span>
                      </div>
                    )}
                  </Button>
                  
                  {/* Download Progress Bar */}
                  {isDownloading && downloadProgress > 0 && (
                    <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-blue-500 to-purple-600"
                        initial={{ width: 0 }}
                        animate={{ width: `${downloadProgress}%` }}
                        transition={{ duration: 0.1 }}
                      />
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
        
        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center text-white/40 text-xs mt-4"
        >
          由 Koimsurai NAS 提供安全檔案分享服務
        </motion.p>
      </motion.div>
    </div>
  );
}
