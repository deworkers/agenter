// apps/api/src/services/ChatService.ts
import type { AgentEvent, AgentRuntime, Chat, ChatStorage, RoutingContext, StoredMessage } from "@agenter/agent-core";
import type { SkillRegistry } from "@agenter/skills";
import type { ToolRegistry } from "@agenter/tools";

export interface ChatWithMessages {
  chat: Chat;
  messages: StoredMessage[];
}

export interface SendMessageOptions {
  providerId?: string;
  mode?: "manual" | "auto";
  routingContext?: RoutingContext;
  skillId?: string;
  mcpServerIds?: string[];
  signal?: AbortSignal;
  historyLimit?: number;
}

export interface RuntimeBinding { runtime: AgentRuntime; tools?: ToolRegistry; release(): void }

export class ChatService {
  constructor(
    private readonly storage: ChatStorage,
    private readonly runtime: AgentRuntime | (() => RuntimeBinding),
    private readonly skills: SkillRegistry,
    private readonly tools?: ToolRegistry
  ) {}

  listChats(): Chat[] {
    return this.storage.listChats();
  }

  createChat(title = "New chat"): Chat {
    return this.storage.createChat(title);
  }

  getChatWithMessages(id: string): ChatWithMessages | undefined {
    const chat = this.storage.getChat(id);
    if (!chat) return undefined;

    return { chat, messages: this.storage.listMessages(id) };
  }

  deleteChat(id: string): void {
    this.storage.deleteChat(id);
  }

  async *sendMessage(chatId: string, content: string, options: SendMessageOptions = {}): AsyncGenerator<AgentEvent> {
    const binding = this.acquire();
    try {
      yield* binding.runtime.runTurn(chatId, content, this.turnOptions(options, binding.tools));
    } finally { binding.release(); }
  }

  preview(chatId: string, content: string, options: SendMessageOptions = {}) {
    const binding = this.acquire();
    try { return binding.runtime.previewTurn(chatId, content, this.turnOptions(options, binding.tools)); }
    finally { binding.release(); }
  }

  async compact(chatId: string, options: SendMessageOptions = {}) {
    const binding = this.acquire();
    try { return await binding.runtime.compact(chatId, this.turnOptions(options, binding.tools)); }
    finally { binding.release(); }
  }

  private acquire(): RuntimeBinding {
    return typeof this.runtime === "function" ? this.runtime() : { runtime: this.runtime, tools: this.tools, release() {} };
  }

  private turnOptions(options: SendMessageOptions, tools?: ToolRegistry) {
    const { skillId, mcpServerIds = [], ...rest } = options;
    const selectedServers = new Set(mcpServerIds);
    const allowedToolNames = (tools?.list() ?? [])
      .filter((tool) => tool.safety === "safe" &&
        (tool.source?.kind !== "mcp" || (tool.source.serverId !== undefined && selectedServers.has(tool.source.serverId))))
      .map(({ name }) => name);
    const runtimeOptions = { ...rest, allowedToolNames };

    if (!skillId) {
      return runtimeOptions;
    }

    const activeSkillContent = this.skills.getContent(skillId);
    if (activeSkillContent === undefined) {
      throw new Error(`Unknown skill "${skillId}"`);
    }

    return {
      ...runtimeOptions,
      activeSkillId: skillId,
      activeSkillContent,
      routingContext: { ...rest.routingContext, activeSkill: skillId },
    };
  }
}
