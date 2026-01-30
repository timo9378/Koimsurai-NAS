'use client';

import React from 'react';
import {
  File,
  FileText,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileType,
  Folder,
  FolderOpen,
  FileDown,
  FileCog,
  FileKey,
  FileTerminal,
  FileCheck,
  Presentation,
  Database,
  FileX,
  Film,
  Music,
  Image,
  Code,
  Braces,
  Hash,
  FileWarning,
  FileQuestion,
  BookOpen,
  Cpu,
  Globe,
  Lock,
  Settings,
  Package,
  Palette,
  Clapperboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type IconComponent = React.ComponentType<{ className?: string }>;

interface FileIconConfig {
  icon: IconComponent;
  color: string;
  bgColor?: string;
}

// 按副檔名對應圖標
const extensionIconMap: Record<string, FileIconConfig> = {
  // 文檔類
  pdf: { icon: FileText, color: 'text-red-500' },
  doc: { icon: FileText, color: 'text-blue-600' },
  docx: { icon: FileText, color: 'text-blue-600' },
  txt: { icon: FileText, color: 'text-gray-500' },
  rtf: { icon: FileText, color: 'text-gray-500' },
  odt: { icon: FileText, color: 'text-blue-500' },
  md: { icon: BookOpen, color: 'text-gray-600' },
  markdown: { icon: BookOpen, color: 'text-gray-600' },
  
  // 試算表
  xls: { icon: FileSpreadsheet, color: 'text-green-600' },
  xlsx: { icon: FileSpreadsheet, color: 'text-green-600' },
  csv: { icon: FileSpreadsheet, color: 'text-green-500' },
  ods: { icon: FileSpreadsheet, color: 'text-green-500' },
  
  // 簡報
  ppt: { icon: Presentation, color: 'text-orange-500' },
  pptx: { icon: Presentation, color: 'text-orange-500' },
  odp: { icon: Presentation, color: 'text-orange-500' },
  key: { icon: Presentation, color: 'text-orange-400' },
  
  // 程式碼類
  js: { icon: Braces, color: 'text-yellow-500' },
  jsx: { icon: Braces, color: 'text-cyan-500' },
  ts: { icon: Braces, color: 'text-blue-500' },
  tsx: { icon: Braces, color: 'text-blue-400' },
  py: { icon: Code, color: 'text-yellow-600' },
  java: { icon: Code, color: 'text-red-500' },
  c: { icon: Code, color: 'text-blue-700' },
  cpp: { icon: Code, color: 'text-blue-600' },
  h: { icon: Code, color: 'text-purple-500' },
  hpp: { icon: Code, color: 'text-purple-500' },
  cs: { icon: Code, color: 'text-purple-600' },
  go: { icon: Code, color: 'text-cyan-600' },
  rs: { icon: Cpu, color: 'text-orange-600' },
  rb: { icon: Code, color: 'text-red-600' },
  php: { icon: Code, color: 'text-indigo-500' },
  swift: { icon: Code, color: 'text-orange-500' },
  kt: { icon: Code, color: 'text-purple-500' },
  scala: { icon: Code, color: 'text-red-500' },
  
  // Web 相關
  html: { icon: Globe, color: 'text-orange-500' },
  htm: { icon: Globe, color: 'text-orange-500' },
  css: { icon: Palette, color: 'text-blue-500' },
  scss: { icon: Palette, color: 'text-pink-500' },
  sass: { icon: Palette, color: 'text-pink-500' },
  less: { icon: Palette, color: 'text-blue-400' },
  vue: { icon: Braces, color: 'text-green-500' },
  svelte: { icon: Braces, color: 'text-orange-600' },
  
  // 資料格式
  json: { icon: FileJson, color: 'text-yellow-600' },
  xml: { icon: FileCode, color: 'text-orange-500' },
  yaml: { icon: FileCode, color: 'text-purple-500' },
  yml: { icon: FileCode, color: 'text-purple-500' },
  toml: { icon: FileCode, color: 'text-gray-600' },
  ini: { icon: Settings, color: 'text-gray-500' },
  conf: { icon: Settings, color: 'text-gray-500' },
  env: { icon: FileCog, color: 'text-yellow-600' },
  
  // 資料庫
  sql: { icon: Database, color: 'text-blue-500' },
  db: { icon: Database, color: 'text-gray-600' },
  sqlite: { icon: Database, color: 'text-blue-400' },
  
  // 圖片類
  jpg: { icon: Image, color: 'text-green-500' },
  jpeg: { icon: Image, color: 'text-green-500' },
  png: { icon: Image, color: 'text-blue-500' },
  gif: { icon: Image, color: 'text-purple-500' },
  bmp: { icon: Image, color: 'text-orange-500' },
  webp: { icon: Image, color: 'text-cyan-500' },
  svg: { icon: Image, color: 'text-orange-400' },
  ico: { icon: Image, color: 'text-blue-400' },
  tiff: { icon: Image, color: 'text-gray-500' },
  tif: { icon: Image, color: 'text-gray-500' },
  raw: { icon: Image, color: 'text-gray-600' },
  psd: { icon: Image, color: 'text-blue-600' },
  ai: { icon: Image, color: 'text-orange-500' },
  eps: { icon: Image, color: 'text-red-500' },
  heic: { icon: Image, color: 'text-purple-500' },
  heif: { icon: Image, color: 'text-purple-500' },
  
  // 影片類
  mp4: { icon: Film, color: 'text-purple-500' },
  mkv: { icon: Film, color: 'text-blue-500' },
  avi: { icon: Film, color: 'text-orange-500' },
  mov: { icon: Film, color: 'text-gray-500' },
  wmv: { icon: Film, color: 'text-blue-400' },
  flv: { icon: Film, color: 'text-red-500' },
  webm: { icon: Film, color: 'text-cyan-500' },
  m4v: { icon: Film, color: 'text-purple-400' },
  '3gp': { icon: Film, color: 'text-green-500' },
  
  // 音訊類
  mp3: { icon: Music, color: 'text-pink-500' },
  wav: { icon: Music, color: 'text-blue-500' },
  flac: { icon: Music, color: 'text-orange-500' },
  aac: { icon: Music, color: 'text-purple-500' },
  ogg: { icon: Music, color: 'text-green-500' },
  wma: { icon: Music, color: 'text-blue-400' },
  m4a: { icon: Music, color: 'text-red-500' },
  aiff: { icon: Music, color: 'text-gray-500' },
  
  // 壓縮檔
  zip: { icon: FileArchive, color: 'text-yellow-600' },
  rar: { icon: FileArchive, color: 'text-purple-500' },
  '7z': { icon: FileArchive, color: 'text-green-600' },
  tar: { icon: FileArchive, color: 'text-orange-500' },
  gz: { icon: FileArchive, color: 'text-red-500' },
  bz2: { icon: FileArchive, color: 'text-purple-600' },
  xz: { icon: FileArchive, color: 'text-blue-500' },
  
  // 執行檔
  exe: { icon: Cpu, color: 'text-blue-600' },
  msi: { icon: Package, color: 'text-blue-500' },
  dmg: { icon: Package, color: 'text-gray-500' },
  app: { icon: Package, color: 'text-blue-400' },
  deb: { icon: Package, color: 'text-red-500' },
  rpm: { icon: Package, color: 'text-yellow-600' },
  apk: { icon: Package, color: 'text-green-500' },
  
  // 終端機/腳本
  sh: { icon: FileTerminal, color: 'text-green-500' },
  bash: { icon: FileTerminal, color: 'text-green-500' },
  zsh: { icon: FileTerminal, color: 'text-green-400' },
  fish: { icon: FileTerminal, color: 'text-cyan-500' },
  ps1: { icon: FileTerminal, color: 'text-blue-500' },
  bat: { icon: FileTerminal, color: 'text-gray-600' },
  cmd: { icon: FileTerminal, color: 'text-gray-600' },
  
  // 安全/金鑰
  pem: { icon: FileKey, color: 'text-yellow-500' },
  crt: { icon: Lock, color: 'text-green-500' },
  cer: { icon: Lock, color: 'text-green-500' },
  p12: { icon: Lock, color: 'text-orange-500' },
  pfx: { icon: Lock, color: 'text-orange-500' },
  
  // 字型
  ttf: { icon: FileType, color: 'text-gray-600' },
  otf: { icon: FileType, color: 'text-gray-600' },
  woff: { icon: FileType, color: 'text-blue-500' },
  woff2: { icon: FileType, color: 'text-blue-500' },
  eot: { icon: FileType, color: 'text-gray-500' },
  
  // 其他
  log: { icon: FileText, color: 'text-gray-400' },
  lock: { icon: Lock, color: 'text-gray-500' },
  bak: { icon: FileCheck, color: 'text-gray-400' },
  tmp: { icon: FileWarning, color: 'text-yellow-500' },
  iso: { icon: Package, color: 'text-blue-500' },
  torrent: { icon: FileDown, color: 'text-green-500' },
};

// 按 MIME 類型對應圖標（當沒有副檔名匹配時使用）
const mimeTypeIconMap: Record<string, FileIconConfig> = {
  'image': { icon: Image, color: 'text-green-500' },
  'video': { icon: Film, color: 'text-purple-500' },
  'audio': { icon: Music, color: 'text-pink-500' },
  'text': { icon: FileText, color: 'text-gray-500' },
  'application/pdf': { icon: FileText, color: 'text-red-500' },
  'application/json': { icon: FileJson, color: 'text-yellow-600' },
  'application/xml': { icon: FileCode, color: 'text-orange-500' },
  'application/zip': { icon: FileArchive, color: 'text-yellow-600' },
  'application/x-rar-compressed': { icon: FileArchive, color: 'text-purple-500' },
  'application/x-7z-compressed': { icon: FileArchive, color: 'text-green-600' },
};

// 預設圖標
const defaultFileIcon: FileIconConfig = { icon: File, color: 'text-gray-500' };
const defaultFolderIcon: FileIconConfig = { icon: Folder, color: 'text-blue-500' };

/**
 * 根據文件名取得副檔名
 */
function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === 0) return '';
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * 根據文件資訊取得對應的圖標配置
 */
export function getFileIconConfig(
  filename: string,
  isDir: boolean,
  mimeType?: string
): FileIconConfig {
  if (isDir) {
    return defaultFolderIcon;
  }

  // 先嘗試用副檔名匹配
  const ext = getFileExtension(filename);
  if (ext && extensionIconMap[ext]) {
    return extensionIconMap[ext];
  }

  // 再嘗試用 MIME 類型匹配
  if (mimeType) {
    // 完整 MIME 類型匹配
    if (mimeTypeIconMap[mimeType]) {
      return mimeTypeIconMap[mimeType];
    }
    // 主類型匹配（如 image/*, video/* 等）
    const mainType = mimeType.split('/')[0];
    if (mimeTypeIconMap[mainType]) {
      return mimeTypeIconMap[mainType];
    }
  }

  return defaultFileIcon;
}

interface FileIconProps {
  filename: string;
  isDir: boolean;
  mimeType?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  isOpen?: boolean; // 用於資料夾開啟狀態
}

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-10 h-10',
  xl: 'w-12 h-12',
};

/**
 * 通用文件圖標組件
 */
export function FileTypeIcon({
  filename,
  isDir,
  mimeType,
  size = 'md',
  className,
  isOpen = false,
}: FileIconProps) {
  const config = getFileIconConfig(filename, isDir, mimeType);
  
  // 資料夾開啟狀態使用不同圖標
  const IconComponent = isDir && isOpen ? FolderOpen : config.icon;
  
  return (
    <IconComponent 
      className={cn(
        sizeClasses[size],
        config.color,
        isDir && 'fill-current/20',
        className
      )}
    />
  );
}

export default FileTypeIcon;
