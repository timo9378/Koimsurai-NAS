import { describe, expect, it } from "vitest";
import { auditActionInfo, TONE_CLASS, type AuditTone } from "./audit-actions";

/** 後端 `state.audit.log(...)` 目前會寫出來的所有動作。 */
const BACKEND_ACTIONS = [
  "create_folder",
  "delete_file",
  "rename_file",
  "restore_version",
  "batch_delete",
  "batch_move",
  "batch_copy",
  "restore_from_trash",
  "permanent_delete",
  "empty_trash",
] as const;

describe("auditActionInfo", () => {
  it("後端會產生的每一個動作都有對應的顯示名稱", () => {
    // ⚠️ 這份表原本有三個後端不會產生的動作，卻缺了後端真正會寫的
    // restore_version。這條就是把「兩邊對得上」釘住。
    for (const action of BACKEND_ACTIONS) {
      expect(auditActionInfo(action).label, action).not.toBe(action.replace(/_/g, " "));
    }
  });

  it("破壞性的操作要標成 destructive", () => {
    for (const action of ["delete_file", "batch_delete", "permanent_delete", "empty_trash"]) {
      expect(auditActionInfo(action).tone, action).toBe("destructive");
    }
  });

  it("認不得的動作退回原字串而不是壞掉", () => {
    // 後端新增一種動作時不該讓通知中心變成一片「未知」。
    expect(auditActionInfo("generate_waveform")).toEqual({
      label: "generate waveform",
      tone: "neutral",
    });
  });

  it("每個 tone 都有對應的樣式", () => {
    const tones: AuditTone[] = ["neutral", "create", "destructive", "warning"];
    for (const tone of tones) {
      expect(TONE_CLASS[tone]).toBeTruthy();
    }
    for (const action of BACKEND_ACTIONS) {
      expect(TONE_CLASS[auditActionInfo(action).tone], action).toBeTruthy();
    }
  });
});
