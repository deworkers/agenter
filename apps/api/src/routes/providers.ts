// apps/api/src/routes/providers.ts
import { Router } from "express";
import type { ProviderRegistry } from "@agenter/agent-core";

export function createProvidersRouter(registry: ProviderRegistry): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      providers: registry.list().map((p) => ({ id: p.id, model: p.model })),
      defaultProviderId: registry.getDefaultId(),
    });
  });

  return router;
}
