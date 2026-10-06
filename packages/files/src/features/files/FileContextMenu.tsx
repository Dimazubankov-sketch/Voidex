'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { Dialog, DialogPortal, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { Dialog as Primitive } from 'radix-ui';
export function menuPlacement(
  r: { left: number; right: number; top: number; bottom: number },
  width: number,
  height: number,
  menuHeight: number,
) {
  const pad = 12,
    gap = 14,
    w = Math.min(238, width - pad * 2),
    right = width - pad - r.right - gap,
    left = r.left - gap - pad,
    bottom = height - pad - r.bottom - gap,
    top = r.top - gap - pad;
  if (right >= w)
    return { left: r.right + gap, top: Math.max(pad, Math.min(r.top, height - pad - menuHeight)), width: w, maxHeight: height - pad * 2 };
  if (left >= w)
    return {
      left: r.left - gap - w,
      top: Math.max(pad, Math.min(r.top, height - pad - menuHeight)),
      width: w,
      maxHeight: height - pad * 2,
    };
  const below = bottom >= top,
    space = Math.max(48, below ? bottom : top),
    h = Math.min(menuHeight, space);
  return {
    left: Math.max(pad, Math.min((r.left + r.right - w) / 2, width - pad - w)),
    top: below ? r.bottom + gap : r.top - gap - h,
    width: w,
    maxHeight: space,
  };
}
export function FileContextMenu({
  anchor,
  name,
  onClose,
  children,
}: {
  anchor: HTMLElement | null;
  name: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [position, setPosition] = useState<ReturnType<typeof menuPlacement> | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const update = () => {
      const v = window.visualViewport,
        r = anchor.getBoundingClientRect(),
        h = ref.current?.scrollHeight || 360;
      setPosition(menuPlacement(r, v?.width || innerWidth, (v?.height || innerHeight) + (v?.offsetTop || 0), h));
    };
    update();
    const frame = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
    };
  }, [anchor]);
  return (
    <Dialog
      open={!!anchor}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogPortal>
        <Primitive.Overlay className="vf-context-overlay" onPointerDown={onClose} />
        <Primitive.Content
          ref={ref}
          className="vf-context-panel"
          style={position ? { ...position, visibility: 'visible' } : { visibility: 'hidden' }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
          }}
          onKeyDown={(e) => {
            const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []),
              i = buttons.indexOf(document.activeElement as HTMLButtonElement);
            let next: number | undefined;
            if (e.key === 'ArrowDown') next = (i + 1) % buttons.length;
            if (e.key === 'ArrowUp') next = (i - 1 + buttons.length) % buttons.length;
            if (e.key === 'Home') next = 0;
            if (e.key === 'End') next = buttons.length - 1;
            if (next !== undefined) {
              e.preventDefault();
              buttons[next]?.focus();
            }
          }}
        >
          <DialogTitle className="sr-only">Действия: {name}</DialogTitle>
          <DialogDescription className="sr-only">Выберите действие с файлом.</DialogDescription>
          <div className="vf-context-actions" onClick={onClose}>
            {children}
          </div>
        </Primitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
