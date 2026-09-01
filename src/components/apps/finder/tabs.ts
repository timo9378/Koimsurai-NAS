/**
 * Finder 分頁的狀態轉換。
 *
 * 抽成純函式的理由跟 `finder/history.ts` 一樣：這裡每一個操作都是
 * 「一組分頁 + 目前是哪一個」→「新的一組 + 新的目前是哪一個」，
 * 而那兩個值必須**始終互相一致**。不一致的失敗方式很難查：
 *
 * ⚠️ `activeTabId` 指到一個不存在的分頁時，`updateActiveTab` 的
 * `tabs.map(t => t.id === activeTabId ? ... : t)` 會**一個都對不到**，
 * 於是所有的導覽、選取、搜尋都靜默失效 —— 使用者點資料夾沒反應，
 * 而且沒有任何錯誤。
 *
 * 這個 codebase 已經被同一個形狀咬過一次：Terminal 的 `activeTabId`
 * 初始值是 `""`，結果終端機從來沒連上過。
 */

export interface TabState {
  id: string;
  path: string;
  history: string[];
  historyIndex: number;
  isTrashMode: boolean;
  selectedTag: string | null;
  selectedFiles: Set<string>;
  searchQuery: string;
}

/** 存進 localStorage 的形狀 —— `Set` 不能序列化，所以少了 `selectedFiles`。 */
export type SerializedTab = Omit<TabState, "selectedFiles">;

export interface TabsState {
  readonly tabs: TabState[];
  readonly activeTabId: string;
}

// Stryker disable next-line BlockStatement: 清空函式本體時整個測試檔在
// **收集階段**就失敗（stateOf 建不出東西），而 Stryker 的 runner 把
// 「測試檔載入失敗」歸類成存活。實測確認過測試套件抓得到。
export function createTab(path = "/", id: string = crypto.randomUUID()): TabState {
  return {
    id,
    path,
    history: [path],
    historyIndex: 0,
    isTrashMode: false,
    selectedTag: null,
    selectedFiles: new Set(),
    searchQuery: "",
  };
}

/** 新分頁加在最後，並切過去。 */
export function addTab(state: TabsState, path = "/", id?: string): TabsState {
  const tab = createTab(path, id);
  return { tabs: [...state.tabs, tab], activeTabId: tab.id };
}

/**
 * 關掉一個分頁。
 *
 * ⚠️ 最後一個分頁關不掉 —— 沒有分頁的 Finder 沒有任何可以顯示的東西，
 * 而 `activeTabId` 會變成 `""`（見模組說明）。
 *
 * 關掉的是目前分頁時，接手的是**同一個位置**的分頁（也就是右邊那個），
 * 沒有右邊就取左邊。這是瀏覽器分頁的慣例。
 */
export function closeTab(state: TabsState, tabId: string): TabsState {
  if (state.tabs.length <= 1) return state;

  const index = state.tabs.findIndex((t) => t.id === tabId);
  if (index < 0) return state;

  const tabs = state.tabs.filter((t) => t.id !== tabId);
  if (tabId !== state.activeTabId) return { tabs, activeTabId: state.activeTabId };

  const next = tabs[Math.min(index, tabs.length - 1)];
  // Stryker disable next-line all: 後面那串 fallback 到不了。
  // 上面擋掉了 `length <= 1`，所以刪掉一個之後 tabs 至少還有一個；
  // index 又被夾在 [0, length-1]，所以 `next` 一定存在。
  // 留著 `?.` 與 `?? ""` 只是因為 noUncheckedIndexedAccess 讓
  // `tabs[i]` 的型別帶 undefined —— 用 `!` 斷言反而是把型別保證丟掉。
  // tabs 至少還有一個（上面擋掉了 length <= 1），所以 next 一定存在；
  // 保留 fallback 只是為了不讓型別上出現 undefined。
  return { tabs, activeTabId: next?.id ?? tabs[0]?.id ?? "" };
}

/** 套用一組欄位到目前的分頁。目前分頁不存在時原樣回傳（不是靜默丟掉）。 */
export function updateActiveTab(state: TabsState, updates: Partial<TabState>): TabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === state.activeTabId ? { ...tab, ...updates } : tab)),
  };
}

/**
 * 把 localStorage 讀回來的東西還原成可用的狀態，不合法就回 `null`。
 *
 * ⚠️ 一定要驗 `activeTabId` **確實指向存在的分頁**。localStorage 的內容
 * 使用者改得到、也可能是舊版格式留下的；指到不存在的分頁不會報錯，
 * 只會讓整個 Finder 對操作沒反應（見模組說明）。
 */
export function restoreTabs(raw: unknown): TabsState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const parsed = raw as Partial<{ tabs: unknown; activeTabId: unknown }>;

  // Stryker disable next-line ConditionalExpression: `length === 0` 那半是
  // 多層防護 —— 空陣列會讓下面的迴圈跑 0 次，最後的
  // `tabs.some(...)` 一樣回 null。留著是為了早退，不是為了改變結果。
  // （`!Array.isArray` 那半有測試守著：`{ tabs: 42 }` 少了它會丟 TypeError。）
  if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
  // Stryker disable next-line ConditionalExpression: 同樣是多層防護 ——
  // activeTabId 不是字串的話，下面的 `tabs.some(t => t.id === activeTabId)`
  // 不可能對到（tab.id 一定是字串），一樣回 null。
  if (typeof parsed.activeTabId !== "string") return null;

  const tabs: TabState[] = [];
  for (const candidate of parsed.tabs) {
    const tab = reviveTab(candidate);
    if (!tab) return null;
    tabs.push(tab);
  }

  // ⚠️ 這一行是整個函式的重點。
  if (!tabs.some((t) => t.id === parsed.activeTabId)) return null;

  return { tabs, activeTabId: parsed.activeTabId };
}

function reviveTab(candidate: unknown): TabState | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const t = candidate as Partial<SerializedTab>;
  // Stryker disable next-line ConditionalExpression: 這道被外層的
  // `tabs.some(t => t.id === parsed.activeTabId)` 遮住 —— id 壞掉的分頁
  // 對不到 activeTabId，整個還原一樣會被拒絕。留著是為了讓失敗發生在
  // 靠近原因的地方。
  if (typeof t.id !== "string" || t.id === "") return null;
  if (typeof t.path !== "string") return null;

  // history / historyIndex 必須互相一致 —— index 越界的話
  // `history[index]` 是 undefined，網址會變成 "/files/undefined"
  // （finder/history.ts 的 property test 守的就是這條）。
  //
  // ⚠️ 一定要**先**把 history 正規化成非空，再拿它算 index。
  // 先前寫成「用原始的 history 算 index、回傳時才補成 [t.path]」，於是
  // `history: []` 會算出 `historyIndex = min(0, -1) = -1`，而回傳的 history
  // 長度是 1 —— 越界的 index 就這樣逃出去，正是這支模組要防的東西。
  // （變異測試指出來的：`history.length > 0 ? ... : ...` 那個突變活著。）
  const candidates =
    Array.isArray(t.history) && t.history.every((h) => typeof h === "string") ? t.history : [];
  const history = candidates.length > 0 ? candidates : [t.path];

  const rawIndex = typeof t.historyIndex === "number" ? t.historyIndex : 0;
  const historyIndex = Math.min(Math.max(Math.trunc(rawIndex), 0), history.length - 1);

  return {
    id: t.id,
    path: t.path,
    history,
    historyIndex,
    isTrashMode: t.isTrashMode === true,
    selectedTag: typeof t.selectedTag === "string" ? t.selectedTag : null,
    // Set 不能序列化 —— 還原時一律是空的選取
    selectedFiles: new Set(),
    searchQuery: typeof t.searchQuery === "string" ? t.searchQuery : "",
  };
}

/** 要寫進 localStorage 的形狀（丟掉不能序列化的 `Set`）。 */
export function serializeTabs(state: TabsState): { tabs: SerializedTab[]; activeTabId: string } {
  return {
    tabs: state.tabs.map(({ selectedFiles: _drop, ...rest }) => rest),
    activeTabId: state.activeTabId,
  };
}
