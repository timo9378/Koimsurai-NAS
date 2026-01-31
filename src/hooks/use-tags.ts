'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { UserTag, TaggedFile } from '@/types/api';

// Predefined tag colors (macOS style)
export const TAG_COLORS = {
  red: '#FF3B30',
  orange: '#FF9500',
  yellow: '#FFCC00',
  green: '#34C759',
  blue: '#007AFF',
  purple: '#AF52DE',
  gray: '#8E8E93',
} as const;

export type TagColorName = keyof typeof TAG_COLORS;

export function useUserTags() {
  return useQuery<UserTag[]>({
    queryKey: ['tags'],
    queryFn: async () => {
      const { data } = await apiClient.get<UserTag[]>('/tags');
      return data;
    },
  });
}

export function useFilesByTag(tagName: string | null) {
  return useQuery<TaggedFile[]>({
    queryKey: ['tags', tagName, 'files'],
    queryFn: async () => {
      if (!tagName) return [];
      const { data } = await apiClient.get<TaggedFile[]>(`/tags/${encodeURIComponent(tagName)}/files`);
      return data;
    },
    enabled: !!tagName,
  });
}

export function useAddTag() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ path, tagName, color }: { path: string; tagName: string; color?: string }) => {
      await apiClient.post(`/tags/add/${path}`, {
        tag_name: tagName,
        color,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
}

export function useRemoveTag() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ path, tagName }: { path: string; tagName: string }) => {
      await apiClient.delete(`/tags/remove/${encodeURIComponent(tagName)}/${path}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
}

export function useToggleStar() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (path: string) => {
      await apiClient.post(`/star/file/${path}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
}
