import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 這支盯的是一個實際存在過的資源洩漏。
 *
 * 卸載時的 cleanup 原本寫成：
 *
 *     useEffect(() => () => tabs.forEach((t) => { t.ws?.close(); t.terminal?.dispose(); }), [])
 *
 * deps 是 `[]`，所以那個閉包抓到的是**掛載當下**的 tabs——那時每個分頁的
 * `ws` / `terminal` 都還是 null。結果：關掉 Terminal 視窗，WebSocket 一條
 * 都沒關、xterm 實例也沒 dispose，全部留著。
 *
 * 而把 tabs 寫進 deps 也不行：那會變成每次 tabs 一變就跑一次 cleanup，
 * 等於一開新分頁就把舊分頁的連線關掉。正解是用 ref 讓 cleanup 讀得到最新值。
 * 下面兩條測試剛好分別對應這兩種錯法。
 */

// ── xterm 在 jsdom 裡跑不起來（會摸 canvas），整包換掉 ──
const fakeTerminals = vi.hoisted(() => [] as FakeXTerm[]);

class FakeXTerm {
  cols = 80;
  rows = 24;
  loadAddon = vi.fn();
  open = vi.fn();
  write = vi.fn();
  writeln = vi.fn();
  onData = vi.fn();
  focus = vi.fn();
  clear = vi.fn();
  getSelection = vi.fn(() => "");
  dispose = vi.fn();
  constructor() {
    fakeTerminals.push(this);
  }
}

vi.mock("@xterm/xterm", () => ({ Terminal: FakeXTerm }));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

const sockets = vi.hoisted(() => [] as FakeWebSocket[]);

class FakeWebSocket {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = FakeWebSocket.OPEN;
  send = vi.fn();
  close = vi.fn();
  constructor(public url: string) {
    sockets.push(this);
  }
}

// import 要在 mock 之後
const { Terminal } = await import("./Terminal");

beforeEach(() => {
  fakeTerminals.length = 0;
  sockets.length = 0;
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 等到第一個分頁把 terminal 與 socket 都建好（初始化排在 100ms 的 timer 後）。 */
async function mountReady() {
  const view = render(<Terminal windowId="w1" />);
  await waitFor(() => expect(sockets).toHaveLength(1), { timeout: 2000 });
  return view;
}

describe("Terminal", () => {
  it("掛載後就有一個分頁，不需要先 render 一次空清單", () => {
    render(<Terminal windowId="w1" />);
    expect(screen.getByText("Terminal 1")).toBeInTheDocument();
  });

  it("卸載時關掉 WebSocket 並 dispose xterm", async () => {
    const { unmount } = await mountReady();
    const [socket] = sockets;
    const [term] = fakeTerminals;

    unmount();

    // ⚠️ 這兩行就是那個 bug：修好之前兩者都不會被呼叫，因為 cleanup 閉包
    //    看到的是掛載當下 ws / terminal 都還是 null 的 tabs。
    expect(socket?.close).toHaveBeenCalled();
    expect(term?.dispose).toHaveBeenCalled();
  });

  it("開新分頁**不會**把舊分頁的連線關掉", async () => {
    const user = userEvent.setup();
    await mountReady();
    const [first] = sockets;

    await user.click(screen.getByTitle("New Tab"));
    await waitFor(() => expect(screen.getByText("Terminal 2")).toBeInTheDocument());

    // ⚠️ 這條擋的是「把 tabs 寫進 cleanup 的 deps」那種修法：那樣每次
    //    tabs 一變就會跑一次 cleanup，一開新分頁舊連線就被關掉。
    expect(first?.close).not.toHaveBeenCalled();
  });

  it("卸載時把每一個分頁的連線都關掉，不只第一個", async () => {
    const user = userEvent.setup();
    const { unmount } = await mountReady();

    await user.click(screen.getByTitle("New Tab"));
    await waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(2));

    unmount();
    for (const s of sockets) expect(s.close).toHaveBeenCalled();
  });
});
