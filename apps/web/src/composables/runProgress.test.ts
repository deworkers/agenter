import { describe, expect, it } from "vitest";
import type { DisplayMessage } from "../api/types.js";
import { applyRunProgress } from "./runProgress.js";

function assistant(): DisplayMessage {
  return { id: "a1", chatId: "c1", role: "assistant", content: "", provider: null, model: null, createdAt: "", runPhase: "waiting", provisional: false };
}

describe("run progress", () => {
  it("keeps continuation text provisional until the run completes", () => {
    const message = assistant();
    applyRunProgress(message, { type: "run.phase", stage: "checking" });
    expect(message).toMatchObject({ runPhase: "checking", provisional: true });
    message.content = "";
    applyRunProgress(message, { type: "text.reset" });
    expect(message).toMatchObject({ content: "", runPhase: "waiting", provisional: true });
    message.content = "Final candidate";
    applyRunProgress(message, { type: "text.delta", text: "Final candidate" });
    expect(message).toMatchObject({ runPhase: "receiving", provisional: true });
    applyRunProgress(message, { type: "run.completed" });
    expect(message).toMatchObject({ runPhase: "completed", provisional: false });
  });

  it("shows an actual waiting stage, tool execution and errors", () => {
    const message = assistant();
    applyRunProgress(message, { type: "run.phase", stage: "waiting" });
    expect(message.runPhase).toBe("waiting");
    applyRunProgress(message, { type: "tool.started", tool: "search", arguments: {} });
    expect(message).toMatchObject({ runPhase: "tool", currentTool: "search" });
    applyRunProgress(message, { type: "tool.completed", tool: "search", result: {} });
    expect(message).toMatchObject({ runPhase: "waiting" });
    expect(message.currentTool).toBeUndefined();
    applyRunProgress(message, { type: "run.error", message: "Failed" });
    expect(message).toMatchObject({ runPhase: "error", provisional: false });
  });
});
