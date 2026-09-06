import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { File, Loader2 } from "lucide-react";

import { apiClient } from "@/lib/api-client";
import { encodeApiPath } from "@/lib/paths";
import { cn } from "@/lib/utils";

import { DocxView } from "./DocxView";
import { XlsxView } from "./XlsxView";
import { isRenderable, officeKind, unsupportedReason } from "./office";

/**
 * 外層的內容區是 `flex items-center justify-center`（給圖片置中用的）。
 * 文件要的是佔滿整格再自己捲，所以這裡自己開一個定尺寸的框，
 * 只有「一句話」那幾種狀態才置中。
 */
const Frame = ({ children, center }: { children: ReactNode; center?: boolean }) => (
  <div className={cn("w-full h-full min-h-0", center && "flex items-center justify-center")}>
    {children}
  </div>
);

interface OfficePreviewProps {
  name: string;
  path: string;
}

export const OfficePreview = ({ name, path }: OfficePreviewProps) => {
  const kind = officeKind(name);
  const renderable = isRenderable(kind);

  const { data, isLoading, error } = useQuery({
    queryKey: ["office-content", path],
    queryFn: async () => {
      const res = await apiClient.get<ArrayBuffer>(`/download/${encodeApiPath(path)}`, {
        responseType: "arraybuffer",
      });
      return res.data;
    },
    // 不能畫的類型（pptx、.doc）就不要下載 —— 使用者只會看到一段說明，
    // 沒必要為此把整個檔案拉過來。
    enabled: renderable,
    retry: 1,
  });

  if (kind && !renderable) {
    return (
      <Frame center>
        <div className="flex flex-col items-center gap-4 text-gray-500">
          <File className="w-24 h-24 opacity-20" />
          <div className="text-center max-w-sm">
            <p className="text-lg font-medium text-gray-900 dark:text-white">無法預覽</p>
            <p className="text-sm mt-2">{unsupportedReason(kind)}</p>
          </div>
        </div>
      </Frame>
    );
  }

  if (isLoading) {
    return (
      <Frame center>
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </Frame>
    );
  }

  if (error || !data) {
    return (
      <Frame center>
        <div className="flex flex-col items-center gap-4 text-gray-500">
          <File className="w-24 h-24 opacity-20" />
          <p className="text-sm">讀取失敗，請嘗試下載檔案。</p>
        </div>
      </Frame>
    );
  }

  // ⚠️ `key={path}` 不是可有可無的。兩個 view 都在 effect 裡做非同步解析，
  // 沒有 key 的話換檔案只會觸發 effect、不會重設 state —— 新檔案還在解析時
  // 畫面上仍是上一份的內容（或上一份的錯誤訊息）。重新掛載最省事也最不會錯。
  return (
    <Frame>
      {kind === "docx" ? <DocxView key={path} data={data} /> : <XlsxView key={path} data={data} />}
    </Frame>
  );
};
