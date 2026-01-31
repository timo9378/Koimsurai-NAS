'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from '@/lib/utils';
import { X, Plus, Check } from 'lucide-react';
import { useAddTag, useRemoveTag, TAG_COLORS, TagColorName } from '@/hooks/use-tags';
import type { FileInfo, Tag } from '@/types/api';

interface TagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: FileInfo | null;
}

export function TagDialog({ open, onOpenChange, file }: TagDialogProps) {
  const [newTagName, setNewTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState<TagColorName>('blue');
  const [isCreating, setIsCreating] = useState(false);

  const addTag = useAddTag();
  const removeTag = useRemoveTag();

  const existingTags = file?.tags || [];

  const handleAddTag = async (tagName: string, color: string) => {
    if (!file) return;
    
    try {
      await addTag.mutateAsync({
        path: file.path.startsWith('/') ? file.path.slice(1) : file.path,
        tagName,
        color,
      });
      setNewTagName('');
      setIsCreating(false);
    } catch (error) {
      console.error('Failed to add tag:', error);
    }
  };

  const handleRemoveTag = async (tagName: string) => {
    if (!file) return;
    
    try {
      await removeTag.mutateAsync({
        path: file.path.startsWith('/') ? file.path.slice(1) : file.path,
        tagName,
      });
    } catch (error) {
      console.error('Failed to remove tag:', error);
    }
  };

  const handleQuickAddTag = (colorName: TagColorName) => {
    // Check if this color tag already exists
    const existingTag = existingTags.find(t => 
      t.name.toLowerCase() === colorName.toLowerCase() ||
      t.color === TAG_COLORS[colorName]
    );
    
    if (existingTag) {
      handleRemoveTag(existingTag.name);
    } else {
      handleAddTag(colorName.charAt(0).toUpperCase() + colorName.slice(1), TAG_COLORS[colorName]);
    }
  };

  const isTagSelected = (colorName: TagColorName): boolean => {
    return existingTags.some(t => 
      t.name.toLowerCase() === colorName.toLowerCase() ||
      t.color === TAG_COLORS[colorName]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="tag-dialog-description">
        <DialogHeader>
          <DialogTitle>管理標籤</DialogTitle>
          <DialogDescription id="tag-dialog-description">
            為 {file?.name} 新增或移除標籤
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Quick color tags */}
          <div className="space-y-3">
            <Label className="text-sm text-gray-500 dark:text-gray-400">快速標籤</Label>
            <div className="flex flex-wrap gap-3">
              {(Object.keys(TAG_COLORS) as TagColorName[]).map((colorName) => (
                <button
                  key={colorName}
                  onClick={() => handleQuickAddTag(colorName)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-full text-sm transition-all border",
                    isTagSelected(colorName)
                      ? "bg-blue-500/10 border-blue-500/50 ring-2 ring-offset-2 ring-offset-background ring-blue-500"
                      : "border-transparent hover:bg-black/5 dark:hover:bg-white/10"
                  )}
                >
                  <div
                    className="w-3.5 h-3.5 rounded-full flex-shrink-0 shadow-sm"
                    style={{ backgroundColor: TAG_COLORS[colorName] }}
                  />
                  <span className="capitalize font-medium">{colorName}</span>
                  {isTagSelected(colorName) && (
                    <Check className="w-4 h-4 text-blue-500" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Current tags on file */}
          {existingTags.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm text-gray-500 dark:text-gray-400">目前標籤</Label>
              <div className="flex flex-wrap gap-2">
                {existingTags.map((tag) => (
                  <div
                    key={tag.name}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/5 dark:bg-white/10 text-sm"
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: tag.color || TAG_COLORS.gray }}
                    />
                    <span>{tag.name}</span>
                    <button
                      onClick={() => handleRemoveTag(tag.name)}
                      className="p-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Custom tag creation */}
          <div className="space-y-2">
            <Label className="text-sm text-gray-500 dark:text-gray-400">自訂標籤</Label>
            {isCreating ? (
              <div className="flex gap-2">
                <div className="flex-1 flex gap-2">
                  <select
                    value={selectedColor}
                    onChange={(e) => setSelectedColor(e.target.value as TagColorName)}
                    className="h-9 px-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                  >
                    {(Object.keys(TAG_COLORS) as TagColorName[]).map((color) => (
                      <option key={color} value={color}>
                        {color.charAt(0).toUpperCase() + color.slice(1)}
                      </option>
                    ))}
                  </select>
                  <Input
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="輸入標籤名稱"
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newTagName.trim()) {
                        handleAddTag(newTagName.trim(), TAG_COLORS[selectedColor]);
                      } else if (e.key === 'Escape') {
                        setIsCreating(false);
                        setNewTagName('');
                      }
                    }}
                    autoFocus
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    if (newTagName.trim()) {
                      handleAddTag(newTagName.trim(), TAG_COLORS[selectedColor]);
                    }
                  }}
                  disabled={!newTagName.trim()}
                >
                  新增
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setIsCreating(false);
                    setNewTagName('');
                  }}
                >
                  取消
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCreating(true)}
                className="gap-1"
              >
                <Plus className="w-4 h-4" />
                新增自訂標籤
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
