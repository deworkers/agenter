import { onScopeDispose, ref, watch, type Ref } from "vue";
import { validateAttachments, type TextAttachment } from "@agenter/agent-core";
import { clipboardAttachment, insertTextAtSelection, readTextFile } from "./textFiles.js";

export function useTextAttachments(attachments: Ref<TextAttachment[]>, chatKey: () => string) {
  const error = ref(""); const loading = ref(false);
  let sequence = 0;
  const invalidate = () => { sequence++; loading.value = false; error.value = ""; };
  watch(chatKey, invalidate, { flush: "sync" });
  onScopeDispose(invalidate);
  function add(items: TextAttachment[]): void { attachments.value = validateAttachments([...attachments.value, ...items]); }
  async function addFiles(files: readonly File[]): Promise<void> {
    if (!files.length || loading.value) return;
    const current = ++sequence; loading.value = true; error.value = "";
    try {
      if (files.length + attachments.value.length > 10) throw new RangeError("Можно добавить до 10 текстовых вложений");
      const values = await Promise.all(files.map(readTextFile));
      if (current === sequence) add(values);
    } catch (cause) { if (current === sequence) error.value = cause instanceof Error ? cause.message : "Не удалось прочитать файл"; }
    finally { if (current === sequence) loading.value = false; }
  }
  function paste(event: ClipboardEvent): void {
    error.value = "";
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!text) {
      error.value = "Из буфера принимается только текст";
      event.preventDefault();
      return;
    }
    if (text.length <= 100) return;
    try {
      add([clipboardAttachment(text)]);
      event.preventDefault();
    } catch (cause) { error.value = cause instanceof Error ? cause.message : "Не удалось вставить текст"; }
  }
  function insertClipboard(id: string, current: string, start: number, end: number): { value: string; cursor: number } {
    const item = attachments.value.find(attachment => attachment.id === id && attachment.source === "clipboard");
    if (!item) throw new RangeError("Вложение из буфера уже недоступно");
    const inserted = insertTextAtSelection(current, item.content, start, end);
    attachments.value = attachments.value.filter(attachment => attachment.id !== id);
    return inserted;
  }
  return { error, loading, addFiles, paste, insertClipboard };
}
