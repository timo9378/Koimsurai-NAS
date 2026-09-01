/**
 * 「移到垃圾桶」之後，復原要用的那個名字。
 *
 * ⚠️ 復原與永久刪除的端點吃的是**垃圾桶裡的檔名**，不是原始路徑也不是原檔名。
 * `.trash` 是扁平的，撞名時後端會存成 `原名.<timestamp>` —— 用原檔名去復原，
 * 復原到的會是**上一次**刪的同名檔案。production 的垃圾桶裡現在就有三個
 * 帶時間戳的項目，這條路徑是真的會走到的。
 */
interface TrashedItem {
  /** 使用者看到的原檔名，只拿來組訊息。 */
  name: string;
  /** 垃圾桶裡的實際檔名，復原與永久刪除都用這個。 */
  trashName: string;
}

export interface TrashOutcome {
  trashed: TrashedItem[];
  /** 刪除失敗的原檔名。批次刪除可能只成功一部分。 */
  failed: string[];
}

/**
 * 把批次刪除的結果整理成「哪些成功了、復原時該送什麼名字」。
 *
 * 用 `allSettled` 的結果而不是 `all`，是因為一個檔案刪不掉不該讓其餘成功的
 * 那些也失去復原的機會 —— 那正是使用者最需要復原的時候。
 */
export function collectTrashed(
  names: readonly string[],
  results: readonly PromiseSettledResult<{ trash_name: string }>[],
): TrashOutcome {
  const trashed: TrashedItem[] = [];
  const failed: string[] = [];

  names.forEach((name, i) => {
    const result = results[i];
    if (result?.status === "fulfilled") {
      trashed.push({ name, trashName: result.value.trash_name });
    } else {
      failed.push(name);
    }
  });

  return { trashed, failed };
}
