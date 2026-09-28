// apps/api/src/routes/skills.ts
import { Router } from "express";
import { SkillConflictError, type SkillRegistry } from "@agenter/skills";

export function createSkillsRouter(registry: SkillRegistry): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ skills: registry.list() });
  });

  router.get("/:id", (req, res) => {
    try {
      const skill = registry.get(req.params.id);
      if (!skill) { res.status(404).json({ error: "Навык не найден" }); return; }
      res.json(skill);
    } catch { res.status(400).json({ error: "Не удалось прочитать навык" }); }
  });
  router.put("/:id", (req, res) => {
    const { name, description, instructions, enabled } = req.body ?? {};
    if (![name, description, instructions].every((value) => typeof value === "string") || (enabled !== undefined && typeof enabled !== "boolean")) { res.status(400).json({ error: "Некорректные поля навыка" }); return; }
    try { res.json(registry.update({ id: req.params.id, name, description, instructions, enabled })); }
    catch { res.status(400).json({ error: "Не удалось обновить навык: проверьте ID и размер полей" }); }
  });
  router.delete("/:id", (req, res) => {
    try { registry.remove(req.params.id); res.sendStatus(204); }
    catch { res.status(400).json({ error: "Не удалось удалить навык" }); }
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
