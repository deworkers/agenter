import { writeFileSync, unlinkSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { interpolateEnv, loadConfigFromFile } from "./config.js";

describe("interpolateEnv", () => {
  it("replaces ${VAR} with the environment variable value", () => {
    process.env.TEST_INTERPOLATE_VAR = "resolved-value";
    expect(interpolateEnv("${TEST_INTERPOLATE_VAR}")).toBe("resolved-value");
    delete process.env.TEST_INTERPOLATE_VAR;
  });

  it("leaves a literal string unchanged when it has no ${...} placeholder", () => {
    expect(interpolateEnv("local")).toBe("local");
  });

  it("throws when the referenced environment variable is not set", () => {
    delete process.env.TEST_MISSING_VAR;
    expect(() => interpolateEnv("${TEST_MISSING_VAR}")).toThrow(
      "Missing required environment variable: TEST_MISSING_VAR"
    );
  });
});

describe("loadConfigFromFile", () => {
  const filePath = "./.tmp-test-providers.yaml";

  afterEach(() => {
    try {
      unlinkSync(filePath);
    } catch {
      // ignore
    }
  });

  it("parses providers.yaml, resolves ${VAR} placeholders, and reports the default provider", () => {
    writeFileSync(
      filePath,
      [
        "defaultProvider: local-fast",
        "providers:",
        "  local-fast:",
        "    type: openai-compatible",
        "    baseUrl: http://localhost:1234/v1",
        "    apiKey: local",
        "    model: qwen3",
        "  local-code:",
        "    type: openai-compatible",
        "    baseUrl: http://localhost:1234/v1",
        "    apiKey: local",
        "    model: qwen3-coder-30b",
      ].join("\n")
    );

    const config = loadConfigFromFile(filePath);

    expect(config.defaultProviderId).toBe("local-fast");
    expect(config.providers).toEqual([
      {
        id: "local-fast",
        type: "openai-compatible",
        baseUrl: "http://localhost:1234/v1",
        apiKey: "local",
        model: "qwen3",
        contextWindow: undefined,
      },
      {
        id: "local-code",
        type: "openai-compatible",
        baseUrl: "http://localhost:1234/v1",
        apiKey: "local",
        model: "qwen3-coder-30b",
        contextWindow: undefined,
      },
    ]);
  });

  it("resolves an apiKey given as ${VAR} from the environment", () => {
    process.env.TEST_PROVIDER_KEY = "sk-resolved";
    writeFileSync(
      filePath,
      [
        "defaultProvider: remote",
        "providers:",
        "  remote:",
        "    type: openai-compatible",
        "    baseUrl: https://api.example.com/v1",
        "    apiKey: ${TEST_PROVIDER_KEY}",
        "    model: some-model",
      ].join("\n")
    );

    const config = loadConfigFromFile(filePath);

    expect(config.providers[0]?.apiKey).toBe("sk-resolved");
    delete process.env.TEST_PROVIDER_KEY;
  });
});
