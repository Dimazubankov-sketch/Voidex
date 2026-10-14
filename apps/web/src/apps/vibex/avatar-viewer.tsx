import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { RiCloseLine } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { usePinch } from "./pinch";

/**
 * Step 2.12: a profile photo, full screen: just the picture and a close
 * button (X, Esc or a tap outside), two fingers zoom it. No download or save
 * button and no browser image menu: the photo is shown, not handed out.
 */
export function AvatarViewer({ person, onClose }: { person: { id: string; name: string; avatarVersion: number } | null; onClose: () => void }) {
  const t = useT();
  const { data: src } = useQuery({
    queryKey: ["avatar", person?.id, person?.avatarVersion],
    enabled: !!person && person.avatarVersion > 0,
    staleTime: Infinity,
    queryFn: async () => URL.createObjectURL(await api.get<Blob>(`/api/users/${person!.id}/avatar`)),
  });
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  usePinch(box, { enabled: !!person, begin: () => zoomRef.current, change: (z) => setZoom(Math.max(1, Math.min(4, z))) });
  useEffect(() => {
    if (!person) return setZoom(1);
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [person, onClose]);
  return createPortal(
    <AnimatePresence>
      {person && (
        <motion.div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-[rgba(8,8,14,0.94)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={person.name}
          data-testid="avatar-viewer"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="absolute right-3 top-[max(var(--safe-top),12px)] flex size-11 items-center justify-center rounded-full bg-white/12 text-white"
            data-testid="avatar-viewer-close"
          >
            <RiCloseLine className="size-6" />
          </button>
          <motion.div
            ref={box}
            initial={{ scale: 0.86 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.9 }}
            className="aspect-square w-[min(88vw,560px)] touch-none select-none overflow-hidden rounded-full [-webkit-touch-callout:none]"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {src && <img src={src} alt="" draggable={false} className="size-full object-cover" style={{ transform: zoom > 1 ? `scale(${zoom})` : undefined }} data-testid="avatar-viewer-image" />}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
