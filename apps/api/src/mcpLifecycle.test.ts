import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import type { McpManager } from "@agenter/mcp";
import { describe, expect, it, vi } from "vitest";
import { registerMcpShutdownHandlers } from "./mcpLifecycle.js";

type CloseCallback = (error?: Error) => void;

function setup(close: (callback: CloseCallback) => void, stop: () => void | Promise<void>) {
  const signals = new EventEmitter();
  const server = { close: vi.fn(close) } as unknown as Pick<Server, "close">;
  const manager = { stop: vi.fn(stop) } as unknown as Pick<McpManager, "stop">;
  const shutdown = registerMcpShutdownHandlers(server, manager, signals);
  return { signals, server, manager, shutdown };
}

describe("registerMcpShutdownHandlers", () => {
  it("handles SIGINT and SIGTERM with one idempotent shutdown", async () => {
    const { signals, server, manager } = setup(vi.fn(), vi.fn());

    signals.emit("SIGINT");
    signals.emit("SIGTERM");
    await new Promise((resolve) => setImmediate(resolve));

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(manager.stop).toHaveBeenCalledTimes(1);
  });

  it.each(["close", "stop"] as const)("attempts both actions when %s fails", async (failingAction) => {
    const close = vi.fn((callback: CloseCallback) => callback(failingAction === "close" ? new Error("close failed") : undefined));
    const stop = vi.fn(() => failingAction === "stop" ? Promise.reject(new Error("stop failed")) : undefined);
    const { shutdown, server, manager } = setup(close, stop);

    await expect(shutdown()).rejects.toThrow();
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(manager.stop).toHaveBeenCalledTimes(1);
    await expect(shutdown()).rejects.toThrow();
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(manager.stop).toHaveBeenCalledTimes(1);
  });

  it("shares one operation for repeated direct calls", async () => {
    let resolveClose!: () => void;
    const close = vi.fn((callback: CloseCallback) => {
      resolveClose = () => callback();
    });
    const { shutdown, server, manager } = setup(close, vi.fn());

    const first = shutdown();
    const second = shutdown();
    expect(first).toBe(second);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(manager.stop).toHaveBeenCalledTimes(1);

    resolveClose();
    await Promise.all([first, second]);
  });
});
