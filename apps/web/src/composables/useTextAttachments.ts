import { onScopeDispose, ref, watch, type Ref } from "vue";
import { validateAttachments, type TextAttachment } from "@agenter/agent-core";
import { clipboardAttachment, readTextFile } from "./textFiles.js";

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
    try {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text) throw new RangeError("Из буфера принимается только текст");
      if (text.length <= 100) return;
      add([clipboardAttachment(text)]);
    } catch (cause) { error.value = cause instanceof Error ? cause.message : "Не удалось вставить текст"; }
    event.preventDefault();
  }
  return { error, loading, addFiles, paste };
}
