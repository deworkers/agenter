import { writeFileSync, unlinkSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  interpolateEnv,
  loadConfigFromFile,
  loadConfig,
  loadRoutingConfigFromFile,
  validateConfig,
  type AppConfig,
} from "./config.js";

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

  it("throws when default provider apiKey has ${VAR} and env var is missing even with skipRemoteInterpolation=true", () => {
    const prevDefaultVar = process.env.TEST_DEFAULT_VAR;
    try {
      delete process.env.TEST_DEFAULT_VAR;

      writeFileSync(
        filePath,
        [
          "defaultProvider: local",
          "providers:",
          "  local:",
          "    type: openai-compatible",
          "    baseUrl: http://localhost:8080/v1",
          "    apiKey: ${TEST_DEFAULT_VAR}",
          "    model: qwen3",
          "  remote-skip:",
          "    type: openai-compatible",
          "    baseUrl: https://api.example.com/v1",
          "    apiKey: ${REMOTE_KEY}",
          "    model: gpt-5.6-luna",
        ].join("\n")
      );

      // skipRemoteInterpolation only relaxes non-default providers; default must still throw.
      expect(() => loadConfigFromFile(filePath, { skipRemoteInterpolation: true })).toThrow(
        /Missing required environment variable: TEST_DEFAULT_VAR/
      );
    } finally {
      if (prevDefaultVar) process.env.TEST_DEFAULT_VAR = prevDefaultVar; else delete process.env.TEST_DEFAULT_VAR;
    }
  });

  it("succeeds with local-only mode when remote apiKey has ${VAR} placeholder and env var is not set", () => {
    // Remote provider uses ${TOOKEN_CLUB_API_KEY} — ensure it's NOT set.
    const wasSet = process.env.TOOKEN_CLUB_API_KEY;
    delete process.env.TOOKEN_CLUB_API_KEY;

    writeFileSync(
      filePath,
      [
        "defaultProvider: local",
        "providers:",
        "  remote:",
        "    type: openai-compatible",
        "    baseUrl: https://tooken.club/v1",
        "    apiKey: ${TOOKEN_CLUB_API_KEY}",
        "    model: gpt-5.6-sol",
        "  local:",
        "    type: openai-compatible",
        "    baseUrl: http://localhost:8080/v1",
        "    apiKey: local",
        "    model: qwen3",
      ].join("\n")
    );

    // With skipRemoteInterpolation=true, this should NOT throw even though
    // TOOKEN_CLUB_API_KEY is not set.
    expect(() => loadConfigFromFile(filePath, { skipRemoteInterpolation: true })).not.toThrow();

    if (wasSet) process.env.TOOKEN_CLUB_API_KEY = wasSet;
  });
});

describe("loadRoutingConfigFromFile", () => {
  const filePath = "./.tmp-test-routing.yaml";

  afterEach(() => {
    try {
      unlinkSync(filePath);
    } catch {
      // ignore
    }
  });

  it("parses routing.yaml into a RoutingConfig keyed by TaskType", () => {
    writeFileSync(
      filePath,
      [
        "routes:",
        "  simple:",
        "    provider: local-fast",
        "  coding:",
        "    provider: local-code",
        "  reasoning:",
        "    provider: local-fast",
        "  research:",
        "    provider: local-fast",
        "  vision:",
        "    provider: local-fast",
        "",
      ].join("\n")
    );

    const routing = loadRoutingConfigFromFile(filePath);

    expect(routing).toEqual({
      simple: { provider: "local-fast" },
      coding: { provider: "local-code" },
      reasoning: { provider: "local-fast" },
      research: { provider: "local-fast" },
      vision: { provider: "local-fast" },
    });
  });

  it("throws when a TaskType is missing from routes", () => {
    writeFileSync(
      filePath,
      ["routes:", "  simple:", "    provider: local-fast", ""].join("\n")
    );

    expect(() => loadRoutingConfigFromFile(filePath)).toThrow(
      'routing.yaml is missing a route for task type "coding"'
    );
  });

  it("throws a clear config error (not an incidental TypeError) when the routes mapping is absent", () => {
    writeFileSync(filePath, ["# a routing file that declares no routes at all", ""].join("\n"));

    let caught: unknown;
    try {
      loadRoutingConfigFromFile(filePath);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(TypeError);
    expect((caught as Error).message).toBe(
      'Invalid routing configuration: routing.yaml must define a "routes" mapping'
    );
  });

  it("throws a clear config error when a route entry is a scalar instead of an object", () => {
    writeFileSync(
      filePath,
      [
        "routes:",
        "  simple: local-fast",
        "  coding:",
        "    provider: local-code",
        "  reasoning:",
        "    provider: local-fast",
        "  research:",
        "    provider: local-fast",
        "  vision:",
        "    provider: local-fast",
        "",
      ].join("\n")
    );

    expect(() => loadRoutingConfigFromFile(filePath)).toThrow(
      'Invalid routing configuration: route for task type "simple" must be an object with a "provider"'
    );
  });

  it("throws a clear config error when a route provider is not a string", () => {
    writeFileSync(
      filePath,
      [
        "routes:",
        "  simple:",
        "    provider: 123",
        "  coding:",
        "    provider: local-code",
        "  reasoning:",
        "    provider: local-fast",
        "  research:",
        "    provider: local-fast",
        "  vision:",
        "    provider: local-fast",
        "",
      ].join("\n")
    );

    expect(() => loadRoutingConfigFromFile(filePath)).toThrow(
      'Invalid routing configuration: route for task type "simple" must map "provider" to a non-empty string'
    );
  });

  it("throws a clear config error when a route provider is an empty string", () => {
    writeFileSync(
      filePath,
      [
        "routes:",
        "  simple:",
        '    provider: ""',
        "  coding:",
        "    provider: local-code",
        "  reasoning:",
        "    provider: local-fast",
        "  research:",
        "    provider: local-fast",
        "  vision:",
        "    provider: local-fast",
        "",
      ].join("\n")
    );

    expect(() => loadRoutingConfigFromFile(filePath)).toThrow(
      'Invalid routing configuration: route for task type "simple" must map "provider" to a non-empty string'
    );
  });
});

describe("loadConfig", () => {
  it(
    "reads the production config/providers.yaml via exported loadConfig without mutating repo/env config, " +
      "does not throw in local-only mode, and reports the declared default provider",
    () => {
      const previousKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      try {
        const cfg: AppConfig = loadConfig();
        expect(cfg.defaultProviderId).toBe("local");
        expect(cfg.providers.filter(({ id }) => id !== "local").map(({ id, baseUrl, model }) => ({ id, baseUrl, model }))).toEqual([
          { id: "api-smart", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1" },
          { id: "api-fast", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
        ]);
      } finally {
        if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previousKey;
      }
    }
  );
});

describe("validateConfig", () => {
  it("throws for an empty baseUrl when the provider is declared but not the default one", () => {
    const fixture = {
      defaultProviderId: "local",
      providers: [
        { id: "local", type: "openai-compatible", baseUrl: undefined as never, apiKey: "k", model: "m" },
      ],
      } as never;

    // Rescues the fast-fail branch now that an empty required field is detected before String().trim():
    // previously "undefined" was coerced to the string "undefined" and passed validation untouched.
    expect(() => validateConfig(fixture)).toThrow(/baseUrl.*must not be empty/);
  });
});
