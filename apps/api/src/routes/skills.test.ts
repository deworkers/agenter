import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillRegistry } from "@agenter/skills";
import { createSkillsRouter } from "./skills.js";

describe("skills route", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it("creates a skill, lists it, and rejects invalid or duplicate ids", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agenter-skills-route-"));
    directories.push(dir);
    const registry = new SkillRegistry(dir);
    const app = express();
    app.use(express.json());
    app.use("/api/skills", createSkillsRouter(registry));
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP address");
      const url = `http://127.0.0.1:${address.port}/api/skills`;
      const input = { id: "review", name: "Review", description: "Review code", instructions: "Check the code" };
      const create = (body: object) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

      expect((await create({ ...input, id: "../escape" })).status).toBe(400);
      const created = await create(input);
      expect(created.status).toBe(201);
      expect(await created.json()).toEqual({ id: "review", name: "Review", description: "Review code" });
      expect((await create(input)).status).toBe(409);
      expect(await (await fetch(url)).json()).toEqual({ skills: [{ id: "review", name: "Review", description: "Review code" }] });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
