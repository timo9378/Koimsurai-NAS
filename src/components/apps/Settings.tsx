'use client';

import React, { useState } from 'react';
import {
  Palette,
  HardDrive,
  User,
  Info,
  ChevronRight,
  Moon,
  Sun,
  Monitor,
  Layout,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';
import { useWindowStore, DockPosition } from '@/store/window-store';
import { useSystemStatus } from '@/features/system/api/useSystem';

type SettingsSection = 'appearance' | 'dock' | 'storage' | 'account' | 'about';

interface SettingsItemProps {
  icon: React.ElementType;
  label: string;
  sectionId: SettingsSection;
  isActive: boolean;
  onClick: () => void;
}

const SettingsItem = ({ icon: Icon, label, isActive, onClick }: SettingsItemProps) => (
  <button
    onClick={onClick}
    className={cn(
      'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left',
      isActive
        ? 'bg-blue-500/20 text-blue-500 dark:text-blue-400'
        : 'text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-white/5'
    )}
  >
    <div className={cn(
      'p-1.5 rounded-lg',
      isActive ? 'bg-blue-500/20' : 'bg-gray-200 dark:bg-white/10'
    )}>
      <Icon className="w-4 h-4" />
    </div>
    <span className="flex-1">{label}</span>
    <ChevronRight className="w-4 h-4 opacity-40" />
  </button>
);

const AppearanceSection = () => {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">外觀</h3>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">自訂 NAS 介面外觀</p>
      </div>

      <div className="space-y-4">
        <label className="text-sm font-medium text-gray-700 dark:text-zinc-300">主題模式</label>
        <div className="grid grid-cols-3 gap-3">
          {[
            { id: 'light', label: '淺色', icon: Sun },
            { id: 'dark', label: '深色', icon: Moon },
            { id: 'system', label: '跟隨系統', icon: Monitor },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => setTheme(opt.id)}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all',
                theme === opt.id
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5'
              )}
            >
              <opt.icon className="w-6 h-6" />
              <span className="text-xs font-medium">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const DockSection = () => {
  const { dockPosition, setDockPosition } = useWindowStore();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Dock</h3>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">調整 Dock 列位置</p>
      </div>

      <div className="space-y-4">
        <label className="text-sm font-medium text-gray-700 dark:text-zinc-300">Dock 位置</label>
        <div className="grid grid-cols-3 gap-3">
          {[
            { id: 'left' as DockPosition, label: '左側', icon: ArrowLeft },
            { id: 'bottom' as DockPosition, label: '底部', icon: ArrowDown },
            { id: 'right' as DockPosition, label: '右側', icon: ArrowRight },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => setDockPosition(opt.id)}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all',
                dockPosition === opt.id
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5'
              )}
            >
              <opt.icon className="w-6 h-6" />
              <span className="text-xs font-medium">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const StorageSection = () => {
  const { data: systemStatus } = useSystemStatus();

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">儲存空間</h3>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">檢視磁碟使用狀況</p>
      </div>

      {systemStatus?.disks?.map((disk: any, i: number) => {
        const usedPercent = disk.total_space > 0
          ? ((disk.total_space - disk.available_space) / disk.total_space) * 100
          : 0;

        return (
          <div key={i} className="p-4 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-gray-500 dark:text-zinc-400" />
                <span className="font-medium text-gray-900 dark:text-white">{disk.name || disk.mount_point}</span>
              </div>
              <span className="text-sm text-gray-500 dark:text-zinc-400">
                {formatSize(disk.total_space - disk.available_space)} / {formatSize(disk.total_space)}
              </span>
            </div>
            <div className="w-full h-2 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  usedPercent > 90 ? 'bg-red-500' : usedPercent > 70 ? 'bg-yellow-500' : 'bg-blue-500'
                )}
                style={{ width: `${usedPercent}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 dark:text-zinc-400">
              可用: {formatSize(disk.available_space)} ({(100 - usedPercent).toFixed(1)}%)
            </div>
          </div>
        );
      })}

      {(!systemStatus?.disks || systemStatus.disks.length === 0) && (
        <div className="text-sm text-gray-500 dark:text-zinc-400">載入中...</div>
      )}
    </div>
  );
};

const AccountSection = () => {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">帳戶</h3>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">管理您的帳戶設定</p>
      </div>

      <div className="p-4 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <User className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="font-medium text-gray-900 dark:text-white">管理員</div>
            <div className="text-sm text-gray-500 dark:text-zinc-400">admin</div>
          </div>
        </div>
      </div>

      <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
        <p className="text-sm text-amber-700 dark:text-amber-400">
          密碼修改功能即將推出
        </p>
      </div>
    </div>
  );
};

const AboutSection = () => {
  const { data: systemStatus } = useSystemStatus();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">關於</h3>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">系統資訊</p>
      </div>

      <div className="flex flex-col items-center gap-3 py-6">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
          <HardDrive className="w-10 h-10 text-white" />
        </div>
        <div className="text-center">
          <div className="text-xl font-bold text-gray-900 dark:text-white">Koimsurai NAS</div>
          <div className="text-sm text-gray-500 dark:text-zinc-400">版本 1.0.0</div>
        </div>
      </div>

      <div className="space-y-2">
        {[
          { label: 'CPU 使用率', value: systemStatus ? `${Math.round(systemStatus.cpu_usage)}%` : '-' },
          { label: '記憶體', value: systemStatus ? `${(systemStatus.used_memory / (1024 * 1024 * 1024)).toFixed(1)} / ${(systemStatus.total_memory / (1024 * 1024 * 1024)).toFixed(1)} GB` : '-' },
          { label: 'Swap', value: systemStatus ? `${(systemStatus.used_swap / (1024 * 1024 * 1024)).toFixed(1)} / ${(systemStatus.total_swap / (1024 * 1024 * 1024)).toFixed(1)} GB` : '-' },
          { label: 'GPU', value: systemStatus?.gpu ? `${systemStatus.gpu.name} (${Math.round(systemStatus.gpu.utilization)}%)` : '無 GPU 資訊' },
          { label: '磁碟數量', value: systemStatus ? `${systemStatus.disks.length} 個磁碟` : '-' },
        ].map((item) => (
          <div key={item.label} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-white/5 last:border-0">
            <span className="text-sm text-gray-500 dark:text-zinc-400">{item.label}</span>
            <span className="text-sm font-medium text-gray-900 dark:text-white">{item.value}</span>
          </div>
        ))}
      </div>

      <div className="text-center pt-4">
        <p className="text-xs text-gray-400 dark:text-zinc-500">
          © 2025-2026 Koimsurai. All rights reserved.
        </p>
      </div>
    </div>
  );
};

const SECTIONS: { id: SettingsSection; label: string; icon: React.ElementType }[] = [
  { id: 'appearance', label: '外觀', icon: Palette },
  { id: 'dock', label: 'Dock', icon: Layout },
  { id: 'storage', label: '儲存空間', icon: HardDrive },
  { id: 'account', label: '帳戶', icon: User },
  { id: 'about', label: '關於', icon: Info },
];

export const Settings = () => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance');

  const renderSection = () => {
    switch (activeSection) {
      case 'appearance': return <AppearanceSection />;
      case 'dock': return <DockSection />;
      case 'storage': return <StorageSection />;
      case 'account': return <AccountSection />;
      case 'about': return <AboutSection />;
    }
  };

  return (
    <div className="h-full flex bg-gray-50/80 dark:bg-zinc-950/20">
      {/* Sidebar */}
      <div className="w-56 border-r border-gray-200 dark:border-white/10 p-3 space-y-1 overflow-y-auto">
        <div className="px-3 py-2 mb-2">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">設定</h2>
        </div>
        {SECTIONS.map((section) => (
          <SettingsItem
            key={section.id}
            icon={section.icon}
            label={section.label}
            sectionId={section.id}
            isActive={activeSection === section.id}
            onClick={() => setActiveSection(section.id)}
          />
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-lg">
          {renderSection()}
        </div>
      </div>
    </div>
  );
};
