"use client";

import type { FileInfo } from "@/types/api";
import { File, Download, Loader2 } from "lucide-react";
import Editor from "@monaco-editor/react";
import { apiClient } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { useWindowStore } from "@/store/window-store";
import { VideoPlayer } from "@/components/ui/video-player";
import { AudioPlayer } from "@/components/ui/audio-player";
import { formatBytes } from "@/lib/format";
import { apiFileUrl, encodeApiPath } from "@/lib/paths";

interface FilePreviewProps {
  file: FileInfo;
  windowId?: string;
  onClose?: () => void; // Optional now as it's handled by window manager
}

export const FilePreview = ({ file, windowId }: FilePreviewProps) => {
  const { updateWindowSize } = useWindowStore();
  const isImage = file.mime_type?.startsWith("image/");
  const isVideo = file.mime_type?.startsWith("video/");
  const isAudio =
    file.mime_type?.startsWith("audio/") === true ||
    !!/\.(mp3|wav|flac|aac|ogg|m4a|wma|opus)$/i.exec(file.name);
  const isPdf = file.mime_type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isOffice = !!/\.(docx?|xlsx?|pptx?)$/i.exec(file.name);
  const isText =
    file.mime_type?.startsWith("text/") === true ||
    !!/\.(txt|json|md|ts|tsx|js|jsx|css|html|xml|yaml|yml|toml|ini|cfg|conf|sh|bash|zsh|py|rb|rs|go|java|c|cpp|h|hpp|sql|log|env|gitignore|dockerignore|editorconfig|prettierrc|eslintrc)$/i.exec(
      file.name,
    );

  // Construct URLs with proper encoding
  // We use the /api/download endpoint which maps to the backend's download_file handler
  // This handler supports Range requests for video streaming and serves file content

  // apiClient 的 baseURL 已經是 /api，所以走 axios 的那條不帶前綴；
  // 直接進瀏覽器的（img src、video src、下載連結）要完整網址。
  const apiPath = `/download/${encodeApiPath(file.path)}`;
  const fileUrl = apiFileUrl("download", file.path);

  // For video, we use the same endpoint as it supports Range requests
  // We can also try /api/media/stream if download doesn't work, but user indicated download_file is ready.
  // Let's use the same URL for consistency.
  const videoUrl = fileUrl;

  // Fetch text content
  const {
    data: textContent,
    isLoading: isTextLoading,
    error: textError,
  } = useQuery({
    queryKey: ["file-content", file.path],
    queryFn: async () => {
      if (!isText) return null;
      // For text, we need to fetch the raw content
      // Use responseType: 'text' to get the raw text and transformResponse to prevent JSON parsing
      // Use apiPath (without /api prefix) since apiClient already has baseURL: '/api'
      const res = await apiClient.get<string>(apiPath, {
        responseType: "text",
        transformResponse: [(data: string) => data], // Prevent automatic JSON parsing
      });
      // transformResponse 擋掉了 JSON 解析，拿到的就是原始字串
      return res.data;
    },
    enabled: isText,
    retry: 1,
  });

  return (
    <div className="flex flex-col h-full w-full bg-transparent">
      {/* Toolbar */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-gray-200 dark:border-white/10 bg-white/50 dark:bg-white/5 shrink-0 backdrop-blur-sm">
        <div className="flex flex-col overflow-hidden">
          <span className="font-medium truncate text-sm">{file.name}</span>
          <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            // ⚠️ 用上面算好的 fileUrl，不要重組。原本是 `/api/download${file.path}`：
            // path 沒有前導斜線時會變成 `/api/downloadfoo.txt`，而且完全沒有編碼
            // —— 檔名裡有 # 或 ? 就直接斷在那裡。
            href={fileUrl}
            download
            className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative flex items-center justify-center p-4">
        {isImage ? (
          <img
            src={fileUrl}
            alt={file.name}
            className="max-w-full max-h-full object-contain shadow-lg rounded-lg"
            onLoad={(e) => {
              if (windowId) {
                const img = e.currentTarget;
                const naturalWidth = img.naturalWidth;
                const naturalHeight = img.naturalHeight;

                // Calculate optimal window size
                // Max width/height: 80% of screen or reasonable limit
                // Adjusted for new maximized window constraints (padding)
                const maxWidth = window.innerWidth * 0.85;
                const maxHeight = window.innerHeight * 0.85;

                let width = naturalWidth;
                let height = naturalHeight;

                // Add padding for toolbar (48px) and window borders/padding (32px)
                const chromeHeight = 48 + 32;
                const chromeWidth = 32;

                // Scale down if too large
                if (width > maxWidth || height > maxHeight) {
                  const ratio = Math.min(maxWidth / width, (maxHeight - chromeHeight) / height);
                  width *= ratio;
                  height *= ratio;
                }

                // Ensure minimum size
                width = Math.max(width + chromeWidth, 400);
                height = Math.max(height + chromeHeight, 300);

                updateWindowSize(windowId, { width, height });
              }
            }}
            onError={(e) => {
              // Fallback or error handling
              console.error("Image load failed", e);
              e.currentTarget.style.display = "none";
            }}
          />
        ) : isVideo ? (
          <div className="w-full h-full rounded-lg overflow-hidden shadow-2xl">
            <VideoPlayer
              src={videoUrl}
              title={file.name}
              onError={(e) => console.error("Video playback error:", e)}
            />
          </div>
        ) : isAudio ? (
          <div className="w-full max-w-md mx-auto h-full flex items-center justify-center">
            <AudioPlayer
              src={fileUrl}
              title={file.name.replace(/\.[^/.]+$/, "")}
              windowId={windowId}
              onError={(e) => console.error("Audio playback error:", e)}
            />
          </div>
        ) : isText ? (
          isTextLoading ? (
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          ) : textError ? (
            <div className="flex flex-col items-center gap-4 text-gray-500">
              <File className="w-24 h-24 opacity-20" />
              <div className="text-center">
                <p className="text-lg font-medium text-gray-900 dark:text-white">
                  無法載入檔案內容
                </p>
                <p className="text-sm">請嘗試下載檔案後開啟</p>
              </div>
            </div>
          ) : (
            <div className="w-full h-full border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden shadow-sm">
              <Editor
                height="100%"
                defaultLanguage={file.name.split(".").pop() || "plaintext"}
                value={textContent ?? ""}
                theme="vs-dark"
                options={{
                  readOnly: false,
                  minimap: { enabled: false },
                  fontSize: 14,
                  scrollBeyondLastLine: false,
                  padding: { top: 16, bottom: 16 },
                  wordWrap: "on",
                }}
              />
            </div>
          )
        ) : isPdf ? (
          <div className="w-full h-full rounded-lg overflow-hidden shadow-lg bg-white">
            <iframe
              src={`${fileUrl}#toolbar=1&navpanes=0`}
              className="w-full h-full border-0"
              title={file.name}
            />
          </div>
        ) : isOffice ? (
          <div className="flex flex-col items-center gap-4 text-gray-500">
            <File className="w-24 h-24 opacity-20" />
            <div className="text-center">
              <p className="text-lg font-medium text-gray-900 dark:text-white">Office 文件預覽</p>
              <p className="text-sm">目前不支援直接預覽 Office 文件</p>
              <p className="text-sm mt-2">請下載後使用相關軟體開啟</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-gray-500">
            <File className="w-24 h-24 opacity-20" />
            <div className="text-center">
              <p className="text-lg font-medium text-gray-900 dark:text-white">
                Preview not available
              </p>
              <p className="text-sm">Try downloading the file to view it.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
