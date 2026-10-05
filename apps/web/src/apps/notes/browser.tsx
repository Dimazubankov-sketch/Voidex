import { useMemo, useState, type ReactNode } from "react";
import {
  RiDeleteBinLine,
  RiFileTextLine,
  RiGalleryView2,
  RiGroupLine,
  RiImageEditLine,
  RiImageLine,
  RiListCheck,
  RiPencilLine,
  RiPresentationLine,
  RiShareForwardLine,
  RiSlideshowLine,
  RiUserShared2Line,
} from "@remixicon/react";
import type { NotesDocKind, NotesDocMetaDto, NotesPrefsDto, NotesProjectDto } from "@voidex/shared";
import { emptyPresentation, notesExt } from "@voidex/shared";
import { noteToPresentation } from "@voidex/notes";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { cx } from "@/lib/cx";
import { EmptyState, Skeleton } from "@/ui/controls";
import { ConfirmDialog, toast } from "@/ui/overlays";
import { invalidateNotes, notesApi, usePrefs, useProject, useProjects } from "./data";
import { BottomBar, CoverSheet, DocCover, MoreMenu, NotesHeader, ProjectCover, useAgo, type MenuEntry } from "./kit";
import { useNav } from "./route";
import { MembersSheet, ShareSheet, type ShareTarget } from "./share";

type Sort = NotesPrefsDto["projectsSort"];
type View = NotesPrefsDto["projectsView"];

interface Sortable {
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export function sortItems<T extends Sortable>(items: T[], sort: Sort): T[] {
  const out = [...items];
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  switch (sort) {
    case "name":
      return out.sort((a, b) => collator.compare(a.name, b.name));
    case "modified":
      return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    case "created":
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    default:
      return out.sort((a, b) => a.position - b.position);
  }
}

const matches = (q: string, ...texts: string[]) => {
  const s = q.trim().toLocaleLowerCase();
  return !s || texts.some((x) => x.toLocaleLowerCase().includes(s));
};

/** View (grid / list) and sort entries of a "…" menu. */
function useViewSortEntries(view: View, sort: Sort, set: (v: { view?: View; sort?: Sort }) => void): MenuEntry[] {
  const t = useT();
  return [
    { id: "view-grid", label: t("notes.view.grid"), icon: <RiGalleryView2 className="size-[18px]" />, checked: view === "grid", onSelect: () => set({ view: "grid" }) },
    { id: "view-list", label: t("notes.view.list"), icon: <RiListCheck className="size-[18px]" />, checked: view === "list", onSelect: () => set({ view: "list" }) },
    { id: "sort-custom", label: t("notes.sort.custom"), checked: sort === "custom", onSelect: () => set({ sort: "custom" }), divider: true },
    { id: "sort-modified", label: t("notes.sort.modified"), checked: sort === "modified", onSelect: () => set({ sort: "modified" }) },
    { id: "sort-created", label: t("notes.sort.created"), checked: sort === "created", onSelect: () => set({ sort: "created" }) },
    { id: "sort-name", label: t("notes.sort.name"), checked: sort === "name", onSelect: () => set({ sort: "name" }) },
  ];
}

/** Grid or list of cards, the same frame for projects and documents. */
function Items({ view, children, testId }: { view: View; children: ReactNode; testId: string }) {
  return (
    <div className={view === "grid" ? "vn2-grid" : "flex flex-col"} data-testid={testId} data-view={view}>
      {children}
    </div>
  );
}

/**
 * One card. Grid: a square cover with the name and details below. List: a
 * row with a small cover. Custom order: drag a card onto another (PC) or use
 * "Move" in its menu (touch).
 */
function Card({
  view,
  cover,
  title,
  meta,
  badge,
  menu,
  onOpen,
  testId,
  drag,
}: {
  view: View;
  cover: ReactNode;
  title: string;
  meta: ReactNode;
  badge?: ReactNode;
  menu: ReactNode;
  onOpen: () => void;
  testId: string;
  drag?: { onDrop: (fromId: string) => void; id: string };
}) {
  const [over, setOver] = useState(false);
  const dnd = drag
    ? {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          e.dataTransfer.setData("text/x-voidex-notes", drag.id);
          e.dataTransfer.effectAllowed = "move";
        },
        onDragOver: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes("text/x-voidex-notes")) return;
          e.preventDefault();
          setOver(true);
        },
        onDragLeave: () => setOver(false),
        onDrop: (e: React.DragEvent) => {
          setOver(false);
          const from = e.dataTransfer.getData("text/x-voidex-notes");
          if (from && from !== drag.id) {
            e.preventDefault();
            drag.onDrop(from);
          }
        },
      }
    : {};
  if (view === "list")
    return (
      <div className={cx("vn2-row group relative flex items-center gap-3.5 rounded-2xl px-2 py-2", over && "ring-2 ring-primary/50")} data-testid={testId} {...dnd}>
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3.5 text-left" data-testid={`${testId}-open`}>
          <span className="relative size-[64px] shrink-0 overflow-hidden rounded-[16px] shadow-[0_1px_3px_rgba(30,20,80,0.12)]">{cover}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[16px] font-medium text-text">{title}</span>
              {badge}
            </span>
            <span className="truncate text-[13.5px] text-text-tertiary">{meta}</span>
          </span>
        </button>
        {menu}
      </div>
    );
  return (
    <div className={cx("group relative flex min-w-0 flex-col gap-2", over && "rounded-[24px] ring-2 ring-primary/50")} data-testid={testId} {...dnd}>
      <button type="button" onClick={onOpen} className="vn2-cover relative block aspect-square w-full overflow-hidden rounded-[22px] text-left" data-testid={`${testId}-open`}>
        {cover}
      </button>
      <div className="absolute right-1.5 top-1.5 [&>button]:size-9 [&>button]:bg-[rgba(255,255,255,0.78)] [&>button]:text-[#3a3650] [&>button]:shadow-sm [&>button]:backdrop-blur">{menu}</div>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-col px-1 text-left" tabIndex={-1}>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold leading-tight text-text">{title}</span>
          {badge}
        </span>
        <span className="truncate text-[13px] text-text-tertiary">{meta}</span>
      </button>
    </div>
  );
}

const SharedBadge = () => <RiUserShared2Line className="size-[15px] shrink-0 text-primary" aria-label="shared" data-testid="notes-shared-badge" />;

/** New position for "custom" order: put `from` right before `to`. */
function positionBefore<T extends { id: string; position: number }>(list: T[], fromId: string, toId: string): number | null {
  const rest = list.filter((x) => x.id !== fromId);
  const i = rest.findIndex((x) => x.id === toId);
  if (i < 0) return null;
  const prev = rest[i - 1];
  const next = rest[i]!;
  if (!prev) return next.position - 1;
  // Integer positions: leave room by spreading when neighbours touch.
  return prev.position + 1 < next.position ? Math.floor((prev.position + next.position) / 2) : null;
}

async function reorder<T extends { id: string; position: number }>(list: T[], fromId: string, toId: string, save: (id: string, position: number) => Promise<unknown>) {
  const p = positionBefore(list, fromId, toId);
  if (p !== null) {
    await save(fromId, p);
  } else {
    // Renumber everything (10 apart) in the new order.
    const rest = list.filter((x) => x.id !== fromId);
    const from = list.find((x) => x.id === fromId)!;
    rest.splice(rest.findIndex((x) => x.id === toId), 0, from);
    await Promise.all(rest.map((x, i) => (x.position === i * 10 ? null : save(x.id, i * 10))));
  }
  await invalidateNotes();
}

function moveBy<T extends { id: string; position: number }>(list: T[], id: string, delta: -1 | 1, save: (id: string, position: number) => Promise<unknown>) {
  const i = list.findIndex((x) => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  const target = delta < 0 ? list[j]! : list[j + 1];
  if (target) void reorder(list, id, target.id, save);
  else void save(id, list[list.length - 1]!.position + 1).then(invalidateNotes);
}

// ---------------------------------------------------------------------------
// Projects

export function ProjectsScreen() {
  const t = useT();
  const nav = useNav();
  const ago = useAgo();
  const q = useProjects();
  const { prefs, set } = usePrefs();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const actions = useProjectActions();
  const view = prefs.projectsView;
  const sort = prefs.projectsSort;
  const menu = useViewSortEntries(view, sort, (v) => set({ ...(v.view ? { projectsView: v.view } : {}), ...(v.sort ? { projectsSort: v.sort } : {}) }));
  const projects = useMemo(() => sortItems(q.data?.projects ?? [], sort), [q.data, sort]);
  const shown = projects.filter((p) => matches(query, p.name));
  const shared = q.data?.sharedDocuments ?? [];
  const sharedShown = shared.length > 0 && matches(query, t("notes.sharedWithMe"), ...shared.map((d) => d.name));
  const own = projects.filter((p) => p.role === "owner");

  return (
    <>
      <NotesHeader right={<MoreMenu items={menu} label={t("notes.more")} win />} />
      <div className="vn2-scroll scroll-area min-h-0 flex-1" data-testid="notes-projects">
        <div className="mx-auto w-full max-w-[1120px] px-4 pb-28 pt-1">
          <h1 className="mb-3 px-1 text-[26px] font-bold tracking-tight text-text">{t("notes.projects")}</h1>
          {q.isLoading ? (
            <Items view={view} testId="notes-projects-loading">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className={view === "grid" ? "aspect-square rounded-[22px]" : "h-20 rounded-2xl"} />
              ))}
            </Items>
          ) : q.isError ? (
            <EmptyState icon={<RiFileTextLine className="size-7" />} title={errorMessage(t, q.error)} />
          ) : shown.length === 0 && !sharedShown ? (
            <EmptyState
              icon={<RiFileTextLine className="size-7" />}
              title={query ? t("notes.nothingFound") : t("notes.empty.projects")}
              hint={query ? undefined : t("notes.empty.projectsHint")}
            />
          ) : (
            <Items view={view} testId="notes-project-list">
              {sharedShown && (
                <Card
                  view={view}
                  testId="notes-shared-card"
                  cover={
                    <span className="grid size-full place-items-center bg-[linear-gradient(150deg,#eef0ff,#dcd8ff)] text-primary" aria-hidden>
                      <RiGroupLine className="size-[38%]" />
                    </span>
                  }
                  title={t("notes.sharedWithMe")}
                  meta={t("notes.count.docs", { n: shared.length })}
                  menu={null}
                  onOpen={() => nav.go({ screen: "shared" })}
                />
              )}
              {shown.map((p) => (
                <Card
                  key={p.id}
                  view={view}
                  testId={`notes-project-${p.id}`}
                  cover={<ProjectCover cover={p.cover} name={p.name} id={p.id} className="size-full" />}
                  title={p.name}
                  badge={p.shared || p.role !== "owner" ? <SharedBadge /> : undefined}
                  meta={
                    <>
                      {t("notes.count.docs", { n: p.documents })} · {p.role !== "owner" ? p.owner.name : ago(p.updatedAt)}
                    </>
                  }
                  menu={<MoreMenu items={actions.entries(p, sort === "custom" ? own : null)} label={t("notes.more")} testId={`notes-project-more-${p.id}`} />}
                  onOpen={() => nav.go({ screen: "project", projectId: p.id })}
                  drag={sort === "custom" && p.role === "owner" && !query ? { id: p.id, onDrop: (from) => void reorder(own, from, p.id, savePosition) } : undefined}
                />
              ))}
            </Items>
          )}
        </div>
      </div>
      <BottomBar query={query} onQuery={setQuery} placeholder={t("notes.search.projects")} onAdd={() => setCreating(true)} addLabel={t("notes.newProject")} />
      <CoverSheet
        open={creating}
        onClose={() => setCreating(false)}
        title={t("notes.newProject")}
        name=""
        fallback={t("notes.newProject")}
        cover={null}
        preview={(c) => <ProjectCover cover={c} name="" id="new" className="size-full" />}
        onSave={async ({ name, cover }) => {
          const p = await notesApi.createProject(name);
          if (cover) await notesApi.updateProject(p.id, { cover });
          await invalidateNotes();
          nav.go({ screen: "project", projectId: p.id });
        }}
      />
      {actions.sheets}
    </>
  );
}

const savePosition = (id: string, position: number) => notesApi.updateProject(id, { position });
const saveDocPosition = (id: string, position: number) => notesApi.updateDocument(id, { position });

/** Rename / cover / share / users / delete of a project (its "…" menu and its sheets). */
function useProjectActions(after?: { deleted?: () => void }) {
  const t = useT();
  const [edit, setEdit] = useState<NotesProjectDto | null>(null);
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [members, setMembers] = useState<ShareTarget | null>(null);
  const [del, setDel] = useState<NotesProjectDto | null>(null);
  const [busy, setBusy] = useState(false);
  const target = (p: NotesProjectDto): ShareTarget => ({ type: "project", id: p.id, name: p.name, ext: ".txt", kind: "project", role: p.role });
  const entries = (p: NotesProjectDto, order: NotesProjectDto[] | null): MenuEntry[] => {
    const canEdit = p.role !== "viewer";
    const owner = p.role === "owner";
    const out: MenuEntry[] = [];
    if (canEdit) out.push({ id: "edit", label: t("notes.renameCover"), icon: <RiPencilLine className="size-[18px]" />, onSelect: () => setEdit(p) });
    if (canEdit && p.cover)
      out.push({
        id: "cover-remove",
        label: t("notes.cover.remove"),
        icon: <RiImageLine className="size-[18px]" />,
        onSelect: () => void notesApi.updateProject(p.id, { cover: null }).then(invalidateNotes, (e) => toast({ title: errorMessage(t, e), tone: "danger" })),
      });
    if (owner) out.push({ id: "share", label: t("notes.share"), icon: <RiShareForwardLine className="size-[18px]" />, onSelect: () => setShare(target(p)), divider: true });
    out.push({ id: "users", label: t("notes.users"), icon: <RiGroupLine className="size-[18px]" />, onSelect: () => setMembers(target(p)), divider: !owner });
    if (order && owner && order.length > 1) {
      out.push({ id: "move-up", label: t("notes.moveUp"), onSelect: () => moveBy(order, p.id, -1, savePosition), divider: true });
      out.push({ id: "move-down", label: t("notes.moveDown"), onSelect: () => moveBy(order, p.id, 1, savePosition) });
    }
    if (owner) out.push({ id: "delete", label: t("notes.deleteProject"), icon: <RiDeleteBinLine className="size-[18px]" />, danger: true, divider: true, onSelect: () => setDel(p) });
    return out;
  };
  const sheets = (
    <>
      <CoverSheet
        open={!!edit}
        onClose={() => setEdit(null)}
        title={t("notes.renameCover")}
        name={edit?.name ?? ""}
        cover={edit?.cover ?? null}
        preview={(c) => <ProjectCover cover={c} name={edit?.name ?? ""} id={edit?.id ?? ""} className="size-full" />}
        onSave={async ({ name, cover }) => {
          if (!edit) return;
          await notesApi.updateProject(edit.id, { name, cover });
          await invalidateNotes();
        }}
      />
      <ShareSheet target={share} onClose={() => setShare(null)} onUsers={(x) => setMembers(x)} />
      <MembersSheet target={members} onClose={() => setMembers(null)} />
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        title={t("notes.deleteProjectTitle", { name: del?.name ?? "" })}
        message={del?.shared ? t("notes.deleteSharedHint") : t("notes.deleteProjectHint")}
        confirmLabel={t("notes.delete")}
        danger
        loading={busy}
        onConfirm={async () => {
          if (!del) return;
          setBusy(true);
          try {
            await notesApi.deleteProject(del.id);
            setDel(null);
            after?.deleted?.();
            await invalidateNotes();
          } catch (e) {
            toast({ title: errorMessage(t, e), tone: "danger" });
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
  return { entries, sheets, edit: setEdit, share: (p: NotesProjectDto) => setShare(target(p)), members: (p: NotesProjectDto) => setMembers(target(p)) };
}

// ---------------------------------------------------------------------------
// One project: its notes and presentations

export function ProjectScreen({ projectId }: { projectId: string }) {
  const t = useT();
  const nav = useNav();
  const q = useProject(projectId);
  const { prefs, set } = usePrefs();
  const [query, setQuery] = useState("");
  const view = prefs.docsView;
  const sort = prefs.docsSort;
  const project = q.data?.project;
  const docs = useMemo(() => sortItems(q.data?.documents ?? [], sort), [q.data, sort]);
  const shown = docs.filter((d) => matches(query, d.name, d.preview));
  const back = () => nav.go({ screen: "projects" });
  const pActions = useProjectActions({ deleted: back });
  const dActions = useDocActions(project ? { screen: "project", projectId } : null);
  const canEdit = !!project && project.role !== "viewer";
  const viewMenu = useViewSortEntries(view, sort, (v) => set({ ...(v.view ? { docsView: v.view } : {}), ...(v.sort ? { docsSort: v.sort } : {}) }));
  const menu = project ? [...pActions.entries(project, null), ...viewMenu.map((e, i) => (i === 0 ? { ...e, divider: true } : e))] : viewMenu;

  const create = async (kind: NotesDocKind) => {
    try {
      const doc = await notesApi.createDocument(projectId, {
        kind,
        name: kind === "presentation" ? t("notes.newPresentation") : t("notes.newNote"),
        ...(kind === "presentation" ? { data: emptyPresentation("rect") } : {}),
      });
      await invalidateNotes();
      nav.go({ screen: "doc", docId: doc.id, back: { screen: "project", projectId } });
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    }
  };

  if (q.isError)
    return (
      <>
        <NotesHeader onBack={back} right={<MoreMenu items={[]} label={t("notes.more")} win />} />
        <div className="grid flex-1 place-items-center px-6" data-testid="notes-project-error">
          <EmptyState icon={<RiFileTextLine className="size-7" />} title={t("notes.projectGone")} hint={errorMessage(t, q.error)} />
        </div>
      </>
    );

  return (
    <>
      <NotesHeader onBack={back} right={<MoreMenu items={menu} label={t("notes.more")} width={260} win />} />
      <div className="vn2-scroll scroll-area min-h-0 flex-1" data-testid="notes-project" data-project={projectId}>
        <div className="mx-auto w-full max-w-[1120px] px-4 pb-28 pt-1">
          {project ? (
            <div className="mb-4 flex items-center gap-3.5 px-1" data-testid="notes-project-hero">
              <button
                type="button"
                onClick={() => canEdit && pActions.edit(project)}
                className="relative size-[60px] shrink-0 overflow-hidden rounded-[18px] shadow-[0_2px_8px_-2px_rgba(40,30,120,0.25)]"
                aria-label={t("notes.renameCover")}
                data-testid="notes-project-cover"
              >
                <ProjectCover cover={project.cover} name={project.name} id={project.id} className="size-full" />
                {canEdit && (
                  <span className="absolute bottom-1 right-1 grid size-5 place-items-center rounded-full bg-white/85 text-primary">
                    <RiImageEditLine className="size-3" />
                  </span>
                )}
              </button>
              <div className="flex min-w-0 flex-col">
                <h1 className="truncate text-[24px] font-bold leading-tight tracking-tight text-text" data-testid="notes-project-name">
                  {project.name}
                </h1>
                <span className="truncate text-[13.5px] text-text-tertiary">
                  {t("notes.count.docs", { n: docs.length })}
                  {project.role !== "owner" && ` · ${project.owner.name} · ${t(`notes.role.${project.role}`)}`}
                </span>
              </div>
            </div>
          ) : (
            <Skeleton className="mb-4 h-[60px] w-60 rounded-2xl" />
          )}
          {q.isLoading ? (
            <Items view={view} testId="notes-docs-loading">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className={view === "grid" ? "aspect-square rounded-[22px]" : "h-20 rounded-2xl"} />
              ))}
            </Items>
          ) : shown.length === 0 ? (
            <EmptyState
              icon={<RiFileTextLine className="size-7" />}
              title={query ? t("notes.nothingFound") : t("notes.empty.docs")}
              hint={query || !canEdit ? undefined : t("notes.empty.docsHint")}
            />
          ) : (
            <Items view={view} testId="notes-doc-list">
              {shown.map((d) => (
                <DocCard
                  key={d.id}
                  doc={d}
                  view={view}
                  menu={dActions.entries(d, sort === "custom" && canEdit && !query ? docs : null)}
                  onOpen={() => nav.go({ screen: "doc", docId: d.id, back: { screen: "project", projectId } })}
                  drag={sort === "custom" && canEdit && !query ? { id: d.id, onDrop: (from) => void reorder(docs, from, d.id, saveDocPosition) } : undefined}
                />
              ))}
            </Items>
          )}
        </div>
      </div>
      <BottomBar
        query={query}
        onQuery={setQuery}
        placeholder={t("notes.search.docs")}
        addLabel={t("notes.new")}
        addMenu={
          canEdit
            ? [
                { id: "new-note", label: t("notes.newNote"), icon: <RiFileTextLine className="size-[18px]" />, onSelect: () => void create("note") },
                { id: "new-presentation", label: t("notes.newPresentation"), icon: <RiSlideshowLine className="size-[18px]" />, onSelect: () => void create("presentation") },
              ]
            : undefined
        }
      />
      {project && pActions.sheets}
      {dActions.sheets}
    </>
  );
}

function DocCard({ doc, view, menu, onOpen, drag }: { doc: NotesDocMetaDto; view: View; menu: MenuEntry[]; onOpen: () => void; drag?: { id: string; onDrop: (from: string) => void } }) {
  const t = useT();
  const ago = useAgo();
  return (
    <Card
      view={view}
      testId={`notes-doc-${doc.id}`}
      cover={<DocCover cover={doc.cover} kind={doc.kind} preview={doc.preview} id={doc.id} className="size-full" />}
      title={doc.name}
      badge={
        <>
          {doc.kind === "presentation" && <RiPresentationLine className="size-[15px] shrink-0 text-text-tertiary" aria-label={t("notes.presentation")} />}
          {doc.shared && <SharedBadge />}
        </>
      }
      meta={
        <>
          {doc.kind === "presentation" ? t("notes.count.slides", { n: doc.pages }) : doc.pages > 1 ? t("notes.count.pages", { n: doc.pages }) : notesExt(doc.kind)} · {ago(doc.updatedAt)}
        </>
      }
      menu={<MoreMenu items={menu} label={t("notes.more")} testId={`notes-doc-more-${doc.id}`} />}
      onOpen={onOpen}
      drag={drag}
    />
  );
}

/** Rename / cover / share / users / to presentation / delete of a document. */
export function useDocActions(
  back: { screen: "project"; projectId: string } | { screen: "shared" } | null,
  opts: { deleted?: () => void; edited?: (v: { name: string; cover: string | null }) => void; flush?: () => Promise<boolean> } = {},
) {
  const t = useT();
  const nav = useNav();
  const [edit, setEdit] = useState<NotesDocMetaDto | null>(null);
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [members, setMembers] = useState<ShareTarget | null>(null);
  const [del, setDel] = useState<NotesDocMetaDto | null>(null);
  const [busy, setBusy] = useState(false);
  const target = (d: NotesDocMetaDto): ShareTarget => ({ type: "document", id: d.id, name: d.name, ext: notesExt(d.kind), kind: d.kind, role: d.role });
  const fail = (e: unknown) => toast({ title: errorMessage(t, e), tone: "danger" });

  const toPresentation = async (d: NotesDocMetaDto) => {
    try {
      if (opts.flush && !(await opts.flush())) return;
      const full = await notesApi.document(d.id);
      if (full.data.kind !== "note") return;
      const doc = await notesApi.createDocument(d.projectId, { kind: "presentation", name: d.name, data: noteToPresentation(full.data, d.name, "rect") });
      await invalidateNotes();
      toast({ title: t("notes.convertedToPresentation"), tone: "success" });
      nav.go({ screen: "doc", docId: doc.id, back: back ?? { screen: "project", projectId: d.projectId } });
    } catch (e) {
      fail(e);
    }
  };

  const entries = (d: NotesDocMetaDto, order: NotesDocMetaDto[] | null): MenuEntry[] => {
    const canEdit = d.role !== "viewer";
    const owner = d.role === "owner";
    const out: MenuEntry[] = [];
    if (canEdit) out.push({ id: "edit", label: t("notes.renameCover"), icon: <RiPencilLine className="size-[18px]" />, onSelect: () => setEdit(d) });
    if (canEdit && d.cover) out.push({ id: "cover-remove", label: t("notes.cover.remove"), icon: <RiImageLine className="size-[18px]" />, onSelect: () => void notesApi.updateDocument(d.id, { cover: null }).then(invalidateNotes, fail) });
    if (owner) out.push({ id: "share", label: t("notes.share"), icon: <RiShareForwardLine className="size-[18px]" />, onSelect: () => setShare(target(d)), divider: true });
    out.push({ id: "users", label: t("notes.users"), icon: <RiGroupLine className="size-[18px]" />, onSelect: () => setMembers(target(d)), divider: !owner });
    if (d.kind === "note" && canEdit && d.role !== "viewer" && back?.screen !== "shared")
      out.push({ id: "to-presentation", label: t("notes.toPresentation"), icon: <RiSlideshowLine className="size-[18px]" />, onSelect: () => void toPresentation(d) });
    if (order && order.length > 1) {
      out.push({ id: "move-up", label: t("notes.moveUp"), onSelect: () => moveBy(order, d.id, -1, saveDocPosition), divider: true });
      out.push({ id: "move-down", label: t("notes.moveDown"), onSelect: () => moveBy(order, d.id, 1, saveDocPosition) });
    }
    if (owner) out.push({ id: "delete", label: t("notes.delete"), icon: <RiDeleteBinLine className="size-[18px]" />, danger: true, divider: true, onSelect: () => setDel(d) });
    return out;
  };

  const sheets = (
    <>
      <CoverSheet
        open={!!edit}
        onClose={() => setEdit(null)}
        title={t("notes.renameCover")}
        name={edit?.name ?? ""}
        cover={edit?.cover ?? null}
        preview={(c) => <DocCover cover={c} kind={edit?.kind ?? "note"} preview={edit?.preview ?? ""} id={edit?.id ?? ""} className="size-full" />}
        onSave={async ({ name, cover }) => {
          if (!edit) return;
          await notesApi.updateDocument(edit.id, { name, cover });
          opts.edited?.({ name, cover });
          await invalidateNotes();
        }}
      />
      <ShareSheet target={share} onClose={() => setShare(null)} onUsers={(x) => setMembers(x)} />
      <MembersSheet target={members} onClose={() => setMembers(null)} />
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        title={t("notes.deleteDocTitle", { name: del?.name ?? "" })}
        message={del?.shared ? t("notes.deleteSharedHint") : t("notes.deleteDocHint")}
        confirmLabel={t("notes.delete")}
        danger
        loading={busy}
        onConfirm={async () => {
          if (!del) return;
          setBusy(true);
          try {
            await notesApi.deleteDocument(del.id);
            setDel(null);
            opts.deleted?.();
            await invalidateNotes();
          } catch (e) {
            fail(e);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
  return { entries, sheets, edit: setEdit, share: (d: NotesDocMetaDto) => setShare(target(d)), members: (d: NotesDocMetaDto) => setMembers(target(d)) };
}

// ---------------------------------------------------------------------------
// Documents other people gave me access to (not their whole project)

export function SharedScreen() {
  const t = useT();
  const nav = useNav();
  const q = useProjects();
  const { prefs } = usePrefs();
  const [query, setQuery] = useState("");
  const docs = sortItems(q.data?.sharedDocuments ?? [], prefs.docsSort === "custom" ? "modified" : prefs.docsSort).filter((d) => matches(query, d.name, d.preview));
  const actions = useDocActions({ screen: "shared" });
  return (
    <>
      <NotesHeader onBack={() => nav.go({ screen: "projects" })} right={<MoreMenu items={[]} label={t("notes.more")} win />} />
      <div className="vn2-scroll scroll-area min-h-0 flex-1" data-testid="notes-shared">
        <div className="mx-auto w-full max-w-[1120px] px-4 pb-28 pt-1">
          <h1 className="mb-3 px-1 text-[24px] font-bold tracking-tight text-text">{t("notes.sharedWithMe")}</h1>
          {docs.length === 0 ? (
            <EmptyState icon={<RiGroupLine className="size-7" />} title={query ? t("notes.nothingFound") : t("notes.empty.shared")} />
          ) : (
            <Items view={prefs.docsView} testId="notes-doc-list">
              {docs.map((d) => (
                <DocCard key={d.id} doc={d} view={prefs.docsView} menu={actions.entries(d, null)} onOpen={() => nav.go({ screen: "doc", docId: d.id, back: { screen: "shared" } })} />
              ))}
            </Items>
          )}
        </div>
      </div>
      <BottomBar query={query} onQuery={setQuery} placeholder={t("notes.search.docs")} addLabel={t("notes.new")} />
      {actions.sheets}
    </>
  );
}
