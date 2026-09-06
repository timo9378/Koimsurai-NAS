import { useEffect, useRef, useState } from "react";

/**
 * .docx → HTML。
 *
 * docx-preview 的 API 是「畫進一個 DOM 節點」而不是回傳字串，所以這裡用 ref
 * 而不是 `dangerouslySetInnerHTML` —— 順帶避開自己拼 HTML 的注入風險。
 *
 * 動態 import 是刻意的：這包加上 exceljs 有一百多萬 byte，
 * 沒人開 Office 檔的時候不該進主 bundle。
 *
 * ⚠️ 由呼叫端用 `key={path}` 掛載，換檔案＝重新掛載，所以不需要重設 state。
 */
export const DocxView = ({ data }: { data: ArrayBuffer }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;

    // ⚠️ 不要用 `let cancelled = false`：那個旗標在 cleanup 裡才會改，
    // TypeScript 的控制流分析看不到，`if (cancelled)` 會被判成恆偽。
    const ac = new AbortController();

    void (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        if (ac.signal.aborted) return;
        await renderAsync(data, node, undefined, {
          className: "docx",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: true,
          breakPages: true,
          experimental: true,
        });
      } catch {
        // 解析失敗最常見的原因是檔案損毀或根本不是 OOXML。
        // 不要往上丟 —— 這是一個預覽視窗，不該讓整個桌面白掉。
        if (!ac.signal.aborted) setError("這個檔案沒辦法解析，可能已經損毀。");
      }
    })();

    return () => {
      ac.abort();
      // renderAsync 可能在 unmount 之後才寫進這個節點；不清掉的話，
      // 切到下一個檔案會看到上一份文件的殘影。
      node.replaceChildren();
    };
  }, [data]);

  if (error) {
    return <p className="text-sm text-gray-500">{error}</p>;
  }

  return (
    <div
      ref={hostRef}
      data-testid="docx-view"
      className="w-full h-full overflow-auto bg-neutral-200 dark:bg-neutral-800 rounded-lg [&_.docx-wrapper]:bg-transparent [&_.docx-wrapper]:p-4 [&_section.docx]:shadow-lg [&_section.docx]:mx-auto"
    />
  );
};
