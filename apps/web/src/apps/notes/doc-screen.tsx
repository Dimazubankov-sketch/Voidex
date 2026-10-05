import { useCallback, useEffect, useRef, useState } from "react";
import { RiArrowGoBackLine, RiArrowGoForwardLine, RiArrowLeftSLine, RiErrorWarningLine, RiLockLine, RiPlayFill, RiShareForwardLine } from "@remixicon/react";
import type { NotesBody, NotesDocumentDto, NoteBody, PresentationBody } from "@voidex/shared";
import { ErrorCode } from "@voidex/shared";
import { reflowPresentation, setNoteFormat, slideOverflows } from "@voidex/notes";
import { ApiError } from "@/lib/api";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { Button, Spinner } from "@/ui/controls";
import { toast } from "@/ui/overlays";
import { WindowHeader } from "@/os/window-context";
import { useDocActions } from "./browser";
import { invalidateNotes, notesApi } from "./data";
import { activeDoc } from "./editor-state";
import { MoreMenu, type MenuEntry } from "./kit";
import { NoteEditor } from "./note-editor";
import { PresentationEditor, PresentationViewer } from "./presentation";
import { useNav, type NotesRoute } from "./route";
import { useNotesSync } from "./sync";

type Back = Extract<NotesRoute, { screen: "doc" }>["back"];
type Status = "saved" | "dirty" | "saving" | "error" | "conflict";

/**
 * One open note or presentation. The body is saved by itself (debounced),
 * always against the revision it was based on: when someone else saved in
 * between, nothing is overwritten — a banner offers their version or keeping
 * mine. Their saves arrive in real time and are applied while I'm not editing.
 */
export function DocScreen({ docId, back }: { docId: string; back: Back }) {
  const t = useT();
  const nav = useNav();
  const [doc, setDoc] = useState<NotesDocumentDto | null>(null);
  const [body, setBody] = useState<NotesBody | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [status, setStatus] = useState<Status>("saved");
  const [conflict, setConflict] = useState<{ by: string; revision: number } | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [, setHistoryTick] = useState(0);

  const bodyRef = useRef<NotesBody | null>(null);
  const revision = useRef(0);
  const dirty = useRef(false);
  const locked = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conflictRef = useRef<typeof conflict>(null);
  conflictRef.current = conflict;
  const history = useRef<{ past: NotesBody[]; future: NotesBody[]; at: number }>({ past: [], future: [], at: 0 });
  const readOnly = !doc || doc.role === "viewer";

  const apply = useCallback((d: NotesDocumentDto) => {
    setDoc(d);
    setBody(d.data);
    bodyRef.current = d.data;
    revision.current = d.revision;
    dirty.current = false;
    setStatus("saved");
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await notesApi.document(docId));
      setFailed(null);
      setConflict(null);
    } catch (e) {
      setFailed(e);
    }
  }, [docId, apply]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Access changed under me: read-only now, or gone (the app closes it and says why). */
  const recheck = useCallback(async () => {
    try {
      const d = await notesApi.document(docId);
      if (d.role === "viewer") {
        toast({ title: t("notes.nowViewer"), tone: "default" });
        apply(d);
      }
      return d;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        useNotesSync.getState().push({ type: "notes.access.revoked", resourceType: "document", resourceId: docId, name: doc?.name ?? "" });
      }
      return null;
    }
  }, [docId, apply, t, doc?.name]);

  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) await saving.current;
    if (!dirty.current) return true;
    if (locked.current || conflictRef.current || !bodyRef.current) return false;
    const sent = bodyRef.current;
    const run = (async () => {
      setStatus("saving");
      try {
        const r = await notesApi.save(docId, sent, revision.current);
        revision.current = r.revision;
        if (bodyRef.current === sent) {
          dirty.current = false;
          setStatus("saved");
        } else setStatus("dirty");
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.code === ErrorCode.NotesConflict) {
          const c = { by: String(e.details.by ?? ""), revision: Number(e.details.revision ?? 0) };
          conflictRef.current = c;
          setConflict(c);
          setStatus("conflict");
        } else if (e instanceof ApiError && (e.code === ErrorCode.NotesAccessRevoked || e.status === 403 || e.status === 404)) {
          await recheck();
        } else {
          setStatus("error");
          if (e instanceof ApiError && e.code === ErrorCode.NotesTooLarge) toast({ title: errorMessage(t, e), tone: "danger" });
        }
        return false;
      }
    })();
    saving.current = run;
    const ok = await run;
    saving.current = null;
    if (ok && dirty.current) schedule(400);
    return ok && !dirty.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, recheck, t]);

  const schedule = (ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void save();
    }, ms);
  };

  // Offline / failed save: try again shortly.
  useEffect(() => {
    if (status !== "error") return;
    const id = setTimeout(() => void save(), 5000);
    return () => clearTimeout(id);
  }, [status, save]);

  const change = useCallback((next: NotesBody, structural = false) => {
    if (locked.current || !bodyRef.current) return;
    const h = history.current;
    const now = Date.now();
    if (structural || now - h.at > 900) {
      h.past.push(bodyRef.current);
      if (h.past.length > 200) h.past.shift();
      h.future = [];
      setHistoryTick((x) => x + 1);
    }
    h.at = now;
    bodyRef.current = next;
    setBody(next);
    dirty.current = true;
    setStatus((s) => (s === "conflict" ? s : "dirty"));
    schedule(structural ? 350 : 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const undo = () => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev || !bodyRef.current) return;
    h.future.push(bodyRef.current);
    h.at = 0;
    bodyRef.current = prev;
    setBody(prev);
    dirty.current = true;
    setStatus("dirty");
    setHistoryTick((x) => x + 1);
    schedule(500);
  };
  const redo = () => {
    const h = history.current;
    const next = h.future.pop();
    if (!next || !bodyRef.current) return;
    h.past.push(bodyRef.current);
    h.at = 0;
    bodyRef.current = next;
    setBody(next);
    dirty.current = true;
    setStatus("dirty");
    setHistoryTick((x) => x + 1);
    schedule(500);
  };

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    return save();
  }, [save]);

  // The shell asks this before closing / switching (and locks it when access is gone).
  useEffect(() => {
    if (!doc) return;
    activeDoc.current = {
      docId,
      projectId: doc.projectId,
      isDirty: () => dirty.current,
      flush,
      lock: () => {
        locked.current = true;
        dirty.current = false;
        if (timer.current) clearTimeout(timer.current);
      },
    };
    return () => {
      if (activeDoc.current?.docId === docId) activeDoc.current = null;
    };
  }, [doc, docId, flush]);

  // Leaving the screen with something pending: save it on the way out.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current && !locked.current) void save();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Someone else saved / access changed (server events, no polling).
  const seq = useNotesSync((s) => s.seq);
  useEffect(() => {
    const e = useNotesSync.getState().event;
    if (!e || !doc) return;
    if (e.type === "notes.document.updated" && e.documentId === docId && e.revision > revision.current) {
      if (!dirty.current && !saving.current) {
        void notesApi.document(docId).then((d) => {
          if (!dirty.current && d.revision > revision.current) apply(d);
        });
      } else {
        const c = { by: e.byName, revision: e.revision };
        conflictRef.current = c;
        setConflict(c);
        setStatus("conflict");
      }
    }
    if (e.type === "notes.share.updated" && (e.resourceId === docId || e.resourceId === doc.projectId)) {
      void notesApi.document(docId).then(
        (d) => {
          if (d.role === doc.role) return;
          if (d.role === "viewer") toast({ title: t("notes.nowViewer"), tone: "default" });
          else if (doc.role === "viewer") toast({ title: t("notes.nowEditor"), tone: "success" });
          if (!dirty.current) apply(d);
          else setDoc((x) => (x ? { ...x, role: d.role } : x));
        },
        () => undefined,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  const leave = async () => {
    if (dirty.current && !(await flush()) && !locked.current) {
      toast({ title: conflictRef.current ? t("notes.conflict.resolveFirst") : t("closeGuard.saveFailed"), tone: "danger" });
      return;
    }
    nav.go(back);
    void invalidateNotes();
  };

  const actions = useDocActions(back.screen === "projects" ? null : back, {
    deleted: () => {
      locked.current = true;
      dirty.current = false;
      nav.go(back);
    },
    edited: ({ name, cover }) => setDoc((d) => (d ? { ...d, name, cover } : d)),
    flush,
  });

  if (failed)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <WindowHeader>
          <BackButton onClick={() => nav.go(back)} />
        </WindowHeader>
        <div className="grid flex-1 place-items-center px-6" data-testid="notes-doc-denied">
          <div className="flex max-w-[340px] flex-col items-center gap-3 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-danger-soft text-danger">
              <RiLockLine className="size-7" />
            </span>
            <h2 className="text-[19px] font-semibold text-text">{failed instanceof ApiError && failed.status === 404 ? t("notes.revoked.title") : t("notes.loadFailed")}</h2>
            <p className="text-[14.5px] text-text-secondary">{failed instanceof ApiError && failed.status === 404 ? t("notes.doc.noAccess") : errorMessage(t, failed)}</p>
            <Button variant="secondary" className="mt-2" onClick={() => nav.go(back)}>
              {t("common.back")}
            </Button>
          </div>
        </div>
      </div>
    );

  if (!doc || !body)
    return (
      <div className="grid flex-1 place-items-center" data-testid="notes-doc-loading">
        <Spinner />
      </div>
    );

  const isNote = body.kind === "note";
  const formatEntries: MenuEntry[] = readOnly
    ? []
    : isNote
      ? [
          { id: "format-vertical", label: t("notes.format.vertical"), checked: body.format === "vertical", onSelect: () => change(setNoteFormat(body as NoteBody, "vertical"), true) },
          { id: "format-square", label: t("notes.format.square"), checked: body.format === "square", onSelect: () => change(setNoteFormat(body as NoteBody, "square"), true) },
        ]
      : [
          { id: "format-rect", label: t("notes.format.rect"), checked: body.format === "rect", onSelect: () => switchSlides("rect") },
          { id: "format-square", label: t("notes.format.squareSlides"), checked: body.format === "square", onSelect: () => switchSlides("square") },
        ];
  function switchSlides(f: PresentationBody["format"]) {
    const next = reflowPresentation(body as PresentationBody, f);
    change(next, true);
    const n = next.slides.filter((s) => slideOverflows(s, f)).length;
    if (n) toast({ title: t("notes.pres.overflowAfterSwitch", { n }), tone: "default" });
  }
  const meta = doc;
  const menu: MenuEntry[] = [
    ...(!isNote ? [{ id: "play", label: t("notes.pres.play"), icon: <RiPlayFill className="size-[18px]" />, onSelect: () => setPlaying(0) }] : []),
    ...formatEntries.map((e, i) => (i === 0 && !isNote ? { ...e, divider: true } : e)),
    ...actions.entries(meta, null).map((e, i) => (i === 0 && formatEntries.length ? { ...e, divider: true } : e)),
  ];
  const statusText = readOnly
    ? t("notes.status.readOnly")
    : { saved: t("notes.status.saved"), dirty: t("notes.status.dirty"), saving: t("notes.status.saving"), error: t("notes.status.error"), conflict: t("notes.status.conflict") }[status];

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-testid="notes-doc"
      data-doc={docId}
      data-kind={body.kind}
      data-role={doc.role}
      onKeyDownCapture={(e) => {
        if (readOnly || !(e.metaKey || e.ctrlKey)) return;
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((k === "z" && e.shiftKey) || k === "y") {
          e.preventDefault();
          redo();
        } else if (k === "s") {
          e.preventDefault();
          void flush();
        }
      }}
    >
      <WindowHeader
        className={cx("vn2-doc-top pointer-events-none absolute inset-x-0 top-0 z-30 [&>*]:pointer-events-auto", !isNote && "vn2-doc-top-pres")}
        menu={false}
        right={
          <div className="vn2-float flex items-center gap-0.5 rounded-full p-1">
            {!readOnly && (
              <>
                <button type="button" onClick={undo} disabled={!history.current.past.length} aria-label={t("notes.undo")} title={t("notes.undo")} className="vn2-icon-btn size-9" data-testid="notes-undo">
                  <RiArrowGoBackLine className="size-[18px]" />
                </button>
                <button type="button" onClick={redo} disabled={!history.current.future.length} aria-label={t("notes.redo")} title={t("notes.redo")} className="vn2-icon-btn size-9" data-testid="notes-redo">
                  <RiArrowGoForwardLine className="size-[18px]" />
                </button>
              </>
            )}
            {doc.role === "owner" && (
              <button type="button" onClick={() => actions.share(meta)} aria-label={t("notes.share")} title={t("notes.share")} className="vn2-icon-btn size-9" data-testid="notes-doc-share">
                <RiShareForwardLine className="size-[18px]" />
              </button>
            )}
            <MoreMenu items={menu} label={t("notes.more")} className="size-9" width={260} win />
          </div>
        }
      >
        <BackButton onClick={() => void leave()} />
        <button
          type="button"
          onClick={() => !readOnly && actions.edit(meta)}
          className="flex min-w-0 flex-col items-start rounded-xl px-1.5 py-0.5 text-left"
          data-testid="notes-doc-title"
          data-no-drag
        >
          <span className="max-w-full truncate text-[15px] font-semibold leading-tight text-text">{doc.name}</span>
          <span className={cx("flex items-center gap-1 text-[12px] leading-tight", status === "error" || status === "conflict" ? "text-danger" : "text-text-tertiary")} data-testid="notes-save-status" data-status={readOnly ? "readonly" : status}>
            {readOnly && <RiLockLine className="size-3" />}
            {statusText}
          </span>
        </button>
      </WindowHeader>

      {conflict && (
        <div className="absolute inset-x-3 top-[62px] z-30 mx-auto flex max-w-[620px] flex-wrap items-center gap-2 rounded-2xl bg-surface px-4 py-3 shadow-float" data-testid="notes-conflict">
          <RiErrorWarningLine className="size-5 shrink-0 text-warning" />
          <span className="min-w-0 flex-1 text-[14px] text-text">{t("notes.conflict.text", { name: conflict.by || t("notes.someone") })}</span>
          <span className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void load()} data-testid="notes-conflict-theirs">
              {t("notes.conflict.theirs")}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                revision.current = conflict.revision;
                conflictRef.current = null;
                setConflict(null);
                dirty.current = true;
                void save();
              }}
              data-testid="notes-conflict-mine"
            >
              {t("notes.conflict.mine")}
            </Button>
          </span>
        </div>
      )}

      {body.kind === "note" ? (
        <NoteEditor body={body} onChange={change} readOnly={readOnly} />
      ) : (
        <PresentationEditor body={body} onChange={change} readOnly={readOnly} onPlay={(from) => setPlaying(from)} />
      )}
      {playing !== null && body.kind === "presentation" && <PresentationViewer body={body} start={playing} onClose={() => setPlaying(null)} />}
      {actions.sheets}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} aria-label={t("common.back")} className="vn2-float grid size-10 shrink-0 place-items-center rounded-full text-text" data-testid="notes-back" data-no-drag>
      <RiArrowLeftSLine className="size-6" />
    </button>
  );
}
