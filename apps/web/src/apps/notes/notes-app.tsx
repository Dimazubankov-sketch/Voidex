import { Suspense, lazy, useEffect, useState } from "react";
import { RiLockLine } from "@remixicon/react";
import { useT } from "@/lib/i18n";
import { Button, Spinner } from "@/ui/controls";
import { Sheet, toast } from "@/ui/overlays";
import { askUnsaved } from "@/os/close-guard";
import { useWindow } from "@/os/window-context";
import { setBeforeClose } from "@/os/window-manager";
import { invalidateNotes } from "./data";
import { activeDoc } from "./editor-state";
import { ProjectScreen, ProjectsScreen, SharedScreen } from "./browser";
import { NavContext, createNotesNav, routeFromParams, type NotesRoute } from "./route";
import { ShareLanding } from "./share-landing";
import { useNotesSync } from "./sync";
import "./notes.css";

const DocScreen = lazy(() => import("./doc-screen").then((m) => ({ default: m.DocScreen })));

/**
 * Voidex Notes (Step 2.6): Projects → a project's notes and presentations →
 * one document. The route has its own store (see route.ts), so saving,
 * server events and window re-renders never move the person out of what
 * they are writing; only their own action or a revoked access does.
 */
export function NotesApp() {
  const t = useT();
  const win = useWindow();
  const [nav] = useState(() => createNotesNav(routeFromParams(win.params) ?? { screen: "projects" }));
  const route = nav((s) => s.route);
  const [closed, setClosed] = useState<null | { title: string; body: string }>(null);

  // A deep link / card opened while Notes is open: save the open document first, then go.
  useEffect(() => {
    const next = routeFromParams(win.params);
    if (!next) return;
    void (async () => {
      if (activeDoc.current?.isDirty() && !(await activeDoc.current.flush())) {
        toast({ title: t("closeGuard.saveFailed"), tone: "danger" });
        return;
      }
      nav.getState().go(next);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.paramsVersion]);

  // Closing the window with unsaved changes: save, discard or stay.
  useEffect(() => {
    setBeforeClose(win.windowId, async () => {
      const c = activeDoc.current;
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

  // Realtime: access removed / resource deleted → close what is open right away and say why.
  const seq = useNotesSync((s) => s.seq);
  useEffect(() => {
    const e = useNotesSync.getState().event;
    if (!e) return;
    if (e.type !== "notes.access.revoked" && e.type !== "notes.resource.deleted") return;
    const r = nav.getState().route;
    const open = activeDoc.current;
    const hits =
      (r.screen === "doc" && (r.docId === e.resourceId || (e.resourceType === "project" && open?.projectId === e.resourceId))) ||
      (r.screen === "project" && e.resourceType === "project" && r.projectId === e.resourceId);
    void invalidateNotes();
    if (!hits) return;
    activeDoc.current?.lock();
    activeDoc.current = null;
    nav.getState().go({ screen: "projects" });
    setClosed(
      e.type === "notes.access.revoked"
        ? { title: t("notes.revoked.title"), body: t("notes.revoked.body", { name: e.name }) }
        : { title: t("notes.deleted.title"), body: t("notes.deleted.body", { name: e.name }) },
    );
  }, [seq, nav, t]);

  return (
    <NavContext.Provider value={nav}>
      <div className="vn2 vx-app-bg relative flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="notes-app" data-screen={route.screen}>
        <Screen route={route} />
        <Sheet open={!!closed} onClose={() => setClosed(null)} width={420} testId="notes-access-closed">
          {closed && (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <span className="grid size-14 place-items-center rounded-full bg-danger-soft text-danger">
                <RiLockLine className="size-7" />
              </span>
              <h2 className="text-[19px] font-semibold text-text">{closed.title}</h2>
              <p className="text-[14.5px] text-text-secondary">{closed.body}</p>
              <Button className="mt-2 w-full" onClick={() => setClosed(null)} data-testid="notes-access-closed-ok">
                {t("notes.ok")}
              </Button>
            </div>
          )}
        </Sheet>
      </div>
    </NavContext.Provider>
  );
}

function Screen({ route }: { route: NotesRoute }) {
  switch (route.screen) {
    case "projects":
      return <ProjectsScreen />;
    case "project":
      return <ProjectScreen projectId={route.projectId} key={route.projectId} />;
    case "shared":
      return <SharedScreen />;
    case "share":
      return <ShareLanding token={route.token} key={route.token} />;
    case "doc":
      return (
        <Suspense
          fallback={
            <div className="grid flex-1 place-items-center">
              <Spinner />
            </div>
          }
        >
          {/* Keyed by the document: switching documents remounts; saving never does. */}
          <DocScreen docId={route.docId} back={route.back} key={route.docId} />
        </Suspense>
      );
  }
}
