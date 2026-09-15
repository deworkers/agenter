// apps/api/src/routes/providers.ts
import { Router } from "express";
import type { LlmProvider } from "@agenter/agent-core";

export function createProvidersRouter(provider: LlmProvider): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json([{ id: provider.id, model: provider.model }]);
  });

  return router;
}
