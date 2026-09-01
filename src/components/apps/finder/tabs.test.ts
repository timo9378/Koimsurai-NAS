import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  addTab,
  closeTab,
  createTab,
  restoreTabs,
  serializeTabs,
  type TabsState,
  updateActiveTab,
} from "./tabs";

const stateOf = (...ids: string[]): TabsState => ({
  tabs: ids.map((id) => createTab(`/${id}`, id)),
  activeTabId: ids[0] ?? "",
});

describe("addTab", () => {
  it("加在最後並切過去", () => {
    const next = addTab(stateOf("a", "b"), "/docs", "c");
    expect(next.tabs.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(next.activeTabId).toBe("c");
    expect(next.tabs[2]?.path).toBe("/docs");
  });

  it("新分頁的歷史就是它自己那一頁", () => {
    const tab = addTab(stateOf("a"), "/docs", "c").tabs[1];
    expect(tab?.history).toEqual(["/docs"]);
    expect(tab?.historyIndex).toBe(0);
  });
});

describe("closeTab", () => {
  it("關掉非目前分頁不會換分頁", () => {
    const next = closeTab({ ...stateOf("a", "b", "c"), activeTabId: "b" }, "a");
    expect(next.tabs.map((t) => t.id)).toEqual(["b", "c"]);
    expect(next.activeTabId).toBe("b");
  });

  it("關掉目前分頁時換到右邊那個", () => {
    const next = closeTab({ ...stateOf("a", "b", "c"), activeTabId: "b" }, "b");
    expect(next.tabs.map((t) => t.id)).toEqual(["a", "c"]);
    expect(next.activeTabId).toBe("c");
  });

  it("關掉最後一個分頁時換到左邊那個", () => {
    const next = closeTab({ ...stateOf("a", "b"), activeTabId: "b" }, "b");
    expect(next.activeTabId).toBe("a");
  });

  it("關掉右邊的分頁時，目前這個要留在原位", () => {
    // ⚠️ 「關的是不是目前這個」那道判斷少了的話，關別人也會換分頁
    const next = closeTab({ ...stateOf("a", "b", "c"), activeTabId: "a" }, "c");
    expect(next.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(next.activeTabId).toBe("a");
  });

  it("關掉第一個分頁時換到它右邊那個", () => {
    // ⚠️ 用 Math.max 而不是 Math.min 的話這裡會跳到最後一個
    const next = closeTab({ ...stateOf("a", "b", "c"), activeTabId: "a" }, "a");
    expect(next.activeTabId).toBe("b");
  });

  it("關掉最右邊的分頁時換到它左邊那個", () => {
    // ⚠️ 夾取的上界寫錯（例如 length + 1）的話這裡會取到 undefined
    const next = closeTab({ ...stateOf("a", "b", "c"), activeTabId: "c" }, "c");
    expect(next.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(next.activeTabId).toBe("b");
  });

  it("只剩一個分頁時關不掉", () => {
    // ⚠️ 沒有分頁的 Finder 沒有東西可以顯示，而 activeTabId 會變成 ""
    const state = stateOf("a");
    expect(closeTab(state, "a")).toBe(state);
  });

  it("關一個不存在的分頁不會動到狀態", () => {
    const state = stateOf("a", "b");
    expect(closeTab(state, "nope")).toBe(state);
  });

  it("性質：關完之後 activeTabId 一定指向存在的分頁", () => {
    // ⚠️ 這是整個模組的重點。指不到的話 updateActiveTab 一個都對不到，
    // 所有操作靜默失效。
    fc.assert(
      fc.property(
        fc
          .array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 6 })
          .map((xs) => [...new Set(xs)]),
        fc.nat(),
        fc.nat(),
        (ids, activeIdx, closeIdx) => {
          const state: TabsState = {
            tabs: ids.map((id) => createTab(`/${id}`, id)),
            activeTabId: ids[activeIdx % ids.length] ?? "",
          };
          const next = closeTab(state, ids[closeIdx % ids.length] ?? "");
          expect(next.tabs.length).toBeGreaterThan(0);
          expect(next.tabs.some((t) => t.id === next.activeTabId)).toBe(true);
        },
      ),
    );
  });
});

describe("updateActiveTab", () => {
  it("只動到目前那一個", () => {
    const next = updateActiveTab({ ...stateOf("a", "b"), activeTabId: "b" }, { path: "/x" });
    expect(next.tabs[0]?.path).toBe("/a");
    expect(next.tabs[1]?.path).toBe("/x");
  });
});

describe("restoreTabs", () => {
  const valid = serializeTabs(stateOf("a", "b"));

  it("正常的資料還原得回來", () => {
    const restored = restoreTabs(valid);
    expect(restored?.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(restored?.activeTabId).toBe("a");
    // Set 不能序列化 —— 還原時一定是空的
    expect(restored?.tabs[0]?.selectedFiles.size).toBe(0);
  });

  it("activeTabId 指到不存在的分頁就整個拒絕", () => {
    // ⚠️ 這是本模組存在的主要理由。不拒絕的話 Finder 會開起來但對操作
    // 完全沒反應，而且沒有任何錯誤 —— Terminal 已經被同一個形狀咬過一次。
    expect(restoreTabs({ ...valid, activeTabId: "gone" })).toBeNull();
    expect(restoreTabs({ ...valid, activeTabId: "" })).toBeNull();
  });

  it("壞掉的資料一律回 null 而不是丟例外", () => {
    for (const bad of [
      null,
      undefined,
      42,
      "字串",
      {},
      { tabs: [], activeTabId: "a" },
      { tabs: [{ id: "a" }], activeTabId: "a" }, // 少了 path
      { tabs: [{ id: "", path: "/" }], activeTabId: "" },
      { tabs: valid.tabs, activeTabId: 123 },
      { tabs: "不是陣列", activeTabId: "a" },
      // ⚠️ 不可迭代的值：少了 Array.isArray 那道，`for...of 42` 會直接
      // 丟 TypeError —— 這個函式的契約是「壞資料回 null」，不是「丟例外」。
      { tabs: 42, activeTabId: "a" },
      { tabs: null, activeTabId: "a" },
      // ⚠️ null 進到 reviveTab 的話，`typeof null === "object"` ——
      // 少了 `candidate === null` 那一半就會走到 `t.id`，直接 TypeError。
      { tabs: [null], activeTabId: "a" },
      { tabs: [undefined], activeTabId: "a" },
      { tabs: ["字串"], activeTabId: "a" },
      { tabs: [42], activeTabId: "a" },
    ]) {
      expect(restoreTabs(bad)).toBeNull();
    }
  });

  it("id 是空字串的分頁要被拒絕", () => {
    // ⚠️ 空 id 配上空的 activeTabId 會「看起來合法」（some 比對得到），
    // 但那個分頁在 UI 上永遠對不到 —— 跟 activeTabId 指到不存在的分頁
    // 是同一種靜默失效。
    expect(restoreTabs({ tabs: [{ id: "", path: "/" }], activeTabId: "" })).toBeNull();
    expect(restoreTabs({ tabs: [{ id: 42, path: "/" }], activeTabId: "42" })).toBeNull();
  });

  it("historyIndex 越界會被夾回範圍內", () => {
    // ⚠️ 越界的話 history[index] 是 undefined，網址變成 "/files/undefined"
    const raw = {
      tabs: [
        {
          id: "a",
          path: "/",
          history: ["/", "/a"],
          historyIndex: 99,
          isTrashMode: false,
          selectedTag: null,
          searchQuery: "",
        },
      ],
      activeTabId: "a",
    };
    expect(restoreTabs(raw)?.tabs[0]?.historyIndex).toBe(1);

    const negative = { ...raw, tabs: [{ ...raw.tabs[0], historyIndex: -5 }] };
    expect(restoreTabs(negative)?.tabs[0]?.historyIndex).toBe(0);
  });

  it("history 壞掉時退回只有目前這一頁", () => {
    const raw = {
      tabs: [
        {
          id: "a",
          path: "/docs",
          history: [1, 2],
          historyIndex: 0,
          isTrashMode: false,
          selectedTag: null,
          searchQuery: "",
        },
      ],
      activeTabId: "a",
    };
    expect(restoreTabs(raw)?.tabs[0]?.history).toEqual(["/docs"]);
  });

  it("性質：還原出來的狀態一定自洽", () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 })
          .map((xs) => [...new Set(xs)]),
        (ids) => {
          const state: TabsState = {
            tabs: ids.map((id) => createTab(`/${id}`, id)),
            activeTabId: ids[0] ?? "",
          };
          const restored = restoreTabs(serializeTabs(state));
          expect(restored).not.toBeNull();
          const r = restored!;
          expect(r.tabs.some((t) => t.id === r.activeTabId)).toBe(true);
          for (const tab of r.tabs) {
            expect(tab.historyIndex).toBeGreaterThanOrEqual(0);
            expect(tab.historyIndex).toBeLessThan(tab.history.length);
          }
        },
      ),
    );
  });
});

describe("reviveTab 的逐欄位防護", () => {
  const base = {
    id: "a",
    path: "/docs",
    history: ["/", "/docs"],
    historyIndex: 1,
    isTrashMode: false,
    selectedTag: null,
    searchQuery: "",
  };
  const revive = (patch: Record<string, unknown>) =>
    restoreTabs({ tabs: [{ ...base, ...patch }], activeTabId: "a" })?.tabs[0];

  it("空的 history 會補成目前這一頁，而且 index 不會變成 -1", () => {
    // ⚠️ 這是變異測試抓到的**真 bug**：先前用原始的 history 算 index、
    // 回傳時才補成 [path]，於是 `history: []` 算出 index = -1 而 history
    // 長度是 1 —— 越界的 index 就這樣逃出去，history[index] 是 undefined。
    const tab = revive({ history: [], historyIndex: 0 });
    expect(tab?.history).toEqual(["/docs"]);
    expect(tab?.historyIndex).toBe(0);
  });

  it("history 裡有非字串就整條退回目前這一頁", () => {
    expect(revive({ history: ["/", 42] })?.history).toEqual(["/docs"]);
  });

  it("historyIndex 不是數字就當 0", () => {
    expect(revive({ historyIndex: "1" })?.historyIndex).toBe(0);
    expect(revive({ historyIndex: undefined })?.historyIndex).toBe(0);
  });

  it("historyIndex 是小數會被截斷", () => {
    expect(revive({ historyIndex: 1.9 })?.historyIndex).toBe(1);
  });

  it("isTrashMode 只認真正的 true", () => {
    // 舊版格式可能存成字串或數字 —— 那些不該被當成「在垃圾桶模式」
    expect(revive({ isTrashMode: true })?.isTrashMode).toBe(true);
    expect(revive({ isTrashMode: "true" })?.isTrashMode).toBe(false);
    expect(revive({ isTrashMode: 1 })?.isTrashMode).toBe(false);
    expect(revive({ isTrashMode: undefined })?.isTrashMode).toBe(false);
  });

  it("selectedTag 不是字串就當沒有標籤", () => {
    expect(revive({ selectedTag: "重要" })?.selectedTag).toBe("重要");
    expect(revive({ selectedTag: 42 })?.selectedTag).toBeNull();
    expect(revive({ selectedTag: undefined })?.selectedTag).toBeNull();
  });

  it("searchQuery 不是字串就當空字串", () => {
    expect(revive({ searchQuery: "報告" })?.searchQuery).toBe("報告");
    expect(revive({ searchQuery: 42 })?.searchQuery).toBe("");
    expect(revive({ searchQuery: undefined })?.searchQuery).toBe("");
  });

  it("還原出來的選取一定是空的", () => {
    // Set 不能序列化，硬塞一個陣列進去也不該變成選取
    expect(revive({ selectedFiles: ["a.txt"] })?.selectedFiles.size).toBe(0);
  });
});

describe("預設參數", () => {
  it("createTab 不給路徑時是根目錄", () => {
    const tab = createTab();
    expect(tab.path).toBe("/");
    expect(tab.history).toEqual(["/"]);
    expect(tab.isTrashMode).toBe(false);
    expect(tab.searchQuery).toBe("");
    expect(tab.selectedTag).toBeNull();
    expect(tab.selectedFiles.size).toBe(0);
    expect(tab.id).not.toBe("");
  });

  it("addTab 不給路徑時開在根目錄", () => {
    const next = addTab(stateOf("a"));
    expect(next.tabs[1]?.path).toBe("/");
  });

  it("createTab 每次的 id 都不同", () => {
    expect(createTab().id).not.toBe(createTab().id);
  });
});
