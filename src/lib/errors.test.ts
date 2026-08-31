import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import { getApiErrorBody, getApiErrorMessage, getApiErrorStatus, isNetworkError } from "./errors";

/**
 * 這幾支存在的理由是取代散落各處的 `catch (e: any)` + 手刻的
 * `err && typeof err === "object" && "response" in err`。手刻版的問題是
 * `in` 只證明欄位存在、形狀完全沒驗，所以這裡特別測「長得像但不是 axios 錯誤」
 * 的東西不會被誤判。
 */

/** 造一個帶 response 的 axios 錯誤。 */
function httpError(status: number, data?: unknown, message = "Request failed") {
  const err = new AxiosError(message, "ERR_BAD_RESPONSE");
  err.response = {
    status,
    statusText: "",
    data,
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
  return err;
}

describe("getApiErrorStatus", () => {
  it("取得 HTTP 狀態碼", () => {
    expect(getApiErrorStatus(httpError(404))).toBe(404);
  });

  it("連不上（沒有 response）時回 undefined，而不是 0 之類的假值", () => {
    expect(
      getApiErrorStatus(new AxiosError("Network Error", AxiosError.ERR_NETWORK)),
    ).toBeUndefined();
  });

  it("不是 axios 錯誤就回 undefined", () => {
    // ⚠️ 這個物件「長得像」axios 錯誤（有 response.status），手刻的
    //    `"response" in err` 會把它當成 HTTP 錯誤處理。
    expect(getApiErrorStatus({ response: { status: 500 } })).toBeUndefined();
    expect(getApiErrorStatus(new Error("boom"))).toBeUndefined();
  });
});

describe("getApiErrorMessage", () => {
  it("優先用後端 AppError 的 error 欄位", () => {
    expect(getApiErrorMessage(httpError(400, { error: "檔名已存在" }))).toBe("檔名已存在");
  });

  it("沒有 error 就退到 message 欄位（部分端點用這個）", () => {
    expect(getApiErrorMessage(httpError(400, { message: "密碼錯誤" }))).toBe("密碼錯誤");
  });

  it("body 不是預期形狀時退回 axios 自己的訊息", () => {
    expect(
      getApiErrorMessage(httpError(500, "<html>500</html>", "Request failed with status code 500")),
    ).toBe("Request failed with status code 500");
  });

  it("axios 訊息是空字串才用 fallback", () => {
    expect(getApiErrorMessage(httpError(500, undefined, ""), "操作失敗")).toBe("操作失敗");
  });

  it("一般 Error 用它自己的 message", () => {
    expect(getApiErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("完全不認得的東西才用 fallback", () => {
    expect(getApiErrorMessage("字串", "預設")).toBe("預設");
    expect(getApiErrorMessage(null, "預設")).toBe("預設");
  });
});

describe("isNetworkError", () => {
  it("斷網算 network error —— 這種值得重試（見 useFileUpload 的續傳）", () => {
    expect(isNetworkError(new AxiosError("Network Error", AxiosError.ERR_NETWORK))).toBe(true);
  });

  it("伺服器有回應就不算，即使是 500 —— 重試通常只會再錯一次", () => {
    expect(isNetworkError(httpError(500))).toBe(false);
  });

  it("不是 axios 錯誤就不算", () => {
    expect(isNetworkError(new Error("boom"))).toBe(false);
  });
});

describe("getApiErrorBody", () => {
  it("取得 body，讓呼叫端讀 409 續傳資訊那類欄位", () => {
    expect(getApiErrorBody<{ upload_id: string }>(httpError(409, { upload_id: "abc" }))).toEqual({
      upload_id: "abc",
    });
  });

  it("不是 axios 錯誤回 undefined", () => {
    expect(getApiErrorBody(new Error("boom"))).toBeUndefined();
  });
});

// ── Stryker 指出來的缺口 ────────────────────────────────────────────
//
// 三個 `err.response?.data` 的 optional chaining 突變（改成 `.data`）全部存活，
// 代表**沒有任何測試餵過「沒有 response 的 axios 錯誤」** —— 而那正是斷網，
// 也正是這幾支函式最需要撐住的情況：少了 `?.` 就是 TypeError。
describe("斷網（沒有 response 的 axios 錯誤）", () => {
  const networkErr = new AxiosError("Network Error", AxiosError.ERR_NETWORK);

  it("getApiErrorStatus 回 undefined 而不是丟例外", () => {
    expect(getApiErrorStatus(networkErr)).toBeUndefined();
  });

  it("getApiErrorBody 回 undefined 而不是丟例外", () => {
    expect(getApiErrorBody(networkErr)).toBeUndefined();
  });

  it("getApiErrorMessage 退回 axios 自己的訊息", () => {
    expect(getApiErrorMessage(networkErr)).toBe("Network Error");
  });

  it("isNetworkError 認得它", () => {
    expect(isNetworkError(networkErr)).toBe(true);
  });

  // `code === ERR_NETWORK || !err.response` 的**第二個** disjunct：
  // 把 `||` 改成 `&&` 的突變只有這種輸入殺得掉。
  it("code 不是 ERR_NETWORK 但完全沒有 response 時也算斷網", () => {
    const timeout = new AxiosError("timeout of 0ms exceeded", AxiosError.ECONNABORTED);
    expect(timeout.response).toBeUndefined();
    expect(isNetworkError(timeout)).toBe(true);
  });

  it("伺服器有回應就不算斷網", () => {
    const http500 = new AxiosError(
      "Request failed with status code 500",
      "ERR_BAD_RESPONSE",
      undefined,
      undefined,
      {
        status: 500,
        statusText: "Internal Server Error",
        data: { error: "boom" },
        headers: {},
        config: { headers: {} } as never,
      },
    );
    expect(isNetworkError(http500)).toBe(false);
  });
});

it("getApiErrorMessage 的預設 fallback", () => {
  // 不是 Error 也不是 axios 錯誤 —— 例如 `throw "字串"`
  expect(getApiErrorMessage("不是 Error")).toBe("操作失敗");
  expect(getApiErrorMessage("不是 Error", "自訂")).toBe("自訂");
});

it("code 明說是 ERR_NETWORK 時就算帶著 response 也算斷網", () => {
  // `code === ERR_NETWORK || !err.response` 的**第一個** disjunct ——
  // 少了這種輸入，把第一段換成 false 的突變殺不掉。
  // 現實中 ERR_NETWORK 不會附 response，但這條判斷的意圖就是「code 說了算」。
  const weird = httpError(0, undefined, "Network Error");
  weird.code = AxiosError.ERR_NETWORK;
  expect(weird.response).toBeDefined();
  expect(isNetworkError(weird)).toBe(true);
});
