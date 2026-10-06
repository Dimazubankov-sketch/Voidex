'use client';
import { Dialog, DialogPortal } from '../../components/ui/dialog';
import { Dialog as Primitive } from 'radix-ui';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
export function FileModal({
  open,
  onClose,
  children,
  share = false,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  share?: boolean;
}) {
  const [viewport, setViewport] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const v = window.visualViewport;
    if (!open || !v) return;
    const update = () => {
      if (Math.abs(v.scale - 1) < 0.05) setViewport({ top: v.offsetTop + v.height / 2, height: v.height - 24 });
    };
    update();
    v.addEventListener('resize', update);
    v.addEventListener('scroll', update);
    return () => {
      v.removeEventListener('resize', update);
      v.removeEventListener('scroll', update);
    };
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogPortal>
        <Primitive.Overlay className="vf-modal-overlay" />
        <Primitive.Content
          style={viewport ? { top: viewport.top, maxHeight: viewport.height } : undefined}
          className={'vf-modal ' + (share ? 'vf-modal-share' : '')}
        >
          <button className="vf-icon vf-modal-close" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
          {children}
        </Primitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
