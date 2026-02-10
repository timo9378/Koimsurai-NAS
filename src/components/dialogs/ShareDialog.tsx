'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Share2,
  Link2,
  Clock,
  Lock,
  Copy,
  Check,
  X,
  Eye,
  EyeOff,
  Calendar,
  Infinity as InfinityIcon,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { FileTypeIcon } from '@/lib/file-icons';

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  filePath: string;
  isDirectory?: boolean;
  onCreateShare: (options: {
    file_path: string;
    password?: string;
    expires_in_seconds?: number;
  }) => Promise<{ id: string; url: string; expires_at?: string }>;
}

const EXPIRY_OPTIONS = [
  { label: '1 小時', value: 3600, icon: Clock },
  { label: '24 小時', value: 86400, icon: Clock },
  { label: '7 天', value: 604800, icon: Calendar },
  { label: '30 天', value: 2592000, icon: Calendar },
  { label: '永不過期', value: null, icon: InfinityIcon },
];

export function ShareDialog({
  isOpen,
  onClose,
  fileName,
  filePath,
  isDirectory = false,
  onCreateShare,
}: ShareDialogProps) {
  const [step, setStep] = useState<'config' | 'result'>('config');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Config state
  const [enablePassword, setEnablePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedExpiry, setSelectedExpiry] = useState<number | null>(86400); // 默認 24 小時
  
  // Result state
  const [shareLink, setShareLink] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStep('config');
      setEnablePassword(false);
      setPassword('');
      setSelectedExpiry(86400);
      setError(null);
      setShareLink('');
      setCopied(false);
    }
  }, [isOpen]);

  const handleCreateShare = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await onCreateShare({
        file_path: filePath,
        password: enablePassword && password ? password : undefined,
        expires_in_seconds: selectedExpiry ?? undefined,
      });

      setShareLink(`${window.location.origin}/s/${result.id}`);
      setExpiresAt(result.expires_at || null);
      setStep('result');
    } catch (err) {
      setError('建立分享連結失敗，請稍後再試');
      console.error('Create share error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent 
        className="sm:max-w-md bg-gradient-to-b from-zinc-900/95 to-zinc-950/95 backdrop-blur-xl border-zinc-700/50 shadow-2xl overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="border-b border-zinc-700/50 pb-4">
          <DialogTitle className="flex items-center gap-3 text-lg font-semibold text-zinc-100">
            <div className="p-2 rounded-lg bg-blue-500/20">
              <Share2 className="h-5 w-5 text-blue-400" />
            </div>
            分享檔案
          </DialogTitle>
          <DialogDescription className="sr-only">
            設定檔案分享連結的有效期限和密碼保護
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
              {/* File Info */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                <FileTypeIcon
                  filename={fileName}
                  isDir={isDirectory}
                  size="md"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-zinc-200 truncate">{fileName}</p>
                  <p className="text-xs text-zinc-500 truncate">{filePath}</p>
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
                          ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
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
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
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
                        name={`share-password-${Date.now()}`}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="輸入分享密碼..."
                        autoComplete="new-password"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        data-form-type="other"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        className="pr-10 bg-zinc-800/50 border-zinc-700/50 focus:border-blue-500/50 text-zinc-100"
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
                  onClick={handleCreateShare}
                  disabled={isLoading || (enablePassword && !password)}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
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
                <h3 className="text-lg font-semibold text-zinc-100">分享連結已建立</h3>
                <p className="text-sm text-zinc-400 mt-1">
                  {expiresAt
                    ? `有效期至 ${formatExpiryDate(expiresAt)}`
                    : '此連結永不過期'}
                </p>
              </div>

              {/* Share Link */}
              <div className="space-y-2">
                <Label className="text-sm font-medium text-zinc-300">分享連結</Label>
                <div className="flex gap-2">
                  <Input
                    value={shareLink}
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
                        訪問者需要輸入密碼才能下載此檔案
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
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
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
