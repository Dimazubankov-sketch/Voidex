import { useEffect, useMemo, useRef, useState } from "react";
import { RiArrowLeftLine } from "@remixicon/react";
import { NotesApp as VoidexNotes, NotesConflictError, type NotesAdapter, type NotesController } from "@voidex/notes";
import "@voidex/notes/styles.css";
import "./notes-voidex.css";
import { ErrorCode } from "@voidex/shared";
import { api, ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { toast } from "@/ui/overlays";
import { askUnsaved } from "@/os/close-guard";
import { WindowMenuButton, useWindow } from "@/os/window-context";
import { setBeforeClose } from "@/os/window-manager";
import { useNotesSync } from "./sync";

/** Errors from the VOIDEX API in the words of the person's language. */
function rethrow(t: ReturnType<typeof useT>) {
  return (e: unknown): never => {
    if (e instanceof ApiError && e.code === ErrorCode.NotesConflict) throw new NotesConflictError(Number(e.details.revision) || undefined);
    throw new Error(errorMessage(t, e));
  };
}

/**
 * The Notes adapter for VOIDEX: everything goes through the signed-in session
 * (Bearer token, CSRF header, the account from the session — never a user id
 * from here). Images are private: `media` reads them with the session and the
 * editor shows them from local object URLs.
 */
function voidexAdapter(t: ReturnType<typeof useT>): NotesAdapter {
  const fail = rethrow(t);
  return {
    load: () => api.get<{ data: never; revision: number }>("/api/notes").catch(fail),
    save: (data, revision) =>
      api
        .put<{ revision: number }>("/api/notes", { data, revision })
        .then((r) => r.revision)
        .catch(fail),
    upload: (file) =>
      api
        .post<{ url: string }>("/api/notes/media", file, { headers: { "Content-Type": file.type || "application/octet-stream" } })
        .then((r) => r.url)
        .catch(fail),
    media: (src) => api.get<Blob>(src).catch(fail),
    createShare: (data) =>
      api
        .post<{ token: string }>("/api/notes/shares", { data })
        .then((r) => r.token)
        .catch(fail),
    readShare: (token) => api.get<never>(`/api/notes/shares/${encodeURIComponent(token)}`).catch(fail),
    revokeShare: (token) =>
      api
        .delete(`/api/notes/shares/${encodeURIComponent(token)}`)
        .then(() => undefined)
        .catch(fail),
  };
}

/**
 * Voidex Notes inside a VOIDEX window (Step 2.5): the Notes package rendered
 * natively in this component (no iframe, no second React root), lazy-loaded
 * with its own chunk. The window keeps its header for dragging; closing with
 * unsaved changes asks first; a save from another device shows up here.
 */
export function NotesApp() {
  const t = useT();
  const win = useWindow();
  const adapter = useMemo(() => voidexAdapter(t), [t]);
  const controller = useRef<NotesController | null>(null);
  const remoteRevision = useNotesSync((s) => s.seq);
  const [share, setShare] = useState<string | null>(typeof win.params.share === "string" ? win.params.share : null);

  // A shared link opened while Notes is open: save my changes first, then show it.
  useEffect(() => {
    const next = typeof win.params.share === "string" ? win.params.share : null;
    if (!next || next === share) return;
    void (async () => {
      if (controller.current?.isDirty() && !(await controller.current.flush())) {
        toast({ title: t("closeGuard.saveFailed"), tone: "danger" });
        return;
      }
      setShare(next);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.paramsVersion]);

  // Closing with unsaved changes: save, discard or stay.
  useEffect(() => {
    setBeforeClose(win.windowId, async () => {
      const c = controller.current;
      if (!c?.isDirty()) return true;
      const answer = await askUnsaved(t("notes.name"));
      if (answer === "cancel") return false;
      if (answer === "discard") return true;
      if (await c.flush()) return true;
      toast({ title: t("closeGuard.saveFailed"), tone: "danger" });
      return false;
    });
    return () => setBeforeClose(win.windowId, null);
  }, [win.windowId, t]);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-testid="notes-app"
      onPointerDown={(e) => {
        // PC: the Notes header is the window's title bar.
        if (win.formFactor !== "desktop") return;
        const el = e.target as HTMLElement;
        if (!el.closest(".vn-header") || el.closest("button, input, a, select, textarea, [role=tab], [role=tablist], [data-no-drag]")) return;
        win.startDrag?.(e);
      }}
      onDoubleClick={(e) => {
        if (win.formFactor !== "desktop") return;
        const el = e.target as HTMLElement;
        if (!el.closest(".vn-header") || el.closest("button, input, a, select, textarea, [role=tab], [data-no-drag]")) return;
        win.toggleMaximize();
      }}
    >
      {share && (
        <div className="flex shrink-0 items-center gap-3 border-b bg-primary-soft px-4 py-2 text-[13px] text-primary-strong" data-testid="notes-share-banner">
          <span className="min-w-0 flex-1 truncate">{t("notes.sharedView")}</span>
          <button type="button" className="inline-flex items-center gap-1 font-semibold" onClick={() => setShare(null)} data-testid="notes-share-exit">
            <RiArrowLeftLine className="size-4" /> {t("notes.backToMine")}
          </button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <VoidexNotes
          adapter={adapter}
          logoUrl="/brand/app-notes.png"
          embedded
          share={share}
          shareLink={(token) => `${window.location.origin}/#notes/share/${token}`}
          remoteRevision={remoteRevision}
          controllerRef={controller}
          headerEnd={<WindowMenuButton />}
        />
      </div>
    </div>
  );
}
