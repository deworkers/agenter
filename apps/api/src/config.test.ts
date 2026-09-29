import { describe, expect, it } from "vitest";
import { interpolateEnv } from "./config.js";

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
