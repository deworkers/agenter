import { afterEach, expect, it } from "vitest";
import { customRef, effectScope, ref } from "vue";
import { parseChatCommand } from "./chatCommands.js";
import { useCommandSuggestions } from "./useCommandSuggestions.js";

const scopes: ReturnType<typeof effectScope>[] = [];
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop(); });
function setup(value = "/") {
  const scope = effectScope(); scopes.push(scope);
  const draft = ref(value), context = ref("chat-one"), disabled = ref(false);
  const state = scope.run(() => useCommandSuggestions(draft, () => context.value, () => disabled.value))!;
  state.focus(value.length, value.length);
  return { draft, context, disabled, state };
}

it("suggests supported commands with descriptions only while editing a leading slash token", () => {
  const { state } = setup();
  expect(state.suggestions.value.map(item => item.name)).toEqual(["model", "new", "compact"]);
  for (const command of state.suggestions.value) {
    expect(command.description).toBeTruthy();
    expect(parseChatCommand(`/${command.name}`)?.name).toBe(command.name);
  }
  for (const value of ["hello /", "path/to/file", "/unknown", "/model auto", "\n/new"]) {
    expect(setup(value).state.suggestions.value).toEqual([]);
  }
});

it("filters case-insensitively and resets selection when the query changes", () => {
  const { draft, state } = setup();
  state.handleKeydown({ key: "ArrowDown" });
  expect(state.activeIndex.value).toBe(1);
  draft.value = "/Co"; state.updateSelection(3, 3);
  expect(state.suggestions.value.map(item => item.name)).toEqual(["compact"]);
  expect(state.activeIndex.value).toBe(0);
});

it("moves through the list in both directions and inserts without submitting", () => {
  const { draft, state } = setup();
  expect(state.handleKeydown({ key: "ArrowUp" })).toEqual({ handled: true });
  expect(state.activeIndex.value).toBe(2);
  expect(state.handleKeydown({ key: "ArrowDown" })).toEqual({ handled: true });
  expect(state.activeIndex.value).toBe(0);
  expect(state.handleKeydown({ key: "Enter" })).toEqual({ handled: true, cursor: 7 });
  expect(draft.value).toBe("/model ");
  expect(state.suggestions.value).toEqual([]);
  // The next Enter goes to the composer's normal submit handler.
  expect(state.handleKeydown({ key: "Enter" })).toEqual({ handled: false });
});

it("completes with Tab or a clicked option and keeps surrounding text", () => {
  const tab = setup("/n");
  expect(tab.state.handleKeydown({ key: "Tab" })).toEqual({ handled: true, cursor: 5 });
  expect(tab.draft.value).toBe("/new ");
  const click = setup("  /mo api-fast");
  click.state.updateSelection(5, 5);
  expect(click.state.complete(0)).toBe(9);
  expect(click.draft.value).toBe("  /model api-fast");
  expect(click.state.suggestions.value).toEqual([]);
});

it("dismisses with Escape until the draft changes", () => {
  const { draft, state } = setup();
  expect(state.handleKeydown({ key: "Escape" })).toEqual({ handled: true });
  state.updateSelection(1, 1);
  expect(state.suggestions.value).toEqual([]);
  expect(state.handleKeydown({ key: "Tab" })).toEqual({ handled: false });
  draft.value = "/m"; state.updateSelection(2, 2);
  expect(state.suggestions.value.map(item => item.name)).toEqual(["model"]);
});

it("leaves newline, IME, modified keys and ordinary input to the composer", () => {
  const { draft, state } = setup();
  for (const event of [
    { key: "Enter", shiftKey: true }, { key: "Tab", shiftKey: true },
    { key: "Enter", isComposing: true }, { key: "ArrowDown", ctrlKey: true },
    { key: "Enter", altKey: true }, { key: "Enter", metaKey: true }, { key: "a" },
  ]) expect(state.handleKeydown(event)).toEqual({ handled: false });
  expect(draft.value).toBe("/");
  const ordinary = setup("hello");
  expect(ordinary.state.handleKeydown({ key: "Enter" })).toEqual({ handled: false });
});

it("hides suggestions outside the command token or across a selection", () => {
  const { state } = setup("/mo api-fast");
  expect(state.suggestions.value).toEqual([]);
  state.updateSelection(3, 3);
  expect(state.suggestions.value).toHaveLength(1);
  state.updateSelection(1, 8);
  expect(state.suggestions.value).toEqual([]);
  state.updateSelection(0, 0);
  expect(state.suggestions.value).toEqual([]);
});

it("closes on blur, chat changes and disabled input without altering the draft", () => {
  const { draft, state, context, disabled } = setup();
  state.blur(); expect(state.suggestions.value).toEqual([]);
  state.focus(1, 1); expect(state.suggestions.value).toHaveLength(3);
  context.value = "chat-two"; expect(state.suggestions.value).toEqual([]);
  state.focus(1, 1); disabled.value = true;
  expect(state.suggestions.value).toEqual([]);
  expect(state.complete(0)).toBeUndefined();
  disabled.value = false; expect(state.suggestions.value).toEqual([]);
  expect(draft.value).toBe("/");
});

it("ignores an invalid or stale clicked option", () => {
  const { draft, state } = setup();
  expect(state.complete(9)).toBeUndefined();
  state.blur(); expect(state.complete(0)).toBeUndefined();
  expect(draft.value).toBe("/");
});

it("keeps the list closed when a controlled draft receives the inserted value later", () => {
  const scope = effectScope(); scopes.push(scope);
  let value = "/co", pending = value, update = () => { /* Set by the custom ref. */ };
  const draft = customRef<string>((track, trigger) => {
    update = () => { value = pending; trigger(); };
    return { get() { track(); return value; }, set(next) { pending = next; } };
  });
  const state = scope.run(() => useCommandSuggestions(draft, () => "one", () => false))!;
  state.focus(3, 3);
  expect(state.complete(0)).toBe(9);
  update();
  expect(draft.value).toBe("/compact ");
  expect(state.suggestions.value).toEqual([]);
  expect(state.handleKeydown({ key: "Enter" })).toEqual({ handled: false });
});
