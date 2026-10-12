import { useLayoutEffect, useRef } from 'react';

const dialogs: HTMLElement[] = [];
const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusables = (element: HTMLElement) => Array.from(element.querySelectorAll<HTMLElement>(focusableSelector)).filter((item) => item.getClientRects().length > 0 && !item.closest('[hidden]'));

/** Keep keyboard focus in the most recently opened modal, including nested OAuth prompts. */
export function useDialogFocus<T extends HTMLElement>(onEscape: () => void, restoreFocus?: () => HTMLElement | null, enabled = true) {
  const ref = useRef<T>(null);
  const callbacks = useRef({ onEscape, restoreFocus });
  useLayoutEffect(() => { callbacks.current = { onEscape, restoreFocus }; }, [onEscape, restoreFocus]);
  useLayoutEffect(() => {
    if (!enabled) return;
    const currentDialog = ref.current;
    if (!currentDialog) return;
    const dialog: HTMLElement = currentDialog;
    const previous = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    dialogs.push(dialog);
    const isTop = () => dialogs[dialogs.length - 1] === dialog;
    const first = () => dialog.querySelector<HTMLElement>('[data-dialog-autofocus]:not([disabled])') ?? focusables(dialog)[0] ?? dialog;
    first().focus({ preventScroll: true });
    function keydown(event: KeyboardEvent) {
      if (!isTop()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); callbacks.current.onEscape(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables(dialog);
      const current = document.activeElement;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!firstItem) { event.preventDefault(); dialog.focus({ preventScroll: true }); }
      else if (event.shiftKey && (current === firstItem || !dialog.contains(current))) { event.preventDefault(); lastItem.focus({ preventScroll: true }); }
      else if (!event.shiftKey && (current === lastItem || !dialog.contains(current))) { event.preventDefault(); firstItem.focus({ preventScroll: true }); }
    }
    function focusin(event: FocusEvent) {
      if (isTop() && event.target instanceof Node && !dialog.contains(event.target)) first().focus({ preventScroll: true });
    }
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focusin, true);
      const index = dialogs.indexOf(dialog);
      if (index >= 0) dialogs.splice(index, 1);
      const parent = dialogs[dialogs.length - 1];
      const target = previous?.isConnected ? previous : callbacks.current.restoreFocus?.() ?? null;
      if (target && (!parent || parent.contains(target))) target.focus({ preventScroll: true });
      else if (parent) (focusables(parent)[0] ?? parent).focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('[aria-label="新建会话"]')?.focus({ preventScroll: true });
    };
  }, [enabled]);
  return ref;
}
