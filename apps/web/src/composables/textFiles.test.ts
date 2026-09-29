import { expect, it } from "vitest";
import { readTextFile, clipboardAttachment } from "./textFiles.js";

it("reads UTF-8 text losslessly and rejects images and binary disguised as text", async () => {
  const value = "# Текст\r\n\tdata\n";
  expect(await readTextFile(new File([value], "notes.md"))).toMatchObject({ name: "notes.md", content: value, source: "file" });
  await expect(readTextFile(new File([new Uint8Array([255, 254, 0, 1])], "notes.txt"))).rejects.toThrow();
  await expect(readTextFile(new File(["binary"], "image.png", { type: "image/png" }))).rejects.toThrow();
});
it("stores only plain clipboard text as an attachment, keeping whitespace", () => {
  expect(clipboardAttachment("<b>Hello</b>\n")).toMatchObject({ source: "clipboard", name: "Из буфера.txt", content: "<b>Hello</b>\n" });
  expect(() => clipboardAttachment(" ")).toThrow();
});
