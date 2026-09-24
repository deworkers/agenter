import { readFileSync } from "node:fs";
import { parseTree, printParseErrorCode, type Node as JsonNode, type ParseError } from "jsonc-parser";
import type { McpServerConfig } from "@agenter/mcp";

const PLACEHOLDER = /^\$\{([A-Z0-9_]+)\}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateUniqueKeys(node: JsonNode): void {
  if (node.type === "object") {
    const keys = new Set<string>();
    for (const child of node.children ?? []) {
      const keyNode = child.children?.[0];
      if (keyNode?.type !== "string") continue;
      const key = keyNode.value as string;
      if (keys.has(key)) throw new Error("Invalid MCP configuration: duplicate object key");
      keys.add(key);
      for (const member of child.children ?? []) validateUniqueKeys(member);
    }
  } else {
    for (const child of node.children ?? []) validateUniqueKeys(child);
  }
}

function resolve(value: string, env: NodeJS.ProcessEnv, field: string): string {
  const match = PLACEHOLDER.exec(value);
  if (!match) return value;
  const name = match[1] as string;
  const result = env[name];
  if (result === undefined) {
    throw new Error(`Invalid MCP configuration: missing environment variable ${name} for ${field}`);
  }
  return result;
}

export function loadMcpConfigFromFile(
  filePath: string,
  env: NodeJS.ProcessEnv = process.env
): Record<string, McpServerConfig> {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    if (isObject(error) && error.code === "ENOENT") return {};
    throw new Error("Unable to read MCP configuration file", { cause: error });
  }

  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true });
  if (errors.length > 0 || !tree) {
    const reason = errors[0] ? printParseErrorCode(errors[0].error) : "empty document";
    throw new Error(`Invalid MCP configuration JSON: ${reason}`);
  }
  validateUniqueKeys(tree);

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Invalid MCP configuration JSON");
  }
  if (!isObject(raw) || !isObject(raw.mcpServers)) {
    throw new Error('Invalid MCP configuration: expected an object containing "mcpServers"');
  }

  const result: Record<string, McpServerConfig> = {};
  for (const [serverId, entry] of Object.entries(raw.mcpServers)) {
    if (!isObject(entry)) throw new Error(`Invalid MCP configuration: server "${serverId}" must be an object`);
    if (entry.transport === "sse") {
      if (typeof entry.url !== "string" || entry.command !== undefined || entry.args !== undefined || entry.env !== undefined) {
        throw new Error(`Invalid MCP configuration: server "${serverId}" requires only an SSE url`);
      }
      const resolvedUrl = resolve(entry.url, env, `url for server ${serverId}`);
      let url: URL;
      try {
        url = new URL(resolvedUrl);
      } catch {
        throw new Error(`Invalid MCP configuration: server "${serverId}" has an invalid SSE url`);
      }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new Error(`Invalid MCP configuration: server "${serverId}" must use an HTTP(S) SSE url without embedded credentials`);
      }
      Object.defineProperty(result, serverId, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: { transport: "sse", url: url.toString() },
      });
      continue;
    }
    if (entry.transport !== undefined && entry.transport !== "stdio") {
      throw new Error(`Invalid MCP configuration: server "${serverId}" has an unsupported transport`);
    }
    if (typeof entry.command !== "string" || entry.command.length === 0) {
      throw new Error(`Invalid MCP configuration: server "${serverId}" requires a string command`);
    }
    if (entry.args !== undefined && (!Array.isArray(entry.args) || !entry.args.every((arg) => typeof arg === "string"))) {
      throw new Error(`Invalid MCP configuration: server "${serverId}" args must be an array of strings`);
    }
    if (entry.env !== undefined && (!isObject(entry.env) || !Object.values(entry.env).every((value) => typeof value === "string"))) {
      throw new Error(`Invalid MCP configuration: server "${serverId}" env must contain string values`);
    }

    Object.defineProperty(result, serverId, {
      enumerable: true,
      configurable: true,
      writable: true,
      value: {
        ...(entry.transport === "stdio" ? { transport: "stdio" } : {}),
        command: entry.command,
        ...(entry.args === undefined ? {} : {
          args: entry.args.map((arg, index) => resolve(arg, env, `args[${index}] for server ${serverId}`)),
        }),
        ...(entry.env === undefined ? {} : {
          env: Object.fromEntries(Object.entries(entry.env).map(([key, value]) => [
            key,
            resolve(value as string, env, `env.${key} for server ${serverId}`),
          ])),
        }),
      },
    });
  }
  return result;
}
