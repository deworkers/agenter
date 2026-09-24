import { describe, expect, it } from "vitest";
import { providerPickerOptions, skillPickerOptions } from "./pickerOptions.js";

describe("picker options", () => {
  it("keeps a full model path in the menu and a short label in the trigger", () => {
    const options = providerPickerOptions([
      { id: "local", model: "E:\\models\\Ornith-1.5-9B-MTP-NVFP4.gguf" },
      { id: "api-smart", model: "gpt-4.1" },
    ], "local");

    expect(options[0]).toMatchObject({ value: "auto", triggerLabel: "Auto" });
    expect(options[1]).toMatchObject({
      value: "local",
      detail: "E:\\models\\Ornith-1.5-9B-MTP-NVFP4.gguf",
      triggerLabel: "local · Ornith-1.5-9B-MTP-NVFP4.gguf",
      badge: "По умолчанию",
    });
  });

  it("shows None and skill descriptions without losing stable skill ids", () => {
    const options = skillPickerOptions([{ id: "code-review", name: "Code Review", description: "Check correctness" }]);
    expect(options[0]).toMatchObject({ value: "", label: "Без навыка" });
    expect(options[1]).toMatchObject({ value: "code-review", label: "Code Review", detail: "Check correctness" });
  });
});
