import { describe, expect, it } from "vitest";
import { ALL_TASK_TYPES, ProviderRouter } from "./ProviderRouter.js";
import type { RoutingConfig } from "./ProviderRouter.js";

const config: RoutingConfig = {
  simple: { provider: "local-fast" },
  coding: { provider: "local-code" },
  reasoning: { provider: "local-fast" },
  research: { provider: "local-fast" },
  vision: { provider: "local-fast" },
};

describe("ProviderRouter.classify", () => {
  it("classifies as vision when an image is attached", () => {
    const router = new ProviderRouter(config);
    expect(router.classify({ hasImageAttachment: true })).toBe("vision");
  });

  it("classifies as coding when a skill is active", () => {
    const router = new ProviderRouter(config);
    expect(router.classify({ activeSkill: "code-review" })).toBe("coding");
  });

  it("classifies as reasoning when tools are required", () => {
    const router = new ProviderRouter(config);
    expect(router.classify({ toolsRequired: true })).toBe("reasoning");
  });

  it("classifies as simple when no signal is present", () => {
    const router = new ProviderRouter(config);
    expect(router.classify({})).toBe("simple");
  });

  it("classifies as simple when context fields are explicitly false/undefined", () => {
    const router = new ProviderRouter(config);
    expect(
      router.classify({ hasImageAttachment: false, activeSkill: undefined, toolsRequired: false })
    ).toBe("simple");
  });

  it("checks image before skill before tools, in that priority order", () => {
    const router = new ProviderRouter(config);
    expect(
      router.classify({ hasImageAttachment: true, activeSkill: "code-review", toolsRequired: true })
    ).toBe("vision");
    expect(router.classify({ activeSkill: "code-review", toolsRequired: true })).toBe("coding");
  });
});

describe("ALL_TASK_TYPES", () => {
  it("lists every TaskType exactly once, for config validation elsewhere", () => {
    expect(ALL_TASK_TYPES).toEqual(["simple", "coding", "reasoning", "research", "vision"]);
  });
});

describe("ProviderRouter.resolveProviderId", () => {
  it("resolves the configured provider id for the classified task type", () => {
    const router = new ProviderRouter(config);
    expect(router.resolveProviderId({ activeSkill: "code-review" })).toBe("local-code");
    expect(router.resolveProviderId({})).toBe("local-fast");
  });

  it("resolves distinct providers per task type when configured differently", () => {
    const distinctConfig: RoutingConfig = {
      simple: { provider: "local-fast" },
      coding: { provider: "local-code" },
      reasoning: { provider: "local-reasoning" },
      research: { provider: "local-research" },
      vision: { provider: "local-vision" },
    };
    const router = new ProviderRouter(distinctConfig);
    expect(router.resolveProviderId({ toolsRequired: true })).toBe("local-reasoning");
    expect(router.resolveProviderId({ hasImageAttachment: true })).toBe("local-vision");
  });
});
