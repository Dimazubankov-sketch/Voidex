/**
 * Step 2.8: one place that knows whether the on-screen keyboard is open.
 *
 * It sets on <html>:
 *   data-keyboard  while a text field is focused and the keyboard takes space;
 *   --kb           how much of the layout the keyboard covers (iOS draws the
 *                  keyboard over the page; with `interactive-widget=
 *                  resizes-content` Android shrinks the page instead, so --kb
 *                  stays 0 there and only data-keyboard is set).
 *
 * Bottom bars use them to sit just above the keyboard: no safe-area gap and
 * no home indicator under them while typing (the keyboard covers both).
 */
const OPEN_MIN = 120;

const editable = (el: Element | null) => {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) return !el.readOnly && !["button", "checkbox", "radio", "range", "color", "file", "submit", "reset", "image"].includes(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
};

/** The keyboard's overlap of the layout viewport (px). */
export function keyboardOverlap(innerHeight: number, vvHeight: number, vvOffsetTop: number) {
  return Math.max(0, Math.round(innerHeight - vvHeight - vvOffsetTop));
}

export function trackKeyboard(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => undefined;
  const root = document.documentElement;
  // The tallest page height seen at this width: with resizes-content the page itself shrinks under the keyboard.
  const tallest = new Map<number, number>();
  let last = "";
  const update = () => {
    const width = window.innerWidth;
    const full = Math.max(tallest.get(width) ?? 0, window.innerHeight);
    if (!editable(document.activeElement)) tallest.set(width, full);
    const kb = keyboardOverlap(window.innerHeight, vv.height, vv.offsetTop);
    const open = editable(document.activeElement) && (kb > OPEN_MIN || full - vv.height > OPEN_MIN);
    const state = `${open}:${open ? kb : 0}`;
    if (state === last) return;
    last = state;
    root.style.setProperty("--kb", `${open ? kb : 0}px`);
    root.toggleAttribute("data-keyboard", open);
    // iOS may leave the page panned after the keyboard goes: put it back, no shifted UI.
    if (!open && (window.scrollY || vv.offsetTop)) window.scrollTo(0, 0);
  };
  let timer = 0;
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(update, 60);
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  document.addEventListener("focusin", later);
  document.addEventListener("focusout", later);
  update();
  return () => {
    window.clearTimeout(timer);
    vv.removeEventListener("resize", update);
    vv.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    document.removeEventListener("focusin", later);
    document.removeEventListener("focusout", later);
    root.style.removeProperty("--kb");
    root.removeAttribute("data-keyboard");
  };
}
