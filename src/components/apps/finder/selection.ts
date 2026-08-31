/**
 * Finder 的檔案選取（一般點擊 / Ctrl+Click / Shift+Click）。
 *
 * 抽成純函式的理由跟 `history.ts` 一樣：這段邏輯的正確性全在邊界上
 * （錨點在哪、要不要保留既有選取、要不要更新錨點），而那些在元件裡
 * 混著 ref 與 setState 看不出來，也測不到。
 */

export interface SelectionState {
  /** 目前選取的檔名。 */
  readonly selected: ReadonlySet<string>;
  /**
   * Shift 範圍選取的**錨點**（上一次「非 Shift」點擊的位置）。
   * -1 代表還沒有錨點。
   */
  readonly anchorIndex: number;
}

export interface ClickModifiers {
  readonly shift: boolean;
  /** Ctrl（Windows/Linux）或 Cmd（macOS）。 */
  readonly toggle: boolean;
}

export const emptySelection: SelectionState = { selected: new Set(), anchorIndex: -1 };

/**
 * 算出點擊之後的選取狀態。
 *
 * `clickedIndex` 為 -1（在清單裡找不到那個檔案）時一律當成一般點擊 ——
 * 拿 -1 去做範圍運算會得到一段包含負索引的區間。
 */
export function selectOnClick(
  state: SelectionState,
  fileNames: readonly string[],
  clickedIndex: number,
  mods: ClickModifiers,
): SelectionState {
  const clicked = fileNames[clickedIndex];
  if (clicked === undefined) {
    return state;
  }

  // Shift+Click → 從錨點到這裡的範圍
  if (mods.shift && state.anchorIndex >= 0) {
    const start = Math.min(state.anchorIndex, clickedIndex);
    const end = Math.max(state.anchorIndex, clickedIndex);
    const selected = new Set(state.selected); // 保留既有選取（配合 Ctrl+Shift）
    for (let i = start; i <= end; i++) {
      const name = fileNames[i];
      if (name !== undefined) selected.add(name);
    }
    // ⚠️ 錨點**不更新** —— 連續 Shift+Click 要能從同一個起點延伸範圍。
    // 更新的話第二次 Shift+Click 會從上一次的終點重新算，行為就跟
    // 所有檔案管理器都不一樣了。
    return { selected, anchorIndex: state.anchorIndex };
  }

  // Ctrl/Cmd+Click → 切換單一檔案，其餘不動
  if (mods.toggle) {
    const selected = new Set(state.selected);
    if (selected.has(clicked)) {
      selected.delete(clicked);
    } else {
      selected.add(clicked);
    }
    return { selected, anchorIndex: clickedIndex };
  }

  // 一般點擊 → 只選這一個
  return { selected: new Set([clicked]), anchorIndex: clickedIndex };
}
