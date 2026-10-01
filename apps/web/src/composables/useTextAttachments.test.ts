import { effectScope, nextTick, ref } from "vue";
import { expect, it } from "vitest";
import { useTextAttachments } from "./useTextAttachments.js";
import type { TextAttachment } from "../api/types.js";

it("leaves plain text up to 100 characters for native textarea insertion", () => {
  const scope = effectScope(); const attachments = ref<TextAttachment[]>([]);
  const state = scope.run(() => useTextAttachments(attachments, () => "c"))!;
  for (const text of ["  Plain text\n", "x".repeat(100)]) {
    let prevented = false;
    state.paste({ preventDefault: () => { prevented = true; }, clipboardData: { getData: (type: string) => type === "text/plain" ? text : "<script>bad</script>" } } as unknown as ClipboardEvent);
    expect(prevented).toBe(false);
    expect(attachments.value).toEqual([]);
    expect(state.error.value).toBe("");
  }
  scope.stop();
});

it("attaches text longer than 100 characters and rejects clipboard data without plain text", () => {
  const scope = effectScope(); const attachments = ref<TextAttachment[]>([]);
  const state = scope.run(() => useTextAttachments(attachments, () => "c"))!;
  let prevented = false;
  const text = "x".repeat(101);
  state.paste({ preventDefault: () => { prevented = true; }, clipboardData: { getData: (type: string) => type === "text/plain" ? text : "<script>bad</script>" } } as unknown as ClipboardEvent);
  expect(prevented).toBe(true); expect(attachments.value).toHaveLength(1); expect(attachments.value[0]?.content).toBe(text);
  prevented = false;
  state.paste({ preventDefault: () => { prevented = true; }, clipboardData: { getData: () => "" } } as unknown as ClipboardEvent);
  expect(prevented).toBe(true);
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
