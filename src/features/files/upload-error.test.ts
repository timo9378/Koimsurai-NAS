import { DetailedError } from "tus-js-client";
import { describe, expect, it } from "vitest";

import { uploadErrorMessage, uploadErrorStatus } from "./upload-error";

/**
 * tus 的 `DetailedError` 建構子。
 *
 * ⚠️ 這個轉型不是偷懶。`tus-js-client` 的 `.d.ts` 只寫了
 * `class DetailedError extends Error`，**沒有宣告自己的建構子**，
 * 所以 TypeScript 看到的是 `Error` 的 0-2 個參數 —— 而執行期它收 4 個
 * （見 lib.es5/error.js）。型別宣告與實作對不上，這裡照實作走。
 */
const NewDetailedError = DetailedError as unknown as new (
  message: string,
  causingError: Error | null,
  request: unknown,
  response: unknown,
) => DetailedError;

/**
 * 造一個帶指定狀態碼的 tus `DetailedError`。`null` 代表「連回應都沒有」。
 *
 * ⚠️ request 的 stub 不能用 `{}`。建構子會拿它去拼訊息
 * （`getHeader('X-Request-ID')` / `getMethod()` / `getURL()`），
 * 少一個方法就是 `TypeError`。
 *
 * 這裡刻意用**真的** `DetailedError` 而不是自己捏一個長得像的物件 ——
 * 受測程式用的是 `instanceof`，假物件會讓整條測試靜靜地測不到東西。
 */
function tusError(status: number | null): DetailedError {
  const request = {
    getHeader: () => undefined,
    getMethod: () => "POST",
    getURL: () => "/api/tus",
  };
  const response =
    status === null
      ? null
      : {
          getStatus: () => status,
          getBody: () => "",
        };
  return new NewDetailedError(
    "tus: unexpected response while creating upload",
    null,
    request,
    response,
  );
}

describe("uploadErrorStatus", () => {
  it("從 tus 錯誤裡取得狀態碼", () => {
    expect(uploadErrorStatus(tusError(502))).toBe(502);
    expect(uploadErrorStatus(tusError(413))).toBe(413);
  });

  it("沒有回應時是 undefined", () => {
    expect(uploadErrorStatus(tusError(null))).toBeUndefined();
  });

  it("不是 tus 錯誤時是 undefined", () => {
    expect(uploadErrorStatus(new Error("boom"))).toBeUndefined();
    expect(uploadErrorStatus("boom")).toBeUndefined();
    expect(uploadErrorStatus(undefined)).toBeUndefined();
  });
});

describe("uploadErrorMessage", () => {
  // 這是這支模組存在的理由：使用者看到的不可以是函式庫的內部字串。
  it("502 講的是伺服器暫時無法回應，不是 tus 的內部訊息", () => {
    const msg = uploadErrorMessage(tusError(502));
    expect(msg).not.toContain("tus:");
    expect(msg).not.toContain("originated from request");
    expect(msg).toContain("502");
  });

  it("503 和 504 跟 502 是同一句", () => {
    const base = uploadErrorMessage(tusError(502));
    expect(uploadErrorMessage(tusError(503))).toBe(base);
    expect(uploadErrorMessage(tusError(504))).toBe(base);
  });

  it("認證過期跟伺服器故障是不同的兩句話", () => {
    expect(uploadErrorMessage(tusError(401))).toContain("登入");
    expect(uploadErrorMessage(tusError(403))).toContain("登入");
    expect(uploadErrorMessage(tusError(401))).not.toBe(uploadErrorMessage(tusError(502)));
  });

  it("檔案太大與請求太頻繁各有各的說法", () => {
    expect(uploadErrorMessage(tusError(413))).toContain("大小");
    expect(uploadErrorMessage(tusError(429))).toContain("頻繁");
  });

  it("沒列到的 5xx 仍然說得出狀態碼", () => {
    expect(uploadErrorMessage(tusError(500))).toContain("500");
    expect(uploadErrorMessage(tusError(507))).toContain("507");
  });

  it("沒列到的 4xx 是「被拒絕」而不是「伺服器錯誤」", () => {
    expect(uploadErrorMessage(tusError(400))).toContain("拒絕");
    expect(uploadErrorMessage(tusError(400))).not.toContain("伺服器發生錯誤");
  });

  it("斷線時要說得出「已傳的部分不會重來」—— 這決定使用者敢不敢按重試", () => {
    const msg = uploadErrorMessage(tusError(null));
    expect(msg).toContain("續傳");
    expect(msg).not.toContain("HTTP");
  });

  it("完全不認得的錯誤也不會炸，而且不洩漏內部訊息", () => {
    const msg = uploadErrorMessage(new Error("tus: internal gibberish"));
    expect(msg).not.toContain("gibberish");
  });
});
