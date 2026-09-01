import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  closeSheet,
  NO_SHEET,
  openAction,
  openInfo,
  openRename,
  type SheetState,
  sheetFile,
} from "./sheets";

const file = (name: string, is_dir = false) => ({ name, is_dir });

describe("sheets", () => {
  it("一開始什麼都沒開", () => {
    expect(NO_SHEET).toEqual({ kind: "none" });
    expect(sheetFile(NO_SHEET, "action")).toBeNull();
  });

  it("開啟之後只有那一種問得到檔案", () => {
    // ⚠️ 這正是換成判別式聯集要保證的事：三個面板不可能同時開著。
    const state = openAction(file("報告.txt"));
    expect(sheetFile(state, "action")?.name).toBe("報告.txt");
    expect(sheetFile(state, "info")).toBeNull();
    expect(sheetFile(state, "rename")).toBeNull();
  });

  it("從動作面板轉到資訊面板是取代不是疊加", () => {
    // 原本靠 ActionSheet 呼叫 onAction 之後緊接著 onClose ——
    // 也就是靠兩個 setState 的順序。現在是一次轉換。
    const after = openInfo(file("a.txt"));
    expect(sheetFile(after, "action")).toBeNull();
    expect(sheetFile(after, "info")?.name).toBe("a.txt");
  });

  it("開啟重新命名面板", () => {
    // ⚠️ 這條是變異測試逼出來的。原本只有 property test 碰到 openRename，
    // 而那裡寫了 `states[i] ?? NO_SHEET` —— openRename 壞掉回 undefined 時
    // 那個 fallback 會把它悄悄換成 NO_SHEET，斷言照樣過。
    // **測試裡的 fallback 會蓋住被測程式的破壞。**
    const state = openRename(file("資料夾", true));
    expect(state).toEqual({ kind: "rename", file: { name: "資料夾", is_dir: true } });
    expect(sheetFile(state, "rename")?.name).toBe("資料夾");
    expect(sheetFile(state, "action")).toBeNull();
    expect(sheetFile(state, "info")).toBeNull();
  });

  it("關閉之後三種都問不到", () => {
    const closed = closeSheet();
    for (const kind of ["action", "info", "rename"] as const) {
      expect(sheetFile(closed, kind)).toBeNull();
    }
  });

  it("性質：任何狀態下最多只有一種面板是開著的", () => {
    const kinds = ["action", "info", "rename"] as const;
    const states: SheetState[] = [
      NO_SHEET,
      openAction(file("a")),
      openInfo(file("b")),
      openRename(file("c", true)),
      closeSheet(),
    ];
    fc.assert(
      fc.property(fc.nat({ max: states.length - 1 }), (i) => {
        // ⚠️ 這裡刻意**不寫** `?? NO_SHEET`：那個 fallback 會把
        // 「建構函式回了 undefined」偽裝成「沒有開任何面板」。
        const state = states[i];
        expect(state).toBeDefined();
        const open = kinds.filter((k) => sheetFile(state!, k) !== null);
        expect(open.length).toBeLessThanOrEqual(1);
        // 而且「有開」與 kind 必須一致
        expect(open.length === 1 ? open[0] : "none").toBe(state!.kind);
      }),
    );
  });
});
