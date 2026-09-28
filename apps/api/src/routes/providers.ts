// apps/api/src/routes/providers.ts
import { Router } from "express";
import type { ProviderRegistry } from "@agenter/agent-core";

export function createProvidersRouter(source: ProviderRegistry | (() => ProviderRegistry)): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const registry = typeof source === "function" ? source() : source;
    res.json({
      providers: registry.list().map((p) => ({ id: p.id, model: p.model, label: p.label, contextWindow: p.getContextWindow(), maxOutputTokens: p.getMaxOutputTokens?.() ?? 1024 })),
      defaultProviderId: registry.getDefaultId(),
    });
  });

  return router;
}
