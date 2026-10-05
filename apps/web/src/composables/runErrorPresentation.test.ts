import { describe, expect, it } from "vitest";
import { runErrorPresentation } from "./runErrorPresentation.js";

describe("runErrorPresentation", () => {
  it("shows a safe cause and next step for a persisted tool failure", () => {
    expect(runErrorPresentation({ error: "Запрос не завершён успешно.", errorCode: "tool_failed" })).toEqual({
      reason: "Инструмент завершился с ошибкой.",
      nextStep: "Проверьте доступность источника и повторите запрос вручную.",
    });
  });

  it("keeps a generic explanation for legacy runs without a category", () => {
    expect(runErrorPresentation({ error: "Запрос не завершён успешно." })).toEqual({ reason: "Запрос не завершён успешно." });
  });
});
