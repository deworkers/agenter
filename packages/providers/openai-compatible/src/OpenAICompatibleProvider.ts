import type { LlmEvent, LlmProvider, LlmRequest } from "@agenter/agent-core";

export interface OpenAICompatibleProviderConfig {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow?: number;
}

interface ChatCompletionChunk {
  choices: Array<{ delta: { content?: string }; finish_reason?: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

// Node's global Response (and modern HTTP/2 responses generally) often leave
// statusText empty since the reason phrase is optional/absent on the wire.
// Fall back to the standard reason phrase for common codes so error messages
// stay readable instead of degrading to e.g. "401 ".
const STATUS_TEXTS: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  408: "Request Timeout",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

function statusText(response: Response): string {
  return response.statusText || STATUS_TEXTS[response.status] || "";
}

export class OpenAICompatibleProvider implements LlmProvider {
  readonly id: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly contextWindow: number;

  constructor(config: OpenAICompatibleProviderConfig) {
    this.id = config.id;
    this.model = config.model;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.contextWindow = config.contextWindow ?? 8192;
  }

  supportsTools(): boolean {
    return false;
  }

  supportsVision(): boolean {
    return false;
  }

  getContextWindow(): number {
    return this.contextWindow;
  }

  async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: request.messages,
          stream: true,
        }),
      });
    } catch (error) {
      yield { type: "error", message: error instanceof Error ? error.message : String(error) };
      return;
    }

    if (!response.ok) {
      const reason = statusText(response);
      yield {
        type: "error",
        message: `Provider request failed: ${response.status}${reason ? ` ${reason}` : ""}`,
      };
      return;
    }

    if (!response.body) {
      yield { type: "error", message: "Provider response had no body" };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawFinish = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice("data: ".length).trim();
        if (payload === "[DONE]") continue;
        if (payload.length === 0) continue;

        const chunk = JSON.parse(payload) as ChatCompletionChunk;
        const delta = chunk.choices[0]?.delta.content;

        if (delta) {
          yield { type: "text.delta", text: delta };
        }

        if (chunk.choices[0]?.finish_reason) {
          sawFinish = true;
          yield {
            type: "done",
            usage: chunk.usage
              ? {
                  promptTokens: chunk.usage.prompt_tokens,
                  completionTokens: chunk.usage.completion_tokens,
                }
              : undefined,
          };
        }
      }
    }

    if (!sawFinish) {
      yield { type: "error", message: "Provider stream ended without a finish reason" };
    }
  }
}
