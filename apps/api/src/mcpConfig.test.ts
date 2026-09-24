import { unlinkSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { loadMcpConfigFromFile } from "./mcpConfig.js";

const filePath = "./.tmp-test-mcp.json";

afterEach(() => {
  try {
    unlinkSync(filePath);
  } catch {
    // ignore
  }
});

describe("loadMcpConfigFromFile", () => {
  it("returns an empty map when the file does not exist", () => {
    expect(loadMcpConfigFromFile("./.missing-test-mcp.json", {})).toEqual({});
  });

  it("accepts an empty server map", () => {
    writeFileSync(filePath, '{"mcpServers":{}}');
    expect(loadMcpConfigFromFile(filePath, {})).toEqual({});
  });

  it("preserves __proto__ as an own enumerable server id without changing the result prototype", () => {
    writeFileSync(filePath, '{"mcpServers":{"__proto__":{"command":"cmd"}}}');

    const config = loadMcpConfigFromFile(filePath, {});

    expect(Object.keys(config)).toContain("__proto__");
    expect(Object.prototype.propertyIsEnumerable.call(config, "__proto__")).toBe(true);
    expect(config["__proto__"]).toEqual({ command: "cmd" });
    expect(Object.getPrototypeOf(config)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(config)).not.toHaveProperty("command");
  });

  it("loads valid entries and expands only whole-value args/env placeholders", () => {
    writeFileSync(filePath, JSON.stringify({
      mcpServers: {
        server: {
          command: "${COMMAND_IS_LITERAL}",
          args: ["${ARG_VALUE}", "prefix-${ARG_VALUE}"],
          env: { TOKEN: "${TOKEN_VALUE}", STATIC: "literal" },
        },
      },
    }));
    expect(loadMcpConfigFromFile(filePath, {
      COMMAND_IS_LITERAL: "not-used", ARG_VALUE: "arg-value", TOKEN_VALUE: "secret-value",
    })).toEqual({
      server: {
        command: "${COMMAND_IS_LITERAL}",
        args: ["arg-value", "prefix-${ARG_VALUE}"],
        env: { TOKEN: "secret-value", STATIC: "literal" },
      },
    });
  });

  it("loads an SSE server URL while retaining legacy stdio configuration", () => {
    writeFileSync(filePath, JSON.stringify({ mcpServers: {
      remote: { transport: "sse", url: "${MCP_SSE_URL}" },
      local: { command: "local-server", args: ["--stdio"] },
    } }));

    expect(loadMcpConfigFromFile(filePath, { MCP_SSE_URL: "http://127.0.0.1:8001/servers/ddg-search/sse" })).toEqual({
      remote: { transport: "sse", url: "http://127.0.0.1:8001/servers/ddg-search/sse" },
      local: { command: "local-server", args: ["--stdio"] },
    });
  });

  it("accepts an explicit stdio transport", () => {
    writeFileSync(filePath, '{"mcpServers":{"local":{"transport":"stdio","command":"server"}}}');
    expect(loadMcpConfigFromFile(filePath, {})).toEqual({ local: { transport: "stdio", command: "server" } });
  });

  it.each([
    { transport: "sse" },
    { transport: "sse", url: "not-a-url" },
    { transport: "sse", url: "file:///tmp/server" },
    { transport: "sse", url: "http://user:secret@localhost/sse" },
    { transport: "unknown", url: "http://localhost/sse" },
  ])("rejects invalid SSE configuration without echoing its URL", (entry) => {
    writeFileSync(filePath, JSON.stringify({ mcpServers: { remote: entry } }));
    let message = "";
    try {
      loadMcpConfigFromFile(filePath, {});
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/Invalid MCP configuration/);
    expect(message).not.toContain("secret");
  });

  it.each([
    ["root", "[]"],
    ["mcpServers", '{"mcpServers":[]}'],
    ["server", '{"mcpServers":{"s":null}}'],
    ["command", '{"mcpServers":{"s":{"command":4}}}'],
    ["args", '{"mcpServers":{"s":{"command":"cmd","args":[4]}}}'],
    ["env", '{"mcpServers":{"s":{"command":"cmd","env":{"TOKEN":4}}}}'],
  ])("rejects invalid %s shape", (_label, json) => {
    writeFileSync(filePath, json);
    expect(() => loadMcpConfigFromFile(filePath, {})).toThrow(/Invalid MCP configuration/);
  });

  it.each([
    '{"mcpServers":{},"mcpServers":{}}',
    '{"mcpServers":{"s":{"command":"a","command":"b"}}}',
  ])("rejects duplicate object keys", (json) => {
    writeFileSync(filePath, json);
    expect(() => loadMcpConfigFromFile(filePath, {})).toThrow(/duplicate/i);
  });

  it("rejects missing variables without including values in errors", () => {
    const secret = "must-not-leak-secret";
    writeFileSync(filePath, '{"mcpServers":{"s":{"command":"cmd","env":{"TOKEN":"${MISSING_TOKEN}"}}}}');
    let error: unknown;
    try {
      loadMcpConfigFromFile(filePath, { PRESENT: secret });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(secret);
    expect((error as Error).message).toContain("MISSING_TOKEN");
  });
});
