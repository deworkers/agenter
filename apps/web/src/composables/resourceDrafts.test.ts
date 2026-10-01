import { expect, it } from "vitest";
import { createModelDraft, createServerDraft, stageResource } from "./resourceDrafts.js";
import type { Settings } from "../api/types.js";
it("validates a complete model before adding it and never overwrites an existing ID", () => {
  const fields = { id: "local", label: "Local", baseUrl: "http://localhost:1234/v1", apiKey: "local", model: "test", contextWindow: 8192, maxOutputTokens: 1024 };
  const entry = createModelDraft(fields);
  expect(entry.kind).toBe("model");
  if (entry.kind === "model") expect(entry.entry.timeoutMs).toBe(600000);
  const settings: Settings = { version: 1, systemPrompt: "You are a helpful assistant.", defaultProvider: "local", providers: {}, routes: {}, mcpServers: {} };
  stageResource(settings, entry);
  expect(settings.providers.local?.model).toBe("test");
  expect(() => stageResource(settings, createModelDraft({ ...fields, model: "replacement" }))).toThrow();
  expect(settings.providers.local?.model).toBe("test");
  expect(() => createModelDraft({ ...fields, maxOutputTokens: 8192 })).toThrow();
  expect(() => createModelDraft({ ...fields, model: "" })).toThrow();
  expect(() => createModelDraft({ ...fields, baseUrl: "https://example.com/v1", apiKey: "plain-secret" })).toThrow();
});
it("creates stdio configuration from readable argument/environment lines with tools disabled", () => {
  const entry = createServerDraft({ id: "search", transport: "stdio", url: "", command: "npx", argsText: "-y\n@scope/server", envText: "API_TOKEN=${SEARCH_TOKEN}\nREGION=ru" });
  expect(entry.entry).toMatchObject({ command: "npx", args: ["-y", "@scope/server"], env: { API_TOKEN: "${SEARCH_TOKEN}", REGION: "ru" }, allowedTools: [] });
  expect(() => createServerDraft({ id: "search", transport: "stdio", url: "", command: "npx", argsText: "", envText: "BROKEN" })).toThrow();
});
