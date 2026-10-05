import { describe, expect, it } from "vitest";
import { summarizeActiveMcp } from "./capabilitySummary.js";

describe("MCP capability summary", () => {
  it("counts only safe tools on selected servers that are ready", () => {
    const summary = summarizeActiveMcp(
      [{ id: "ready", status: "ready" }, { id: "offline", status: "error" }],
      [
        { name: "ready__safe", description: "", inputSchema: {}, safety: "safe", source: { kind: "mcp", serverId: "ready" } },
        { name: "ready__unknown", description: "", inputSchema: {}, source: { kind: "mcp", serverId: "ready" } },
        { name: "ready__blocked", description: "", inputSchema: {}, safety: "approval-required", source: { kind: "mcp", serverId: "ready" } },
        { name: "offline__safe", description: "", inputSchema: {}, safety: "safe", source: { kind: "mcp", serverId: "offline" } },
      ],
      ["ready", "offline", "missing"],
    );

    expect(summary).toEqual({ serverCount: 1, safeToolCount: 1 });
  });
});
