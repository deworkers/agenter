// apps/api/src/routes/skills.ts
import { Router } from "express";
import type { SkillRegistry } from "@agenter/skills";

export function createSkillsRouter(registry: SkillRegistry): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ skills: registry.list() });
  });

  return router;
}
