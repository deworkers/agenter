export type TaskType = "simple" | "coding" | "reasoning" | "research" | "vision";

export const ALL_TASK_TYPES: readonly TaskType[] = ["simple", "coding", "reasoning", "research", "vision"];

export interface RoutingContext {
  hasImageAttachment?: boolean;
  activeSkill?: string;
  toolsRequired?: boolean;
}

export type RoutingConfig = Record<TaskType, { provider: string }>;

export class ProviderRouter {
  constructor(private readonly config: RoutingConfig) {}

  classify(context: RoutingContext): TaskType {
    if (context.hasImageAttachment === true) return "vision";
    if (context.activeSkill) return "coding";
    if (context.toolsRequired === true) return "reasoning";
    return "simple";
  }

  resolveProviderId(context: RoutingContext): string {
    const taskType = this.classify(context);
    return this.config[taskType].provider;
  }
}
