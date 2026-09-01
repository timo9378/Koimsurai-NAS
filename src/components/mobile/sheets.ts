/**
 * 行動版三個彈出面板（動作／資訊／重新命名）的狀態。
 *
 * ⚠️ 原本是**三個各自獨立的 `useState<FileInfo | null>`**，而它們在 JSX 裡是
 * 平行渲染的兄弟節點：
 *
 * ```tsx
 * {actionFile && <ActionSheet …/>}
 * {infoFile   && <FileInfoSheet …/>}
 * {renameFile && <RenameDialog …/>}
 * ```
 *
 * 也就是說「同時只會開一個」完全靠呼叫順序維持，沒有任何東西**強制**它。
 * 任兩個同時非 null，畫面上就是兩層面板疊在一起，而底下那層還吃得到點擊。
 *
 * 換成判別式聯集之後，那個狀態**寫不出來** —— 這跟後端把 `storage_path`
 * 換成 `StorageRoot` 是同一個手法：把「我們會小心」變成「你寫不出來」。
 */

/** 面板要作用的檔案。只用得到名字與是不是目錄，所以不綁 `FileInfo` 全形狀。 */
export interface SheetTarget {
  readonly name: string;
  readonly is_dir: boolean;
}

export type SheetState<T extends SheetTarget = SheetTarget> =
  | { readonly kind: "none" }
  | { readonly kind: "action"; readonly file: T }
  | { readonly kind: "info"; readonly file: T }
  | { readonly kind: "rename"; readonly file: T };

/**
 * ⚠️ 型別參數要保留。`SheetState<SheetTarget>` **不能**指派給
 * `SheetState<FileInfo>` —— 聯集裡的 `file` 欄位讓整個型別對 `T` 是不變的
 * （invariant），即使 `none` 這個變體根本沒用到 `T`。
 * 所以 `NO_SHEET` 與 `closeSheet` 都要能配合呼叫端的 `T`。
 */
export const NO_SHEET: SheetState<never> = { kind: "none" };

export function openAction<T extends SheetTarget>(file: T): SheetState<T> {
  return { kind: "action", file };
}

/**
 * 從動作面板轉到資訊／重新命名面板。
 *
 * ⚠️ 這是**取代**而不是疊加 —— 動作面板選了「資訊」之後它自己要關掉。
 * 原本靠 `ActionSheet` 在呼叫 `onAction` 之後緊接著呼叫 `onClose`，
 * 也就是靠兩個 setState 的順序；現在是一次轉換。
 */
export function openInfo<T extends SheetTarget>(file: T): SheetState<T> {
  return { kind: "info", file };
}

export function openRename<T extends SheetTarget>(file: T): SheetState<T> {
  return { kind: "rename", file };
}

export function closeSheet<T extends SheetTarget>(): SheetState<T> {
  return { kind: "none" };
}

/** 目前這種面板是不是開著的，是的話回它的目標檔案。 */
export function sheetFile<T extends SheetTarget>(
  state: SheetState<T>,
  kind: "action" | "info" | "rename",
): T | null {
  return state.kind === kind ? state.file : null;
}
