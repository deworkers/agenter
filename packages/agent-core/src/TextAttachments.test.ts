import { expect, it } from "vitest";
import { messageText, validateAttachments, responseInstructions, MAX_ATTACHMENT_BYTES } from "./TextAttachments.js";

const file = { id: "a", name: "данные.json", source: "file" as const, content: '{"value":42}' };
it("keeps attachment text separate but builds a named user context", () => {
  expect(validateAttachments([file])).toEqual([file]);
  expect(messageText("Read", [file])).toContain(file.content.replaceAll('"', '\\"'));
  expect(messageText("Read", [file])).toContain("данные.json");
  expect(messageText("Read")).toBe("Read");
});
it("rejects binary, malformed, oversized, duplicate and excessive attachments", () => {
  for (const value of [null, [{ ...file, content: "\u0000" }], [{ ...file, name: "../a.txt" }], [{ ...file, source: "image" }], [{ ...file, content: "я".repeat(MAX_ATTACHMENT_BYTES) }], [file, file], Array.from({ length: 11 }, (_, i) => ({ ...file, id: String(i) }))]) {
    expect(() => validateAttachments(value)).toThrow();
  }
  expect(validateAttachments(undefined)).toEqual([]);
  const full = { ...file, content: "a".repeat(MAX_ATTACHMENT_BYTES) };
  expect(validateAttachments([full, { ...full, id: "second" }])).toHaveLength(2);
  expect(() => validateAttachments([full, { ...full, id: "second" }, { ...file, id: "third" }])).toThrow(/Общий размер/);
});
it("only changes response instructions when a file format is chosen", () => {
  expect(responseInstructions()).toBe("");
  expect(responseInstructions("html")).toContain("html filename=");
  expect(responseInstructions("markdown")).toContain("markdown filename=");
});
it("makes file delivery explicit despite skills describing filesystem workflows", () => {
  for (const format of ["html", "markdown"] as const) {
    const instructions = responseInstructions(format);
    expect(instructions).toContain("exactly one fenced code block");
    expect(instructions).toContain("Do not claim");
    expect(instructions).toContain("final assistant response");
    expect(instructions).toContain("takes precedence");
  }
  expect(responseInstructions("html")).toContain("<!doctype html>");
  expect(responseInstructions("html")).toContain("external resources");
  expect(responseInstructions("markdown")).toContain("longer than any code fence");
});
