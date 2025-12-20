'use client';

import React from 'react';
import { useUploadStore } from '@/store/upload-store';
import { X, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';

export const UploadStatus = () => {
  const { tasks, isExpanded, toggleExpanded, clearCompleted, removeTask, updateTask } = useUploadStore();
  const taskList = Object.values(tasks);
  
  if (taskList.length === 0) return null;

  const completedCount = taskList.filter(t => t.status === 'completed').length;
  const uploadingCount = taskList.filter(t => t.status === 'uploading').length;
  const errorCount = taskList.filter(t => t.status === 'error').length;

  const getStatusText = () => {
    if (uploadingCount > 0) return `Uploading ${uploadingCount} item${uploadingCount > 1 ? 's' : ''}`;
    if (errorCount > 0) return `${errorCount} upload${errorCount > 1 ? 's' : ''} failed`;
    return `${completedCount} upload${completedCount > 1 ? 's' : ''} complete`;
  };

  return (
    <div className="fixed bottom-4 right-4 w-80 bg-white dark:bg-zinc-900 rounded-t-lg shadow-2xl border border-gray-200 dark:border-zinc-800 overflow-hidden z-50 transition-all duration-300 ease-in-out">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-4 py-3 bg-zinc-100 dark:bg-zinc-800 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        onClick={toggleExpanded}
      >
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {getStatusText()}
        </span>
        <div className="flex items-center gap-2">
          <button 
            onClick={(e) => { e.stopPropagation(); toggleExpanded(); }}
            className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-full"
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); clearCompleted(); }}
            className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-full"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* List */}
      <div className={cn(
        "transition-all duration-300 ease-in-out overflow-y-auto bg-white dark:bg-zinc-900",
        isExpanded ? "max-h-64" : "max-h-0"
      )}>
        {taskList.map((task) => (
          <div key={task.id} className="group flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-zinc-800 last:border-0 hover:bg-gray-50 dark:hover:bg-zinc-800/50">
            <div className="flex-shrink-0">
              {task.status === 'uploading' && <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />}
              {task.status === 'completed' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
              {task.status === 'error' && <AlertCircle className="w-5 h-5 text-red-500" />}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate" title={task.file.name}>
                  {task.file.name}
                </span>
              </div>
              {task.status === 'uploading' && (
                <Progress value={task.progress} className="h-1" />
              )}
              {task.status === 'error' && (
                <span className="text-xs text-red-500 truncate block">{task.error || 'Upload failed'}</span>
              )}
            </div>

            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
              {task.status === 'error' && (
                <button
                  onClick={() => updateTask(task.id, { status: 'uploading', error: undefined })}
                  className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded"
                  title="Retry"
                >
                  <RefreshCw className="w-4 h-4 text-blue-500" />
                </button>
              )}
              <button
                onClick={() => removeTask(task.id)}
                className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};