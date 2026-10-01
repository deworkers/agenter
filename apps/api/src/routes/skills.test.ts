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
      expect(await (await fetch(`${url}/review`)).json()).toMatchObject({ instructions: "Check the code" });
      const edited = await fetch(`${url}/review`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, instructions: "Updated", enabled: false }) });
      expect(edited.status).toBe(200); expect(registry.getContent("review")).toBeUndefined();
      expect(await (await fetch(`${url}/review`)).json()).toMatchObject({ instructions: "Updated", enabled: false });
      expect((await fetch(`${url}/review`, { method: "DELETE" })).status).toBe(204);
      expect((await fetch(`${url}/review`)).status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("persists MCP links through create and edit, rejecting invalid input", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agenter-skills-route-"));
    directories.push(dir);
    const registry = new SkillRegistry(dir);
    const app = express(); app.use(express.json()); app.use("/api/skills", createSkillsRouter(registry));
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address(); if (!address || typeof address === "string") throw new Error("Expected TCP address");
      const url = `http://127.0.0.1:${address.port}/api/skills`;
      const input = { id: "video", name: "Video", description: "Summarize", instructions: "Use transcript", mcpServers: ["youtube-transcript"] };
      const post = (body: object) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect((await post({ ...input, mcpServers: ["../bad"] })).status).toBe(400);
      expect((await post(input)).status).toBe(201);
      expect((await (await fetch(url)).json()).skills[0].mcpServers).toEqual(["youtube-transcript"]);
      const edited = await fetch(`${url}/video`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, mcpServers: ["context7"] }) });
      expect(edited.status).toBe(200);
      expect((await (await fetch(`${url}/video`)).json()).mcpServers).toEqual(["context7"]);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });
});
