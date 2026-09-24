// apps/api/src/routes/skills.ts
import { Router } from "express";
import { SkillConflictError, type SkillRegistry } from "@agenter/skills";

export function createSkillsRouter(registry: SkillRegistry): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ skills: registry.list() });
  });

  router.post("/", (req, res) => {
    const { id, name, description, instructions } = req.body ?? {};
    if (![id, name, description, instructions].every((value) => typeof value === "string")) {
      res.status(400).json({ error: "id, name, description and instructions must be strings" });
      return;
    }
    try {
      res.status(201).json(registry.add({ id, name, description, instructions }));
    } catch (error) {
      if (error instanceof SkillConflictError) {
        res.status(409).json({ error: error.message });
      } else if (error instanceof RangeError) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Could not create skill" });
      }
    }
  });

  return router;
}
