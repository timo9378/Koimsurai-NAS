import { getApiErrorStatus } from "@/lib/errors";

export const NEW_FOLDER_BASE = "新資料夾";

/**
 * 在既有名稱之外挑一個還沒被用掉的名字：`base`、`base1`、`base2`……
 *
 * 回傳的 `counter` 是**下一個**還沒試過的序號。撞到 409 時要從那裡接下去，
 * 不能從 1 重來 —— 否則會把剛剛已經確認過被佔用的名字再試一遍。
 */
export function pickAvailableName(
  base: string,
  taken: readonly string[],
): { name: string; counter: number } {
  const used = new Set(taken);
  let name = base;
  let counter = 1;

  while (used.has(name)) {
    name = `${base}${counter}`;
    counter++;
  }

  return { name, counter };
}

/**
 * 建立資料夾，撞名就換下一個名字再試，回傳實際建出來的名字。
 *
 * ⚠️ 為什麼光靠 `pickAvailableName` 不夠：那份清單是上一次抓回來的快照，
 * 而 watcher／WebDAV／另一個分頁都可能在這中間建出同名的目錄。所以 409 要
 * 當成「正常情況」處理而不是錯誤 —— 這也正是手機版原本缺的那一半，它只挑
 * 一次名字、撞到就跳「Failed to create folder」。
 *
 * 只有 409 會重試；其他錯誤（401、500、網路斷線）直接往外丟，不要在這裡
 * 用十次重試把一個真正的失敗磨成十倍延遲。
 */
export async function createFolderWithUniqueName(options: {
  existing: readonly string[];
  create: (name: string) => Promise<unknown>;
  base?: string;
  maxAttempts?: number;
}): Promise<string> {
  const { existing, create, base = NEW_FOLDER_BASE, maxAttempts = 10 } = options;
  let { name, counter } = pickAvailableName(base, existing);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await create(name);
      return name;
    } catch (error: unknown) {
      if (getApiErrorStatus(error) !== 409) throw error;
      name = `${base}${counter}`;
      counter++;
    }
  }

  throw new Error("無法創建資料夾,請稍後再試");
}
