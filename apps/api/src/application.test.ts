import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { SqliteChatStorage } from "@agenter/storage";
import { OpenAICompatibleProvider } from "@agenter/provider-openai-compatible";
import type { LlmRequest } from "@agenter/agent-core";
import { createApplication } from "./application.js";

afterEach(() => vi.restoreAllMocks());
const settings = { version: 1, defaultProvider: "local", providers: { local: {
  type: "openai-compatible", baseUrl: "http://localhost:1234/v1", apiKey: "local", model: "test", contextWindow: 8192, maxOutputTokens: 1024,
} }, routes: Object.fromEntries(["simple", "coding", "reasoning", "research", "vision"].map(key => [key, { provider: "local" }])), mcpServers: {} };

async function fixture(secureCookies = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "agenter-app-"));
  const configDirectory = path.join(directory, "config"); mkdirSync(configDirectory);
  const skillsDirectory = path.join(directory, "skills"); mkdirSync(skillsDirectory);
  mkdirSync(path.join(skillsDirectory, "example"));
  writeFileSync(path.join(skillsDirectory, "example", "SKILL.md"), "---\nname: example\ndescription: Shared skill\n---\nShared instructions");
  writeFileSync(path.join(configDirectory, "agenter.example.json"), JSON.stringify(settings));
  const dbPath = path.join(directory, "legacy.db");
  const storage = new SqliteChatStorage(dbPath);
  const legacy = storage.createChat("Legacy");
  storage.addMessage({ chatId: legacy.id, role: "user", content: "Alice private history" });
  const savedLegacy = storage.getChat(legacy.id)!; storage.close();
  let application = await createApplication({ configDirectory, skillsDirectory, dbPath, secureCookies });
  let server: Server;
  let url = "";
  async function listen() {
    server = application.app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("TCP address required");
    url = `http://127.0.0.1:${address.port}`;
  }
  await listen();
  async function stop() { await new Promise<void>(resolve => server.close(() => resolve())); await application.close(); }
  return {
    legacy: savedLegacy,
    origin: () => url,
    request: (route: string, cookie = "", method = "GET", body?: unknown, origin?: string) => fetch(url + route, {
      method, headers: { cookie, ...(["POST", "PUT", "PATCH"].includes(method) ? { "content-type": "application/json" } : {}), ...(origin ? { origin } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    async restart() { await stop(); application = await createApplication({ configDirectory, skillsDirectory, dbPath, secureCookies }); await listen(); },
    async close() { await stop(); rmSync(directory, { recursive: true, force: true }); },
  };
}

function cookie(response: Response): string { return response.headers.get("set-cookie")!.split(";")[0]!; }

it("protects all APIs, keeps shared resources, and isolates history including SSE and context", async () => {
  const requests: LlmRequest[] = [];
  vi.spyOn(OpenAICompatibleProvider.prototype, "chat").mockImplementation(async function* (request) {
    requests.push(request);
    yield { type: "text.delta", text: request.messages.at(-1)?.content?.includes("Evaluate the proposed answer") ? '{"status":"done"}' : "Test answer" };
    yield { type: "done" };
  });
  const app = await fixture();
  try {
    for (const route of ["chats", "settings", "providers", "skills", "mcp", "context", "unknown"]) {
      expect((await app.request(`/api/${route}`)).status).toBe(401);
    }
    const registered = await app.request("/api/auth/register", "", "POST", { login: "alice", password: "long-test-password" }, app.origin());
    expect(registered.status).toBe(201);
    expect(registered.headers.get("set-cookie")).toMatch(/HttpOnly/);
    expect(registered.headers.get("set-cookie")).toMatch(/SameSite=Strict/);
    expect(registered.headers.get("cache-control")).toBe("no-store");
    const alice = cookie(registered);
    const bob = cookie(await app.request("/api/auth/register", "", "POST", { login: "bob", password: "other-test-password" }));
    expect((await app.request("/api/chats", alice)).status).toBe(200);
    expect(await (await app.request("/api/chats", alice)).json()).toEqual([app.legacy]);
    expect(await (await app.request("/api/chats", bob)).json()).toEqual([]);
    for (const route of ["settings", "providers", "skills", "mcp"]) {
      expect(await (await app.request(`/api/${route}`, alice)).json()).toEqual(await (await app.request(`/api/${route}`, bob)).json());
    }
    for (const [suffix, method, body] of [
      ["", "GET", undefined], ["", "PATCH", { title: "Stolen" }],
      ["/compact", "POST", {}], ["/messages", "POST", { content: "Steal history" }],
    ] as const) expect((await app.request(`/api/chats/${app.legacy.id}${suffix}`, bob, method, body)).status).toBe(404);
    const foreignPreview = await app.request("/api/context", bob, "POST", { chatId: app.legacy.id, content: "Preview" });
    expect(foreignPreview.status).toBe(404);
    await app.request(`/api/chats/${app.legacy.id}`, bob, "DELETE");
    expect((await app.request(`/api/chats/${app.legacy.id}`, alice)).status).toBe(200);
    expect(requests).toHaveLength(0);
    const own = await (await app.request("/api/chats", bob, "POST", { title: "Bob chat", userId: "alice" })).json() as { id: string };
    const stream = await app.request(`/api/chats/${own.id}/messages`, bob, "POST", { content: "Bob private prompt" });
    expect(await stream.text()).toContain('"type":"run.completed"');
    expect(requests.every(request => !JSON.stringify(request).includes("Alice private history"))).toBe(true);
    const saved = await (await app.request(`/api/chats/${own.id}`, bob)).json() as { messages: unknown[] };
    expect(saved.messages).toHaveLength(2);
    expect((await app.request(`/api/chats/${own.id}`, alice)).status).toBe(404);
    const updated = { ...settings, systemPrompt: "Shared prompt" };
    expect((await app.request("/api/settings", alice, "PUT", updated)).status).toBe(200);
    expect(JSON.stringify(await (await app.request("/api/settings", bob)).json())).toContain("Shared prompt");
    await app.restart();
    expect((await app.request(`/api/chats/${own.id}`, bob)).status).toBe(200);
    expect((await app.request(`/api/chats/${app.legacy.id}`, alice)).status).toBe(200);
    expect((await app.request("/api/auth/logout", bob, "POST", {})).status).toBe(204);
    expect((await app.request("/api/chats", bob)).status).toBe(401);
    expect((await app.request("/api/chats", alice)).status).toBe(200);
    expect((await app.request("/api/auth/login", "", "POST", { login: "bob", password: "bad-password" })).status).toBe(401);
    const login = await app.request("/api/auth/login", "", "POST", { login: "BOB", password: "other-test-password" });
    expect(login.status).toBe(200);
    expect((await app.request(`/api/chats/${own.id}`, cookie(login))).status).toBe(200);
    expect((await app.request(`/api/chats/${own.id}`, cookie(login), "DELETE")).status).toBe(204);
    expect((await app.request(`/api/chats/${own.id}`, cookie(login))).status).toBe(404);
  } finally { await app.close(); }
});

it("rejects cross-site mutations and malformed auth requests and limits attempts", async () => {
  const app = await fixture(true);
  try {
    expect((await app.request("/api/auth/register", "", "POST", { login: "alice", password: "long-test-password" }, "https://evil.example")).status).toBe(403);
    expect((await app.request("/api/auth/register", "", "POST", { login: "../alice", password: "short" })).status).toBe(400);
    expect((await app.request("/api/auth/login", "", "POST", { login: 12, password: {} })).status).toBe(400);
    const registration = await app.request("/api/auth/register", "", "POST", { login: "alice", password: "long-test-password" });
    expect(registration.headers.get("set-cookie")).toContain("Secure");
    const session = cookie(registration);
    expect((await app.request("/api/chats", session, "POST", {}, "https://evil.example")).status).toBe(403);
    expect((await app.request("/api/auth/logout", session, "POST", {}, "https://evil.example")).status).toBe(403);
    expect((await app.request("/api/chats", session)).status).toBe(200);
    expect((await app.request("/api/auth/register", "", "POST", { login: "alice", password: "long-test-password" })).status).toBe(409);
    let last: Response | undefined;
    for (let i = 0; i < 25; i++) last = await app.request("/api/auth/login", "", "POST", { login: "missing", password: "long-test-password" });
    expect(last?.status).toBe(429); expect(last?.headers.has("retry-after")).toBe(true);
  } finally { await app.close(); }
});
