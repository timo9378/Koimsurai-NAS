import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SocketProvider } from "./socket-provider";

/**
 * WebSocket 訊息的處理。
 *
 * ⚠️ 這裡曾經有一個看不見的 bug：後端一度同時存在兩種 envelope 格式，
 *    前端只認其中一種，於是背景工作完成的通知**從來沒有到達過**——而且是
 *    靜默的（訊息進來、parse 成功、switch 沒有命中、沒有任何錯誤）。
 *    現在後端統一成 `{ type, payload }`，這支就是把那個約定釘住。
 */

/** 記下建立出來的假 socket，讓測試可以往裡面推訊息。 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readyState = FakeWebSocket.OPEN;
  close = vi.fn();

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  /** 模擬伺服器送一則訊息過來。 */
  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

let queryClient: QueryClient;

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount() {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SocketProvider>
        <div />
      </SocketProvider>
    </QueryClientProvider>,
  );
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error("SocketProvider 應該要建立一條 WebSocket");
  return { ...view, socket };
}

describe("SocketProvider", () => {
  it("連到 /api/ws（dev 由 vite 代理、prod 由 Rust 自己接）", () => {
    const { socket } = mount();
    expect(socket.url).toMatch(/\/api\/ws$/);
  });

  it("job_update 讓 `tasks` 失效 —— 那才是背景工作面板用的 key", async () => {
    // ⚠️ 這裡原本失效的是 `["jobs"]`，而 `useTasks` 用的是 `["tasks"]`。
    // 兩邊對不上，於是 WebSocket 推進來的更新從來沒有讓面板重整過。
    const { socket } = mount();
    queryClient.setQueryData(["tasks"], []);

    socket.emit({ type: "job_update", payload: { job_id: "job-1", status: "completed" } });

    await waitFor(() => {
      expect(queryClient.getQueryState(["tasks"])?.isInvalidated).toBe(true);
    });
  });

  it("工作**完成**不跳 toast —— 每上傳一個檔案就有好幾個工作完成", async () => {
    // index_file 與 generate_thumbnail 是每個檔案各跑一次。原本每個完成都跳
    // 一個 toast，上傳 50 張照片就是 50 個「工作完成：<uuid>」。
    const { socket } = mount();

    socket.emit({ type: "job_update", payload: { job_id: "ok", status: "completed" } });
    socket.emit({ type: "job_update", payload: { job_id: "ok2", status: "completed" } });

    await waitFor(() => {
      expect(queryClient.getQueryState(["tasks"])?.isInvalidated ?? true).toBe(true);
    });
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("工作失敗會跳 toast，而且顯示的是工作類型不是 UUID", async () => {
    const { socket } = mount();
    queryClient.setQueryData(
      ["tasks"],
      [{ id: "bad", job_type: "copy_files", status: "failed", progress: 0 }],
    );

    socket.emit({
      type: "job_update",
      payload: { job_id: "bad", status: "failed", error: "磁碟滿了" },
    });

    await waitFor(() => {
      expect(toasts.error).toHaveBeenCalledWith(
        "複製檔案失敗",
        expect.objectContaining({ description: "磁碟滿了" }),
      );
    });
  });

  it("快取裡查不到類型時退回一句通用的，不會印出 UUID", async () => {
    const { socket } = mount();

    socket.emit({ type: "job_update", payload: { job_id: "unknown-uuid", status: "failed" } });

    await waitFor(() => {
      expect(toasts.error).toHaveBeenCalledWith("背景工作失敗", expect.anything());
    });
  });

  it("docker_stats 依 container_id 分開存", async () => {
    const { socket } = mount();
    socket.emit({ type: "docker_stats", payload: { container_id: "c1", cpu_percent: 12 } });

    await waitFor(() => {
      expect(queryClient.getQueryData(["docker", "stats", "c1"])).toMatchObject({
        cpu_percent: 12,
      });
    });
  });

  it("壞掉的 JSON 不會讓整個 provider 掛掉", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { socket } = mount();

    expect(() => socket.onmessage?.({ data: "{ 不是 JSON" })).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });

  it("卸載時關掉連線 —— 否則每次路由切換都留一條", () => {
    const { socket, unmount } = mount();
    unmount();
    expect(socket.close).toHaveBeenCalled();
  });
});
