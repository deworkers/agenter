import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { useOptionPicker } from "./useOptionPicker.js";

const options = [
  { value: "auto", label: "Автовыбор", detail: "По задаче" },
  { value: "api", label: "api-smart", detail: "gpt-4.1" },
  { value: "local", label: "local", detail: "E:\\models\\Ornith-1.5-9B.gguf" },
];

describe("useOptionPicker", () => {
  it("opens at the selected item, wraps arrow navigation and commits a choice", () => {
    const selected = ref("api");
    const picker = useOptionPicker(ref(options), selected);

    picker.open();
    expect(picker.activeIndex.value).toBe(1);
    picker.move(1);
    expect(picker.activeIndex.value).toBe(2);
    picker.move(1);
    expect(picker.activeIndex.value).toBe(0);
    picker.selectActive();
    expect(selected.value).toBe("auto");
    expect(picker.isOpen.value).toBe(false);
  });

  it("finds options by label or full detail and handles an empty result", () => {
    const selected = ref("auto");
    const picker = useOptionPicker(ref(options), selected);
    picker.open();
    picker.query.value = "ornith";
    expect(picker.filtered.value.map((option) => option.value)).toEqual(["local"]);
    picker.selectActive();
    expect(selected.value).toBe("local");

    picker.open();
    picker.query.value = "missing";
    expect(picker.filtered.value).toEqual([]);
    picker.move(1);
    picker.selectActive();
    expect(selected.value).toBe("local");
  });
});
