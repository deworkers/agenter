import type { Tool, ToolRegistry as ToolRegistryInterface } from "./types.js";

export class ToolRegistry implements ToolRegistryInterface {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }

    this.tools.set(tool.name, tool);
  }

  list(): Tool[] {
    return [...this.tools.values()].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  async execute(name: string, args: unknown): Promise<unknown> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" is not registered.`);
    }

    if (tool.safety !== "safe") {
      throw new Error(`Tool "${name}" is not safe to execute.`);
    }

    try {
      return await tool.execute(args);
    } catch {
      throw new Error(`Tool "${name}" execution failed.`);
    }
  }
}
