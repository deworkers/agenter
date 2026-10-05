import { isTextFileName, MAX_ATTACHMENT_BYTES, TEXT_FILE_EXTENSIONS, validateAttachments, validateTextContent, type TextAttachment } from "@agenter/agent-core";

export const textFileAccept = TEXT_FILE_EXTENSIONS.map(extension => `.${extension}`).join(",");
export const MAX_PROMPT_CHARACTERS = 100_000;

export function insertTextAtSelection(current: string, insertion: string, start: number, end: number): { value: string; cursor: number } {
  const from = Math.max(0, Math.min(start, current.length));
  const to = Math.max(from, Math.min(end, current.length));
  const value = current.slice(0, from) + insertion + current.slice(to);
  if (value.length > MAX_PROMPT_CHARACTERS) throw new RangeError("Текст сообщения превышает 100 000 символов");
  return { value, cursor: from + insertion.length };
}

export async function readTextFile(file: File): Promise<TextAttachment> {
  if (!isTextFileName(file.name)) throw new RangeError(`${file.name}: принимаются только текстовые файлы`);
  if (file.size > MAX_ATTACHMENT_BYTES) throw new RangeError(`${file.name}: размер больше 256 КБ`);
  let content: string;
  try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(await file.arrayBuffer()); }
  catch { throw new RangeError(`${file.name}: требуется текст в UTF-8`); }
  const attachment: TextAttachment = { id: crypto.randomUUID(), name: file.name, source: "file", content };
  return validateAttachments([attachment])[0]!;
}
export function clipboardAttachment(content: string): TextAttachment {
  if (!content.trim()) throw new RangeError("В буфере нет текста");
  validateTextContent(content);
  return { id: crypto.randomUUID(), name: "Из буфера.txt", source: "clipboard", content };
}
