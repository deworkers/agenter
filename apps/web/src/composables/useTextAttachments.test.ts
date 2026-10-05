import { effectScope, nextTick, ref } from "vue";
import { expect, it } from "vitest";
import { useTextAttachments } from "./useTextAttachments.js";
import type { TextAttachment } from "../api/types.js";
import { clipboardAttachment } from "./textFiles.js";

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

it("keeps rejected long clipboard text available for native insertion", () => {
  const scope = effectScope(); const attachments = ref<TextAttachment[]>(Array.from({ length: 10 }, (_, index) => ({ id: String(index), name: `${index}.txt`, source: "file", content: "x" })));
  const state = scope.run(() => useTextAttachments(attachments, () => "c"))!;
  let prevented = false;
  state.paste({ preventDefault: () => { prevented = true; }, clipboardData: { getData: () => "y".repeat(101) } } as unknown as ClipboardEvent);
  expect(prevented).toBe(false);
  expect(attachments.value).toHaveLength(10);
  expect(state.error.value).toContain("10");
  scope.stop();
});

it("inserts a clipboard attachment at the selection and removes it only after success", () => {
  const scope = effectScope();
  const clip = clipboardAttachment("line 1\nline 2");
  const attachments = ref<TextAttachment[]>([clip]);
  const state = scope.run(() => useTextAttachments(attachments, () => "c"))!;
  expect(state.insertClipboard(clip.id, "before unwanted after", 7, 15)).toEqual({ value: "before line 1\nline 2 after", cursor: 20 });
  expect(attachments.value).toEqual([]);
  scope.stop();
});

it("leaves a clipboard attachment intact when its text will exceed the prompt limit", () => {
  const scope = effectScope();
  const clip = clipboardAttachment("x".repeat(101));
  const attachments = ref<TextAttachment[]>([clip]);
  const state = scope.run(() => useTextAttachments(attachments, () => "c"))!;
  expect(() => state.insertClipboard(clip.id, "y".repeat(100_000), 100_000, 100_000)).toThrow(/100 000/);
  expect(attachments.value).toEqual([clip]);
  scope.stop();
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
