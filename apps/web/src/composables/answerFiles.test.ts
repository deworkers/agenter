import { expect, it, vi } from "vitest";
import { answerFileMediaType, answerFiles, previewDocument, saveTextFile } from "./answerFiles.js";

it("extracts completed named html/markdown fences, excludes other code and unfinished fences", () => {
  const content = 'Answer\n```html filename="index.html"\n<!doctype html>\n<h1>Hi</h1>\n```\n\n```md filename=notes.md\n# Notes\n```\n```js\nalert(1)\n```\n```html\nunfinished';
  expect(answerFiles(content)).toEqual([
    { name: "index.html", content: "<!doctype html>\n<h1>Hi</h1>", format: "html" },
    { name: "notes.md", content: "# Notes", format: "markdown" },
  ]);
});
it("exports format-selected raw responses and makes path-safe unique names", () => {
  expect(answerFiles("<h1>Raw</h1>", "html")[0]).toMatchObject({ name: "answer.html", content: "<h1>Raw</h1>" });
  expect(answerFiles("# Raw", "markdown")[0]).toMatchObject({ name: "answer.md", content: "# Raw" });
  expect(answerFiles('```html filename=../../page.html\nA\n```\n```html filename=page.html\nB\n```').map(file => file.name)).toEqual(["page.html", "page-2.html"]);
});
it("does not turn a report about an imaginary HTML file into a downloadable document", () => {
  expect(answerFiles("Created /tmp/landing.html. It contains a hero, CSS and a form.", "html")).toEqual([]);
});
it("exports the whole raw Markdown document even when it includes code examples", () => {
  const content = "# Guide\n\n```html\n<div>Example</div>\n```\n\n```js\nconsole.log(42);\n```";
  expect(answerFiles(content, "markdown")).toEqual([{ name: "answer.md", format: "markdown", content }]);
});
it("does not export an unfinished Markdown delivery wrapper or a different selected format", () => {
  expect(answerFiles("```markdown filename=guide.md\n# Incomplete", "markdown")).toEqual([]);
  expect(answerFiles("```md filename=guide.md\n# Guide\n```", "html")).toEqual([]);
});
it("keeps internal code fences when a local model uses equal outer and inner Markdown fences", () => {
  const document = "# Demo\n\n```javascript\nconsole.log('demo');\n```";
  expect(answerFiles(`📄 **NewFile**\n\n\`\`\`markdown filename=demo.md\n${document}\n\`\`\``, "markdown")).toEqual([{ name: "demo.md", format: "markdown", content: document }]);
  expect(answerFiles(`\`\`\`markdown filename=demo.md\n${document}`, "markdown")).toEqual([]);
});
it("opens generated HTML in a sandbox with no application origin or navigation permissions", () => {
  const html = previewDocument({ name: "evil.html", format: "html", content: '<script>parent.document.body.innerHTML="pwn"</script><h1>OK</h1>' });
  expect(html.sandbox).toBe("allow-scripts");
  expect(html.sandbox).not.toContain("allow-same-origin");
  expect(html.sandbox).not.toContain("allow-top-navigation");
  expect(html.document).toContain("Content-Security-Policy");
  expect(html.document).toContain("connect-src &#39;none&#39;");
  const md = previewDocument({ name: "notes.md", format: "markdown", content: '<img src=x onerror="alert(1)"># Text' });
  expect(md.document).not.toContain("<img src=x");
  expect(md.sandbox).toBe("");
});

it("downloads original UTF-8 content with the filename and revokes its temporary URL", async () => {
  vi.useFakeTimers();
  const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  const append = vi.fn();
  vi.stubGlobal("document", { createElement: () => anchor, body: { append } });
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-download");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  try {
    saveTextFile("result.md", "# Привет\n", "text/markdown;charset=utf-8");
    expect(anchor.download).toBe("result.md"); expect(anchor.href).toBe("blob:test-download");
    expect(append).toHaveBeenCalledWith(anchor); expect(anchor.click).toHaveBeenCalledOnce(); expect(anchor.remove).toHaveBeenCalledOnce();
    const blob = create.mock.calls[0]![0];
    if (!(blob instanceof Blob)) throw new Error("Expected a downloadable Blob");
    expect(await blob.text()).toBe("# Привет\n");
    expect(blob.type).toBe("text/markdown;charset=utf-8");
    vi.advanceTimersByTime(60_000); expect(revoke).toHaveBeenCalledWith("blob:test-download");
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); }
});

it("selects the correct content type for a downloaded HTML or Markdown file", () => {
  expect(answerFileMediaType("html")).toBe("text/html;charset=utf-8");
  expect(answerFileMediaType("markdown")).toBe("text/markdown;charset=utf-8");
});
