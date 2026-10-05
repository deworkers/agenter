import { onBeforeUnmount, onMounted, watch, type Ref } from "vue";

const modalStack: HTMLElement[] = [];
const focusableSelector = "a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

export function useModalFocus(dialogRef: Ref<HTMLElement | null>, active?: Readonly<Ref<boolean>>): void {
  let previousFocus: HTMLElement | null = null;
  let dialog: HTMLElement | null = null;
  let mounted = false;

  function trapTab(event: KeyboardEvent): void {
    if (event.key !== "Tab" || !dialog || modalStack.at(-1) !== dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)]
      .filter((element) => element.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function activate(): void {
    if (dialog || !activeState()) return;
    dialog = dialogRef.value;
    if (!dialog) return;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalStack.push(dialog);
    document.addEventListener("keydown", trapTab);
    const first = dialog.querySelector<HTMLElement>(focusableSelector);
    (first ?? dialog).focus();
  }

  function deactivate(): void {
    if (!dialog) return;
    document.removeEventListener("keydown", trapTab);
    const index = modalStack.lastIndexOf(dialog);
    if (index !== -1) modalStack.splice(index, 1);
    if (previousFocus?.isConnected) previousFocus.focus();
    dialog = null;
    previousFocus = null;
  }

  function activeState(): boolean {
    return !active || active.value;
  }

  const stopWatching = active ? watch(active, (enabled) => {
    if (!mounted) return;
    if (enabled) activate();
    else deactivate();
  }, { flush: "sync" }) : undefined;

  onMounted(() => {
    mounted = true;
    activate();
  });

  onBeforeUnmount(() => {
    mounted = false;
    stopWatching?.();
    deactivate();
  });
}
