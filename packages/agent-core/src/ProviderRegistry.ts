import type { LlmProvider } from "./types.js";

export class ProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();

  constructor(private readonly defaultProviderId: string) {}

  register(provider: LlmProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): LlmProvider | undefined {
    return this.providers.get(id);
  }

  list(): LlmProvider[] {
    return [...this.providers.values()];
  }

  getDefaultId(): string {
    return this.defaultProviderId;
  }

  getDefault(): LlmProvider {
    const provider = this.providers.get(this.defaultProviderId);
    if (!provider) {
      throw new Error(`Default provider "${this.defaultProviderId}" is not registered`);
    }
    return provider;
  }
}
