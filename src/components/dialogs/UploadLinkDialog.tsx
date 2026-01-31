'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Link2,
  Clock,
  Lock,
  Copy,
  Check,
  Eye,
  EyeOff,
  Calendar,
  Infinity as InfinityIcon,
  FolderUp,
  FileUp,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface UploadLinkDialogProps {
  isOpen: boolean;
  onClose: () => void;
  targetPath: string;
  onCreateUploadLink: (options: {
    target_path: string;
    password?: string;
    expires_in_seconds?: number;
    max_files?: number;
    max_file_size?: number;
  }) => Promise<{ id: string; url: string; expires_at?: string }>;
}

const EXPIRY_OPTIONS = [
  { label: '1 小時', value: 3600, icon: Clock },
  { label: '24 小時', value: 86400, icon: Clock },
  { label: '7 天', value: 604800, icon: Calendar },
  { label: '30 天', value: 2592000, icon: Calendar },
  { label: '永不過期', value: null, icon: InfinityIcon },
];

const MAX_FILE_SIZE_OPTIONS = [
  { label: '10 MB', value: 10 * 1024 * 1024 },
  { label: '100 MB', value: 100 * 1024 * 1024 },
  { label: '1 GB', value: 1024 * 1024 * 1024 },
  { label: '無限制', value: null },
];

export function UploadLinkDialog({
  isOpen,
  onClose,
  targetPath,
  onCreateUploadLink,
}: UploadLinkDialogProps) {
  const [step, setStep] = useState<'config' | 'result'>('config');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Config state
  const [enablePassword, setEnablePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedExpiry, setSelectedExpiry] = useState<number | null>(604800); // 默認 7 天
  const [maxFiles, setMaxFiles] = useState<number | null>(null);
  const [maxFileSize, setMaxFileSize] = useState<number | null>(100 * 1024 * 1024); // 默認 100MB
  
  // Result state
  const [uploadLink, setUploadLink] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStep('config');
      setEnablePassword(false);
      setPassword('');
      setSelectedExpiry(604800);
      setMaxFiles(null);
      setMaxFileSize(100 * 1024 * 1024);
      setError(null);
      setUploadLink('');
      setCopied(false);
    }
  }, [isOpen]);

  const handleCreateUploadLink = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await onCreateUploadLink({
        target_path: targetPath,
        password: enablePassword && password ? password : undefined,
        expires_in_seconds: selectedExpiry ?? undefined,
        max_files: maxFiles ?? undefined,
        max_file_size: maxFileSize ?? undefined,
      });

      setUploadLink(`${window.location.origin}/u/${result.id}`);
      setExpiresAt(result.expires_at || null);
      setStep('result');
    } catch (err) {
      setError('建立上傳連結失敗，請稍後再試');
      console.error('Create upload link error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(uploadLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const formatExpiryDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-TW', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getDisplayPath = (path: string) => {
    if (path === '/' || path === '') return '根目錄';
    return path.split('/').pop() || path;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent 
        className="sm:max-w-md bg-gradient-to-b from-zinc-900/95 to-zinc-950/95 backdrop-blur-xl border-zinc-700/50 shadow-2xl"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="border-b border-zinc-700/50 pb-4">
          <DialogTitle className="flex items-center gap-3 text-lg font-semibold text-zinc-100">
            <div className="p-2 rounded-lg bg-purple-500/20">
              <FolderUp className="h-5 w-5 text-purple-400" />
            </div>
            建立上傳連結
          </DialogTitle>
          <DialogDescription className="sr-only">
            建立一個讓他人可以上傳檔案到此資料夾的連結
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {step === 'config' ? (
            <motion.div
              key="config"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6 py-4"
            >
              {/* Target Folder Info */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                <div className="p-2 rounded-lg bg-purple-500/20">
                  <Upload className="h-5 w-5 text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-400">上傳目標資料夾</p>
                  <p className="font-medium text-zinc-200 truncate">{getDisplayPath(targetPath)}</p>
                </div>
              </div>

              {/* Expiry Selection */}
              <div className="space-y-3">
                <Label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  連結有效期限
                </Label>
                <div className="grid grid-cols-3 gap-2">
                  {EXPIRY_OPTIONS.map((option) => (
                    <button
                      key={option.label}
                      onClick={() => setSelectedExpiry(option.value)}
                      className={cn(
                        'flex flex-col items-center gap-1 p-3 rounded-lg border transition-all',
                        selectedExpiry === option.value
                          ? 'bg-purple-500/20 border-purple-500/50 text-purple-400'
                          : 'bg-zinc-800/30 border-zinc-700/50 text-zinc-400 hover:bg-zinc-800/50 hover:border-zinc-600/50'
                      )}
                    >
                      {option.value === null ? (
                        <InfinityIcon className="h-4 w-4" />
                      ) : (
                        <option.icon className="h-4 w-4" />
                      )}
                      <span className="text-xs font-medium">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Max File Size */}
              <div className="space-y-3">
                <Label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <FileUp className="h-4 w-4" />
                  單檔大小限制
                </Label>
                <div className="grid grid-cols-4 gap-2">
                  {MAX_FILE_SIZE_OPTIONS.map((option) => (
                    <button
                      key={option.label}
                      onClick={() => setMaxFileSize(option.value)}
                      className={cn(
                        'flex flex-col items-center gap-1 p-2 rounded-lg border transition-all text-xs',
                        maxFileSize === option.value
                          ? 'bg-purple-500/20 border-purple-500/50 text-purple-400'
                          : 'bg-zinc-800/30 border-zinc-700/50 text-zinc-400 hover:bg-zinc-800/50 hover:border-zinc-600/50'
                      )}
                    >
                      <span className="font-medium">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Max Files Count */}
              <div className="space-y-3">
                <Label className="text-sm font-medium text-zinc-300">
                  檔案數量限制（選填）
                </Label>
                <Input
                  type="number"
                  value={maxFiles ?? ''}
                  onChange={(e) => setMaxFiles(e.target.value ? parseInt(e.target.value) : null)}
                  placeholder="不限制"
                  min={1}
                  className="bg-zinc-800/50 border-zinc-700/50 focus:border-purple-500/50 text-zinc-100"
                />
              </div>

              {/* Password Protection */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    密碼保護
                  </Label>
                  <Switch
                    checked={enablePassword}
                    onCheckedChange={setEnablePassword}
                  />
                </div>
                
                {enablePassword && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="relative">
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        name={`upload-link-password-${Date.now()}`}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="輸入上傳密碼..."
                        autoComplete="new-password"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        data-form-type="other"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        className="pr-10 bg-zinc-800/50 border-zinc-700/50 focus:border-purple-500/50 text-zinc-100"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Error Message */}
              {error && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm text-red-400 bg-red-500/10 p-3 rounded-lg border border-red-500/20"
                >
                  {error}
                </motion.p>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="flex-1 bg-zinc-800/50 border-zinc-700/50 hover:bg-zinc-700/50 text-zinc-300"
                >
                  取消
                </Button>
                <Button
                  onClick={handleCreateUploadLink}
                  disabled={isLoading || (enablePassword && !password)}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {isLoading ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
                      className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full"
                    />
                  ) : (
                    <>
                      <Link2 className="mr-2 h-4 w-4" />
                      建立連結
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="result"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6 py-4"
            >
              {/* Success Icon */}
              <div className="flex justify-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                  className="p-4 rounded-full bg-green-500/20"
                >
                  <Check className="h-8 w-8 text-green-400" />
                </motion.div>
              </div>

              <div className="text-center">
                <h3 className="text-lg font-semibold text-zinc-100">上傳連結已建立</h3>
                <p className="text-sm text-zinc-400 mt-1">
                  {expiresAt
                    ? `有效期至 ${formatExpiryDate(expiresAt)}`
                    : '此連結永不過期'}
                </p>
              </div>

              {/* Upload Link */}
              <div className="space-y-2">
                <Label className="text-sm font-medium text-zinc-300">上傳連結</Label>
                <div className="flex gap-2">
                  <Input
                    value={uploadLink}
                    readOnly
                    className="bg-zinc-800/50 border-zinc-700/50 text-zinc-100 font-mono text-sm"
                  />
                  <Button
                    onClick={handleCopyLink}
                    className={cn(
                      'shrink-0 transition-colors',
                      copied
                        ? 'bg-green-600 hover:bg-green-700'
                        : 'bg-zinc-700 hover:bg-zinc-600'
                    )}
                  >
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Info Box */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20"
              >
                <div className="flex items-start gap-2">
                  <Upload className="h-4 w-4 text-purple-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-purple-400">上傳連結說明</p>
                    <p className="text-xs text-purple-400/70 mt-0.5">
                      擁有此連結的人可以上傳檔案到「{getDisplayPath(targetPath)}」資料夾
                    </p>
                  </div>
                </div>
              </motion.div>

              {/* Password Reminder */}
              {enablePassword && password && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20"
                >
                  <div className="flex items-start gap-2">
                    <Lock className="h-4 w-4 text-amber-400 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-amber-400">密碼保護已啟用</p>
                      <p className="text-xs text-amber-400/70 mt-0.5">
                        訪問者需要輸入密碼才能上傳檔案
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setStep('config')}
                  className="flex-1 bg-zinc-800/50 border-zinc-700/50 hover:bg-zinc-700/50 text-zinc-300"
                >
                  重新設定
                </Button>
                <Button
                  onClick={onClose}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
                >
                  完成
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
