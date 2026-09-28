import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RiArrowLeftSLine, RiCloseLine, RiMenuLine, RiPencilLine, RiSearchLine } from "@remixicon/react";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { MailGlyph } from "@/brand/brand";
import { IconButton } from "@/ui/controls";
import { WindowHeader, useWindow } from "@/os/window-context";
import { Composer } from "./composer";
import { useThread } from "./data";
import { ComposeButton, FOLDERS, FolderNav, MailSearch, ThreadList, ThreadToolbar, ThreadView } from "./parts";
import { MailStoreContext, createMailStore, useMail } from "./store";

const EASE = [0.22, 1, 0.36, 1] as const;

/** VOIDEX Mail — internal mail between VOIDEX accounts. */
export function MailApp() {
  const [store] = useState(createMailStore);
  return (
    <MailStoreContext.Provider value={store}>
      <MailShell />
    </MailStoreContext.Provider>
  );
}

function MailShell() {
  const ff = useFormFactor();
  const win = useWindow();
  const setView = useMail((s) => s.setView);
  const openThread = useMail((s) => s.openThread);

  // Deep link (e.g. from a "new message" banner): open("mail", { params: { threadId } }).
  useEffect(() => {
    const id = win.params.threadId;
    if (typeof id === "string") {
      setView("inbox");
      openThread(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.paramsVersion]);

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden" data-testid="mail-app">
      {ff === "desktop" ? <DesktopMail /> : <MobileMail />}
      <AnimatePresence>
        <Composer />
      </AnimatePresence>
    </div>
  );
}

function SelectedThreadToolbar({ threadId }: { threadId: string }) {
  const view = useMail((s) => s.view);
  const thread = useThread(threadId, view).data;
  const starred = thread?.messages.some((m) => m.starred);
  const unread = thread?.messages.some((m) => !m.read);
  return <ThreadToolbar threadIds={[threadId]} starred={starred} unread={unread} />;
}

function SelectionBar() {
  const t = useT();
  const selection = useMail((s) => s.selection);
  const clear = useMail((s) => s.clearSelection);
  if (!selection.length) return null;
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b bg-primary-soft/60 px-2 animate-fade-up">
      <IconButton label={t("common.close")} size="sm" onClick={clear}>
        <RiCloseLine className="size-5" />
      </IconButton>
      <span className="flex-1 text-[14px] font-semibold text-primary-strong">{selection.length}</span>
      <ThreadToolbar threadIds={selection} compact />
    </div>
  );
}

function FolderTitle() {
  const t = useT();
  const view = useMail((s) => s.view);
  const f = FOLDERS.find((x) => x.view === view)!;
  return <span className="text-[17px] font-semibold">{t(f.label)}</span>;
}

// ---------------------------------------------------------------------------

function DesktopMail() {
  const t = useT();
  const me = useSession((s) => s.user)!;
  const threadId = useMail((s) => s.threadId);
  return (
    <>
      <aside className="flex w-[248px] shrink-0 flex-col border-r bg-surface-secondary/60">
        <WindowHeader menu={false}>
          <span className="flex items-center gap-2 pl-1.5">
            <MailGlyph className="size-6" />
            <span className="text-[15px] font-semibold">{t("mail.title")}</span>
          </span>
        </WindowHeader>
        <div className="px-3 pb-3">
          <ComposeButton />
        </div>
        <div className="scroll-area flex-1 px-2">
          <FolderNav />
        </div>
        <div className="border-t px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{t("mail.address")}</div>
          <div className="truncate text-[13px] text-text-secondary" data-selectable>
            {me.mailAddress}
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <WindowHeader>
          <MailSearch />
        </WindowHeader>
        <div className="flex min-h-0 flex-1">
          <section className="flex w-[380px] shrink-0 flex-col border-r">
            <SelectionBar />
            <div className="scroll-area flex-1">
              <ThreadList />
            </div>
          </section>
          <section className="flex min-w-0 flex-1 flex-col bg-surface-secondary/30">
            {threadId ? (
              <>
                <div className="flex h-12 shrink-0 items-center justify-end border-b bg-surface px-3">
                  <SelectedThreadToolbar threadId={threadId} />
                </div>
                <div className="scroll-area flex-1">
                  <ThreadView threadId={threadId} key={threadId} />
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-tertiary">
                <MailGlyph className="size-16 opacity-30 grayscale" />
                <span className="text-[14px]">{t("mail.selectThread")}</span>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function MobileMail() {
  const t = useT();
  const threadId = useMail((s) => s.threadId);
  const openThread = useMail((s) => s.openThread);
  const drawer = useMail((s) => s.drawerOpen);
  const setDrawer = useMail((s) => s.setDrawer);
  const compose = useMail((s) => s.compose);
  const query = useMail((s) => s.query);
  const [searching, setSearching] = useState(!!query);
  const me = useSession((s) => s.user)!;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <WindowHeader>
        {searching ? (
          <>
            <MailSearch autoFocus />
            <IconButton label={t("common.close")} onClick={() => setSearching(false)}>
              <RiCloseLine className="size-5" />
            </IconButton>
          </>
        ) : (
          <>
            <IconButton label={t("mail.folders")} onClick={() => setDrawer(true)} data-testid="mail-drawer">
              <RiMenuLine className="size-5" />
            </IconButton>
            <FolderTitle />
            <span className="flex-1" />
            <IconButton label={t("mail.search")} onClick={() => setSearching(true)}>
              <RiSearchLine className="size-5" />
            </IconButton>
          </>
        )}
      </WindowHeader>
      <SelectionBar />
      <div className="scroll-area flex-1 pb-24">
        <ThreadList />
      </div>

      {/* Thumb-reachable compose */}
      <motion.button
        onClick={() => compose()}
        className="absolute bottom-5 right-5 z-10 flex h-14 items-center gap-2 rounded-full bg-primary pl-5 pr-6 font-semibold text-white shadow-glow"
        whileTap={{ scale: 0.94 }}
        data-testid="compose"
      >
        <RiPencilLine className="size-5" /> {t("mail.compose")}
      </motion.button>

      {/* Thread page */}
      <AnimatePresence>
        {threadId && (
          <motion.div
            className="absolute inset-0 z-20 flex flex-col bg-surface"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.32, ease: EASE }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.8 }}
            onDragEnd={(_, info) => (info.offset.x > 110 || info.velocity.x > 700) && openThread(null)}
          >
            <WindowHeader>
              <button onClick={() => openThread(null)} className="pressable -ml-1 flex h-10 items-center rounded-full pr-2 text-[16px] text-primary" data-testid="thread-back">
                <RiArrowLeftSLine className="size-7" />
                <FolderTitle />
              </button>
            </WindowHeader>
            <div className="scroll-area flex-1">
              <ThreadView threadId={threadId} key={threadId} />
            </div>
            <div className="flex shrink-0 justify-center border-t px-2 py-1.5">
              <SelectedThreadToolbar threadId={threadId} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Folders drawer */}
      <AnimatePresence>
        {drawer && (
          <>
            <motion.div className="absolute inset-0 z-30 bg-[rgba(20,20,30,0.25)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)} />
            <motion.aside
              className="absolute inset-y-0 left-0 z-40 flex w-[82%] max-w-[320px] flex-col rounded-r-[28px] bg-surface shadow-window"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.3, ease: EASE }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0.8, right: 0 }}
              onDragEnd={(_, info) => (info.offset.x < -80 || info.velocity.x < -600) && setDrawer(false)}
              data-testid="mail-drawer-panel"
            >
              <div className="flex items-center gap-2 px-5 pb-3 pt-5">
                <MailGlyph className="size-7" />
                <div className="min-w-0">
                  <div className="text-[17px] font-semibold">{t("mail.title")}</div>
                  <div className="truncate text-[12px] text-text-secondary">{me.mailAddress}</div>
                </div>
              </div>
              <div className="px-4 pb-3">
                <ComposeButton className={cx("h-12")} />
              </div>
              <div className="scroll-area flex-1 px-2">
                <FolderNav />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
