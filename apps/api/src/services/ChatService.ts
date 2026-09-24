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
}

export class ChatService {
  constructor(
    private readonly storage: ChatStorage,
    private readonly runtime: AgentRuntime,
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
    const { skillId, mcpServerIds = [], ...rest } = options;
    const selectedServers = new Set(mcpServerIds);
    const allowedToolNames = (this.tools?.list() ?? [])
      .filter((tool) => tool.safety === "safe" &&
        (tool.source?.kind !== "mcp" || (tool.source.serverId !== undefined && selectedServers.has(tool.source.serverId))))
      .map(({ name }) => name);
    const runtimeOptions = { ...rest, allowedToolNames };

    if (!skillId) {
      yield* this.runtime.runTurn(chatId, content, runtimeOptions);
      return;
    }

    const activeSkillContent = this.skills.getContent(skillId);
    if (activeSkillContent === undefined) {
      throw new Error(`Unknown skill "${skillId}"`);
    }

    yield* this.runtime.runTurn(chatId, content, {
      ...runtimeOptions,
      activeSkillId: skillId,
      activeSkillContent,
      routingContext: { ...rest.routingContext, activeSkill: skillId },
    });
  }
}
