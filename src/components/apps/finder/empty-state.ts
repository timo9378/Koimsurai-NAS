/**
 * 檔案清單是空的時候要說什麼。
 *
 * ⚠️ 原本什麼都不說 —— `VirtuosoGrid` 拿到空陣列就是一片空白，而「空資料夾」
 * 「搜尋沒有結果」「這個標籤沒有檔案」「垃圾桶是空的」四種情況長得一模一樣。
 * 這跟 Docker 面板那個問題是同一類：使用者分不出「沒東西」與「壞掉了」。
 *
 * 順序有意義：**搜尋與標籤在前**。正在篩選的時候，使用者想知道的是「篩不到」
 * 而不是「這個資料夾是空的」—— 後者在有篩選條件時根本不是事實。
 */
export interface EmptyStateInput {
  readonly isTrashMode: boolean;
  readonly query: string;
  readonly tag: string | null;
}

export function emptyMessage(input: EmptyStateInput): string {
  const { isTrashMode, query, tag } = input;

  if (query.trim()) return `找不到符合「${query.trim()}」的項目`;
  if (tag) return `沒有標記為「${tag}」的檔案`;
  if (isTrashMode) return "垃圾桶是空的";
  return "這個資料夾是空的";
}
