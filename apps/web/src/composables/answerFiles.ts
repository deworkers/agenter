import { marked } from "marked";
import type { ResponseFormat } from "../api/types.js";

export interface AnswerFile { name: string; content: string; format: "html" | "markdown" }
export function answerFileMediaType(format: AnswerFile["format"]): string {
  return format === "html" ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8";
}
function closedFence(raw: string): boolean {
  const opening = raw.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!opening) return false;
  const fence = opening[1]!;
  const last = raw.trimEnd().split("\n").at(-1) ?? "";
  return new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(last);
}
function fileName(value: string, format: AnswerFile["format"]): string {
  const extension = format === "html" ? ".html" : ".md";
  const rawName = Array.from(value.split(/[/\\]/).at(-1) ?? "").filter(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join("");
  const base = rawName.replace(/[<>:"|?*]/g, "-").replace(/^\.+/, "").trim().slice(0, 120);
  if (!base || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(base)) return `answer${extension}`;
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
}
export function answerFiles(content: string, responseFormat?: ResponseFormat): AnswerFile[] {
  if (responseFormat === "markdown") {
    const wrappers = [...content.matchAll(/^ {0,3}(`{3,}|~{3,})(?:md|markdown)\b([^\n]*)\r?\n/gm)];
    if (wrappers.length === 1) {
      const wrapper = wrappers[0]!;
      const fence = wrapper[1]!;
      const body = content.slice(wrapper.index! + wrapper[0].length);
      // Some local models repeat the outer fence length inside their document.
      // Use the final closing fence so code examples are not cut off.
      const closing = [...body.matchAll(new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*\\r?$`, "gm"))].at(-1);
      if (!closing) return [];
      const document = body.slice(0, closing.index).replace(/\r?\n$/, "");
      if (marked.lexer(document).some(token => token.type === "code" && /^ {0,3}(`{3,}|~{3,})/.test(token.raw) && !closedFence(token.raw))) return [];
      const requested = wrapper[2]?.match(/\bfilename=(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
      return [{ name: fileName(requested?.[1] ?? requested?.[2] ?? requested?.[3] ?? "answer", "markdown"), content: document, format: "markdown" }];
    }
  }
  const files: AnswerFile[] = [];
  const names = new Set<string>();
  for (const token of marked.lexer(content)) {
    if (token.type !== "code") continue;
    const language = token.lang?.match(/^(html|htm|md|markdown)\b/i)?.[1]?.toLowerCase();
    if (!language) continue;
    if (!closedFence(token.raw)) continue;
    const format = language === "html" || language === "htm" ? "html" : "markdown";
    const requested = token.lang?.match(/\bfilename=(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
    const original = fileName(requested?.[1] ?? requested?.[2] ?? requested?.[3] ?? "answer", format);
    let name = original; let suffix = 2;
    while (names.has(name.toLowerCase())) name = original.replace(/(\.[^.]+)$/, `-${suffix++}$1`);
    names.add(name.toLowerCase()); files.push({ name, content: token.text, format });
  }
  if (responseFormat === "markdown") {
    const documents = files.filter(file => file.format === "markdown");
    if (documents.length) return documents;
    if (!content.trim() || /^\s*(`{3,}|~{3,})(md|markdown)\b/i.test(content)) return [];
    return [{ name: "answer.md", content, format: "markdown" }];
  }
  if (!files.length && content.trim() && !/^ {0,3}(`{3,}|~{3,})/m.test(content)) {
    const rawDocument = /^\s*(<!doctype html\b|<html\b)/i.test(content);
    const rawFragment = responseFormat === "html" && /^\s*<[a-z][\w-]*(?:\s[^<>]*|\s*)>/i.test(content);
    if (rawDocument || rawFragment) files.push({ name: "answer.html", content, format: "html" });
  }
  return responseFormat === "html" ? files.filter(file => file.format === "html") : files;
}
function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
/** Preview files in an opaque sandbox, never in the application's document. */
export function previewDocument(file: AnswerFile, sanitizedMarkdown?: string): { document: string; sandbox: string } {
  const html = file.format === "html" ? file.content : `<style>body{font:16px/1.6 system-ui;max-width:900px;margin:32px auto;padding:0 24px}pre{white-space:pre-wrap;overflow:auto}img{max-width:100%}</style>${sanitizedMarkdown ?? `<pre>${escapeHtml(file.content)}</pre>`}`;
  const policy = `default-src 'none'; script-src ${file.format === "html" ? "'unsafe-inline'" : "'none'"}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'`;
  const inner = `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(policy)}">${html}`;
  return { document: `<!doctype html><meta charset="utf-8">${inner}`, sandbox: file.format === "html" ? "allow-scripts" : "" };
}
export function saveTextFile(name: string, content: string, mediaType = "text/plain;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([content], { type: mediaType }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
