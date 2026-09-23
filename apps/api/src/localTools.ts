import { ToolRegistry } from "@agenter/tools";
import type { Tool } from "@agenter/tools";

export function buildLocalToolRegistry(enabledTools: readonly Tool[] = []): ToolRegistry {
  const registry = new ToolRegistry();

  for (const tool of enabledTools) {
    if (tool.source?.kind !== "local") {
      throw new Error(`Tool "${tool.name}" is not a local tool.`);
    }

    registry.register(tool);
  }

  return registry;
}
