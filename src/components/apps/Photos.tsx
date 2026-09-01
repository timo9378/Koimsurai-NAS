"use client";

import { useState, useMemo } from "react";
import type { FileInfo } from "@/types/api";
import { useMediaTimeline } from "@/features/files/api/useFiles";
import { flattenTimeline, filterTimeline } from "./photos/timeline";
import { apiFileUrl } from "@/lib/paths";
import { format, parseISO } from "date-fns";
import { Search, Image as ImageIcon, Film, Calendar } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { FilePreview } from "./FilePreview";

export const Photos = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null);

  // ⚠️ 這裡原本是自己寫的 useQuery，打 `/api/media/timeline` —— 而 apiClient 的
  // baseURL 就是 `/api`，實際請求變成 `/api/api/media/timeline`，永遠 404。
  // 也就是 Photos 從來沒有顯示過任何東西。`useMediaTimeline` 一直都在，
  // 網址是對的，只是沒有任何呼叫點（knip 的「零呼叫點」清單裡就有它）。
  const { data: timeline, isLoading } = useMediaTimeline("day");

  // 搜尋原本只是塞進 queryKey 裡，沒有送給後端也沒有在前端過濾 ——
  // 那個輸入框打字完全沒有作用。時間軸是一次抓回來的，在這裡過濾就好。
  const flattenedItems = useMemo(
    () => flattenTimeline(filterTimeline(timeline ?? [], searchQuery)),
    [timeline, searchQuery],
  );

  return (
    <div className="flex h-full bg-white/50 dark:bg-black/50 backdrop-blur-xl rounded-lg overflow-hidden border border-white/20 shadow-2xl flex-col">
      {/* Toolbar */}
      <div className="h-14 flex items-center justify-between px-6 border-b border-white/10 bg-white/40 dark:bg-black/40 backdrop-blur-md z-10">
        <div className="flex items-center gap-4">
          <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg text-white shadow-lg">
            <ImageIcon className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white">Photos</h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative group">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-blue-500 transition-colors" />
            <input
              type="text"
              placeholder="Search photos (e.g. 'Dog', 'Beach')..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 h-9 pl-9 pr-3 text-sm bg-black/5 dark:bg-white/10 rounded-full border border-transparent focus:border-blue-500 focus:outline-none text-gray-700 dark:text-gray-200 placeholder:text-gray-500 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            Loading your memories...
          </div>
        ) : !timeline || timeline.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-4">
            <ImageIcon className="w-16 h-16 opacity-20" />
            <p>No photos found</p>
          </div>
        ) : (
          <Virtuoso
            style={{ height: "100%" }}
            data={flattenedItems}
            itemContent={(_index, item) => {
              if (item.type === "header") {
                return (
                  <div className="flex items-center gap-2 bg-white/80 dark:bg-black/80 backdrop-blur-md py-2 z-10 px-2 rounded-lg mb-2 mt-4">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    <h3 className="font-medium text-gray-900 dark:text-white">
                      {format(parseISO(item.date), "MMMM d, yyyy")}
                    </h3>
                    <span className="text-xs text-gray-500">{item.count} items</span>
                  </div>
                );
              } else {
                return (
                  <div className="grid grid-cols-6 gap-1 mb-1">
                    {item.items.map((photo) => (
                      <button
                        type="button"
                        key={photo.path}
                        aria-label={`預覽 ${photo.name}`}
                        className="aspect-square relative group cursor-pointer overflow-hidden rounded-md bg-gray-100 dark:bg-white/5"
                        onClick={() => setPreviewFile(photo)}
                      >
                        <img
                          src={apiFileUrl("thumbnail/medium", photo.path)}
                          alt={photo.name}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                          loading="lazy"
                        />
                        {photo.mime_type?.startsWith("video/") && (
                          <div className="absolute top-2 right-2 p-1 bg-black/50 rounded-full text-white">
                            <Film className="w-3 h-3" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                      </button>
                    ))}
                    {/* Fill empty slots if row is not full — 只是把最後一列補滿的
                        空格子，沒有內容也沒有身分，index 就是正確的 key */}
                    {/* oxlint-disable @eslint-react/no-array-index-key */}
                    {Array.from({ length: 6 - item.items.length }).map((_, i) => (
                      <div key={`empty-${i}`} />
                    ))}
                    {/* oxlint-enable @eslint-react/no-array-index-key */}
                  </div>
                );
              }
            }}
          />
        )}
      </div>

      {previewFile && <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} />}
    </div>
  );
};
