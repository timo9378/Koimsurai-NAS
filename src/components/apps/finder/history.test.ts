import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  canGoBack,
  canGoForward,
  currentPath,
  goBack,
  goForward,
  initialHistory,
  pushPath,
  type NavHistory,
} from "./history";

/**
 * 邊界是重點：`history[index - 1]` 在 index 為 0 時是 undefined，
 * 而 `setCurrentPath(undefined)` 會讓整個 Finder 的路徑變成 undefined，
 * 接著 useFiles 用它組出 `/files/undefined` 打過去。開了
 * noUncheckedIndexedAccess 之後才浮出來。
 */

/** 方便寫斷言：把 NavHistory 攤成 "a,b,[c],d" 這種形式。 */
const show = (h: NavHistory) => h.entries.map((e, i) => (i === h.index ? `[${e}]` : e)).join(",");

describe("pushPath", () => {
  it("接在目前位置後面", () => {
    const h = pushPath(initialHistory("/"), "/docs");
    expect(show(h)).toBe("/,[/docs]");
  });

  it("從歷史中間導覽會截掉可以前進的那一段（跟瀏覽器一樣）", () => {
    let h = initialHistory("/");
    h = pushPath(h, "/a");
    h = pushPath(h, "/b");
    h = goBack(h); // 停在 /a，前面還有 /b
    h = pushPath(h, "/c");
    expect(show(h)).toBe("/,/a,[/c]");
    expect(canGoForward(h)).toBe(false);
  });

  it("允許重複路徑 —— 使用者確實可能來回走同一個資料夾", () => {
    let h = initialHistory("/");
    h = pushPath(h, "/a");
    h = pushPath(h, "/");
    expect(show(h)).toBe("/,/a,[/]");
  });
});

describe("goBack / goForward 的邊界", () => {
  it("在最舊的一筆上按上一頁是 no-op，回傳同一個物件", () => {
    const h = initialHistory("/");
    expect(canGoBack(h)).toBe(false);
    // ⚠️ 修好之前這裡會走到 `history[-1]`（undefined），把 currentPath 設成
    //    undefined，接著 useFiles 會去打 /files/undefined。
    expect(goBack(h)).toBe(h);
    expect(currentPath(goBack(h))).toBe("/");
  });

  it("在最新的一筆上按下一頁是 no-op，回傳同一個物件", () => {
    const h = pushPath(initialHistory("/"), "/a");
    expect(canGoForward(h)).toBe(false);
    expect(goForward(h)).toBe(h);
    expect(currentPath(goForward(h))).toBe("/a");
  });

  it("來回走都停在對的位置", () => {
    let h = initialHistory("/");
    h = pushPath(h, "/a");
    h = pushPath(h, "/b");
    expect(show(h)).toBe("/,/a,[/b]");

    h = goBack(h);
    expect(show(h)).toBe("/,[/a],/b");
    h = goBack(h);
    expect(show(h)).toBe("[/],/a,/b");

    h = goForward(h);
    h = goForward(h);
    expect(show(h)).toBe("/,/a,[/b]");
  });

  it("連按超過邊界不會累積偏移", () => {
    let h = initialHistory("/");
    h = pushPath(h, "/a");
    h = goBack(h);
    h = goBack(h);
    h = goBack(h); // 多按兩次
    expect(h.index).toBe(0);

    h = goForward(h);
    expect(show(h)).toBe("/,[/a]");
  });
});

describe("currentPath", () => {
  it("空歷史回 undefined 而不是丟例外", () => {
    expect(currentPath({ entries: [], index: 0 })).toBeUndefined();
  });

  it("index 越界回 undefined", () => {
    expect(currentPath({ entries: ["/"], index: 5 })).toBeUndefined();
  });
});

describe("性質（fast-check）", () => {
  /** 依一串操作建出歷史。 */
  type Op = { kind: "push"; path: string } | { kind: "back" } | { kind: "forward" };
  const opArb = fc.oneof(
    fc.string({ minLength: 1, maxLength: 4 }).map((path): Op => ({ kind: "push", path })),
    fc.constant<Op>({ kind: "back" }),
    fc.constant<Op>({ kind: "forward" }),
  );
  const apply = (ops: Op[]) =>
    ops.reduce(
      (h, op) =>
        op.kind === "push" ? pushPath(h, op.path) : op.kind === "back" ? goBack(h) : goForward(h),
      initialHistory("/"),
    );

  it("index 永遠落在 entries 的範圍內", () => {
    // ⚠️ 這是整支模組的核心不變式。破了就是 `history[index]` 為 undefined，
    //    而 currentPath 變 undefined 之後 useFiles 會去打 /files/undefined。
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        const h = apply(ops);
        expect(h.index).toBeGreaterThanOrEqual(0);
        expect(h.index).toBeLessThan(h.entries.length);
        expect(currentPath(h)).toBeDefined();
      }),
    );
  });

  it("能上一頁時，上一頁再下一頁回到原位", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        const h = apply(ops);
        if (!canGoBack(h)) return;
        expect(goForward(goBack(h)).index).toBe(h.index);
      }),
    );
  });

  it("到邊界時回傳的是同一個物件（呼叫端用 === 判斷有沒有動）", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        const h = apply(ops);
        if (!canGoBack(h)) expect(goBack(h)).toBe(h);
        if (!canGoForward(h)) expect(goForward(h)).toBe(h);
      }),
    );
  });

  it("pushPath 之後一定停在剛推入的那一筆", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 20 }), fc.string({ minLength: 1 }), (ops, path) => {
        const h = pushPath(apply(ops), path);
        expect(currentPath(h)).toBe(path);
        expect(canGoForward(h)).toBe(false); // 前進的那一段被截掉了
      }),
    );
  });
});

it("initialHistory 不給參數時從根目錄開始", () => {
  // Stryker: 預設值 "/" 完全沒被覆蓋到 —— 所有測試都明確傳了路徑。
  expect(initialHistory()).toEqual({ entries: ["/"], index: 0 });
});
