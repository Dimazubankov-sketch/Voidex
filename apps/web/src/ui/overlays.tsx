import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { RiCloseLine } from "@remixicon/react";
import { create } from "zustand";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { Button, IconButton } from "./controls";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The part of the layout viewport the person actually sees (the phone
 * keyboard shrinks it). Centered phone dialogs sit in it, so they never hide
 * under the keyboard and never get pushed off the top.
 */
export function useVisualViewport(enabled: boolean) {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    if (!enabled) {
      setBox(null);
      return;
    }
    const v = window.visualViewport;
    const update = () => setBox(v ? { top: v.offsetTop, height: v.height } : { top: 0, height: window.innerHeight });
    update();
    v?.addEventListener("resize", update);
    v?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      v?.removeEventListener("resize", update);
      v?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [enabled]);
  return box;
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
}

/**
 * Modal surface: a centred dialog on desktop, a bottom sheet on phones.
 * Same component, same design, layout adapted to the form factor.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
  testId,
  centered = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  testId?: string;
  /** Phones too: a dialog in the middle of the visible area (above the keyboard), not a bottom sheet. */
  centered?: boolean;
}) {
  const ff = useFormFactor();
  const t = useT();
  useEscape(open, onClose);
  const sheet = ff === "mobile" && !centered;
  const mobile = sheet;
  const vv = useVisualViewport(open && centered && ff === "mobile");
  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={cx("fixed inset-x-0 z-[200] flex justify-center", sheet ? "inset-y-0 items-end sm:items-center" : "items-center")}
          style={
            vv
              ? { top: vv.top, height: vv.height, paddingTop: "max(var(--safe-top), 12px)", paddingBottom: "max(var(--safe-bottom), 12px)" }
              : { top: 0, bottom: 0 }
          }
          data-testid={testId}
          data-centered={centered || undefined}
        >
          <motion.div
            className="absolute inset-0 bg-[rgba(20,20,30,0.28)] backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cx(
              "relative flex w-full flex-col bg-surface shadow-window",
              mobile ? "max-h-[92dvh] rounded-t-[28px] pb-[max(var(--safe-bottom),12px)]" : "mx-4 max-h-full rounded-[28px]",
              !vv && !mobile && "max-h-[92dvh]",
            )}
            style={mobile ? undefined : { maxWidth: width }}
            initial={mobile ? { y: "100%" } : { opacity: 0, scale: 0.96, y: 8 }}
            animate={mobile ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={mobile ? { y: "100%" } : { opacity: 0, scale: 0.97, y: 4 }}
            transition={{ duration: mobile ? 0.32 : 0.2, ease: EASE }}
            drag={mobile ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
            }}
          >
            {mobile && <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-border-strong" />}
            {title !== undefined && (
              <div className="flex shrink-0 items-center gap-3 px-6 pb-2 pt-5">
                <div className="flex-1 text-[19px] font-semibold tracking-tight">{title}</div>
                <IconButton label={t("common.close")} onClick={onClose} size="sm">
                  <RiCloseLine className="size-5" />
                </IconButton>
              </div>
            )}
            <div className="scroll-area min-h-0 flex-1 px-6 pb-5 pt-2">{children}</div>
            {footer && <div className="flex shrink-0 justify-end gap-2 border-t px-6 py-4">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  danger,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message?: string;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
}) {
  const t = useT();
  return (
    <Sheet open={open} onClose={onClose} title={title} width={420}>
      {message && <p className="text-[15px] text-text-secondary">{message}</p>}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading} data-testid="confirm-action">
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Popover menu (anchored dropdown)

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

export function usePopover() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return { open, setOpen, anchor, toggle: () => setOpen((o) => !o), close: () => setOpen(false) };
}

export function Popover({
  open,
  onClose,
  anchor,
  children,
  align = "end",
  width = 240,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: "start" | "end";
  width?: number;
  testId?: string;
}) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; maxHeight: number } | null>(null);
  useEscape(open, onClose);
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      const r = anchor.current!.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = align === "end" ? r.right - width : r.left;
      left = Math.max(8, Math.min(left, vw - width - 8));
      // Anchors in the lower part of the screen (bottom bars) open the menu upwards.
      const below = vh - r.bottom - 16;
      const above = r.top - 16;
      if (below < 260 && above > below) setPos({ bottom: vh - r.top + 8, left, maxHeight: above });
      else setPos({ top: r.bottom + 8, left, maxHeight: below });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, anchor, align, width]);

  return createPortal(
    <AnimatePresence>
      {open && pos && (
        <>
          <div className="fixed inset-0 z-[180]" onPointerDown={onClose} />
          <motion.div
            role="menu"
            data-testid={testId}
            className="scroll-area fixed z-[190] overflow-y-auto overflow-x-hidden rounded-2xl border border-border/70 bg-surface/95 p-1.5 shadow-float backdrop-blur-xl"
            style={{
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width,
              maxHeight: pos.maxHeight,
              transformOrigin: `${pos.bottom !== undefined ? "bottom" : "top"} ${align === "end" ? "right" : "left"}`,
            }}
            initial={{ opacity: 0, scale: 0.92, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -2 }}
            transition={{ duration: 0.16, ease: EASE }}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function MenuList({ items, onDone }: { items: MenuItem[]; onDone: () => void }) {
  return (
    <div className="flex flex-col">
      {items.map((item) => (
        <button
          key={item.id}
          role="menuitem"
          disabled={item.disabled}
          data-testid={`menu-${item.id}`}
          onClick={() => {
            onDone();
            item.onSelect();
          }}
          className={cx(
            "flex h-11 items-center gap-3 rounded-xl px-3 text-left text-[15px] transition-colors disabled:opacity-40",
            item.danger ? "text-danger hover:bg-danger-soft" : "text-text hover:bg-surface-hover",
          )}
        >
          {item.icon && <span className={cx("flex size-5 items-center justify-center", item.danger ? "text-danger" : "text-text-secondary")}>{item.icon}</span>}
          <span className="flex-1">{item.label}</span>
          {item.hint && <span className="text-[12px] text-text-tertiary">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts / banners

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: "default" | "success" | "danger";
  icon?: ReactNode;
  action?: { label: string; onClick: () => void };
  onClick?: () => void;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => number;
  dismiss: (id: number) => void;
}

let toastSeq = 0;
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts.slice(-2), { ...t, id }] });
    window.setTimeout(() => get().dismiss(id), t.duration ?? 3800);
    return id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (t: Omit<Toast, "id">) => useToasts.getState().push(t);

/** System banners, top-centre, like OS notifications. */
export function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[300] flex flex-col items-center gap-2 px-3 pt-[max(var(--safe-top),12px)]" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.96 }}
            transition={{ duration: 0.28, ease: EASE }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.8, bottom: 0 }}
            onDragEnd={(_, info) => info.offset.y < -30 && dismiss(t.id)}
            className="pointer-events-auto flex w-full max-w-[420px] items-center gap-3 rounded-[22px] border border-white/60 bg-surface/90 px-4 py-3 shadow-float backdrop-blur-xl"
            onClick={() => {
              if (t.onClick) {
                t.onClick();
                dismiss(t.id);
              }
            }}
            role="status"
            data-testid="toast"
          >
            {t.icon && <div className="shrink-0">{t.icon}</div>}
            <div className="min-w-0 flex-1">
              <div
                className={cx(
                  "truncate text-[14px] font-semibold",
                  t.tone === "danger" ? "text-danger" : t.tone === "success" ? "text-success" : "text-text",
                )}
              >
                {t.title}
              </div>
              {t.body && <div className="line-clamp-2 text-[13px] text-text-secondary">{t.body}</div>}
            </div>
            {t.action && (
              <button
                className="pressable shrink-0 rounded-xl px-3 py-1.5 text-[13px] font-semibold text-primary hover:bg-primary-soft"
                onClick={(e) => {
                  e.stopPropagation();
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
