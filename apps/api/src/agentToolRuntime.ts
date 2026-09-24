import type { AgentToolRuntime } from "@agenter/agent-core";
import type { ToolRegistryContract } from "@agenter/tools";

export function createAgentToolRuntime(registry: ToolRegistryContract): AgentToolRuntime {
  return {
    listTools: () => registry.list()
      .filter(({ safety }) => safety === "safe")
      .map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    execute: (name, args) => registry.execute(name, args),
  };
}
