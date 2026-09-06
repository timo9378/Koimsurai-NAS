import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface Cell {
  id: string;
  text: string;
}

interface Row {
  id: string;
  cells: Cell[];
}

interface Sheet {
  name: string;
  rows: Row[];
}

/**
 * .xlsx → 表格。
 *
 * 只讀值，不重現樣式（字型、邊框、合併儲存格）—— 這是「快速看一眼內容」用的，
 * 不是編輯器。要正確的版面就下載。
 *
 * ⚠️ 這個元件由呼叫端用 `key={path}` 掛載，所以「換一個檔案」＝重新掛載。
 * 因此 effect 裡不需要（也不應該）同步重設 state。
 */
export const XlsxView = ({ data }: { data: ArrayBuffer }) => {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // ⚠️ 不要用 `let cancelled = false` —— 那個旗標是在 cleanup 裡改的，
    // TypeScript 的控制流分析看不到，`if (cancelled)` 會被判成恆偽。
    const ac = new AbortController();

    void (async () => {
      try {
        const ExcelJS = await import("exceljs");
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(data);
        if (ac.signal.aborted) return;

        setSheets(
          workbook.worksheets.map((ws) => {
            // ⚠️ 型別是 `(Row | undefined)[]` 而不是 `Row[]`：這個陣列是用
            // rowNumber 當索引寫進去的，**是稀疏的**。宣告成 `Row[]` 會讓
            // 下面的 `?? …` 看起來多餘（lint 也會這樣說），但 `Array.from`
            // 走過洞的時候真的會拿到 undefined。
            const rows: (Row | undefined)[] = [];
            // ⚠️ `eachRow` 預設會**跳過**空列，而 `rowNumber` 是 1-based。
            // 直接 push 的話，中間空一列的試算表整份會往上錯位一列。
            // `includeEmpty` + 用 rowNumber 當索引才對得起來。
            ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
              const cells: (Cell | undefined)[] = [];
              row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                cells[colNumber - 1] = {
                  id: `${rowNumber}:${colNumber}`,
                  text: cellText(cell.value),
                };
              });
              rows[rowNumber - 1] = {
                id: `r${rowNumber}`,
                cells: Array.from(cells, (c, i) => c ?? { id: `${rowNumber}:${i + 1}`, text: "" }),
              };
            });
            return {
              name: ws.name,
              rows: Array.from(rows, (r, i) => r ?? { id: `r${i + 1}`, cells: [] }),
            };
          }),
        );
      } catch {
        if (!ac.signal.aborted) setError("這個檔案沒辦法解析，可能已經損毀。");
      }
    })();

    return () => ac.abort();
  }, [data]);

  if (error) return <p className="text-sm text-gray-500">{error}</p>;
  if (!sheets) return <Loader2 className="w-8 h-8 animate-spin text-blue-500" />;
  if (sheets.length === 0) return <p className="text-sm text-gray-500">這個活頁簿沒有工作表。</p>;

  const sheet = sheets[active] ?? sheets[0];
  if (!sheet) return null;

  return (
    <div data-testid="xlsx-view" className="w-full h-full flex flex-col gap-2 min-h-0">
      <div className="flex-1 overflow-auto rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900">
        <table className="text-xs border-collapse">
          <tbody>
            {sheet.rows.map((row) => (
              <tr key={row.id} className="even:bg-black/[0.02] dark:even:bg-white/[0.02]">
                {row.cells.map((cell) => (
                  <td
                    key={cell.id}
                    className="border border-black/5 dark:border-white/5 px-2 py-1 whitespace-pre max-w-[24rem] truncate align-top"
                  >
                    {cell.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sheets.length > 1 && (
        <div className="flex gap-1 shrink-0 overflow-x-auto" role="tablist" aria-label="工作表">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn(
                "px-3 py-1 text-xs rounded-md whitespace-nowrap cursor-pointer",
                i === active
                  ? "bg-blue-600 text-white"
                  : "bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * exceljs 的 `cell.value` 是一個大 union：字串、數字、日期、公式物件、
 * 超連結物件、rich text 陣列……。直接 `String(value)` 會把後三種
 * 變成 `[object Object]`。
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleString();

  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    // 公式：顯示算出來的結果，不是公式本身。
    if ("result" in v) return cellText(v.result);
    if ("text" in v) return cellText(v.text);
    if ("hyperlink" in v) return cellText(v.hyperlink);
    if (Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map((part) => part.text ?? "").join("");
    }
    if ("error" in v) return cellText(v.error);
    return "";
  }

  // 這裡只剩原始型別。明確列舉，才不會有東西悄悄變成 "[object Object]"。
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }
  return "";
}
