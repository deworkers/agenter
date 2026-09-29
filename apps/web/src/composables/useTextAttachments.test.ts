import { effectScope, nextTick, ref } from "vue";
import { expect, it } from "vitest";
import { useTextAttachments } from "./useTextAttachments.js";
import type { TextAttachment } from "../api/types.js";

it("accepts only text from paste and never inserts clipboard HTML or files into the prompt", () => {
  const scope = effectScope(); const attachments = ref<TextAttachment[]>([]);
  const state = scope.run(() => useTextAttachments(attachments, () => "c"))!;
  let prevented = false;
  state.paste({ preventDefault: () => { prevented = true; }, clipboardData: { getData: (type: string) => type === "text/plain" ? "Plain text" : "<script>bad</script>" } } as unknown as ClipboardEvent);
  expect(prevented).toBe(true); expect(attachments.value).toHaveLength(1); expect(attachments.value[0]?.content).toBe("Plain text");
  state.paste({ preventDefault() {}, clipboardData: { getData: () => "" } } as unknown as ClipboardEvent);
  expect(attachments.value).toHaveLength(1); expect(state.error.value).toContain("текст"); scope.stop();
});
it("does not attach a file to a different chat when a read finishes late", async () => {
  const scope = effectScope(); const key = ref("one"); const attachments = ref<TextAttachment[]>([]);
  const state = scope.run(() => useTextAttachments(attachments, () => key.value))!;
  let finish!: (buffer: ArrayBuffer) => void;
  const file = { name: "a.txt", size: 1, arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) } as File;
  const pending = state.addFiles([file]); key.value = "two"; await nextTick();
  finish(new TextEncoder().encode("A").buffer); await pending;
  expect(attachments.value).toEqual([]); expect(state.loading.value).toBe(false); scope.stop();
});
