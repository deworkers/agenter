import type { AgentEvent, DisplayMessage } from "../api/types.js";

export type RunProgressEvent = Extract<AgentEvent, {
  type: "run.phase" | "text.delta" | "text.reset" | "tool.started" | "tool.completed" | "run.completed" | "run.error";
}>;

export function applyRunProgress(message: DisplayMessage, event: RunProgressEvent): void {
  switch (event.type) {
    case "run.phase":
      message.runPhase = event.stage;
      if (event.stage === "checking") message.provisional = true;
      break;
    case "text.delta":
      message.runPhase = "receiving";
      break;
    case "text.reset":
      message.runPhase = "waiting";
      message.provisional = true;
      break;
    case "tool.started":
      message.runPhase = "tool";
      message.currentTool = event.tool;
      break;
    case "tool.completed":
      message.runPhase = "waiting";
      message.currentTool = undefined;
      break;
    case "run.completed":
      message.runPhase = "completed";
      message.provisional = false;
      message.currentTool = undefined;
      break;
    case "run.error":
      message.runPhase = "error";
      message.provisional = false;
      message.currentTool = undefined;
      break;
  }
}
