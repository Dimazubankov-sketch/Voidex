import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiChat3Fill,
  RiChat3Line,
  RiHistoryFill,
  RiHistoryLine,
  RiHome5Fill,
  RiHome5Line,
  RiQuillPenLine,
  RiUser3Fill,
  RiUser3Line,
  RiUserSearchFill,
  RiUserSearchLine,
} from "@remixicon/react";
import { VibexGlyph } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT, type MessageKey } from "@/lib/i18n";
import { IconButton } from "@/ui/controls";
import { WindowHeader, useWindow } from "@/os/window-context";
import { ChatList, Conversation } from "./chats";
import { FeedEmpty, ComposerPrompt, PostComposer, PostList } from "./posts";
import { HistorySection, MePage, PeopleSection, PersonPage, PostPage } from "./people";
import { ShareSheet } from "./share-sheet";
import { useChats, useFeed } from "./data";
import { VibexStoreContext, createVibexStore, useVibex, useVibexStore, type VibexPage, type VibexSection } from "./store";

const EASE = [0.22, 1, 0.36, 1] as const;

const NAV: { id: VibexSection; label: MessageKey; line: ComponentType<{ className?: string }>; fill: ComponentType<{ className?: string }> }[] = [
  { id: "feed", label: "vibex.nav.feed", line: RiHome5Line, fill: RiHome5Fill },
  { id: "chats", label: "vibex.nav.chats", line: RiChat3Line, fill: RiChat3Fill },
  { id: "people", label: "vibex.nav.people", line: RiUserSearchLine, fill: RiUserSearchFill },
  { id: "history", label: "vibex.nav.history", line: RiHistoryLine, fill: RiHistoryFill },
  { id: "me", label: "vibex.nav.me", line: RiUser3Line, fill: RiUser3Fill },
];

/** Vibex — messenger and feed of VOIDEX. */
export function VibexApp() {
  const [store] = useState(createVibexStore);
  return (
    <VibexStoreContext.Provider value={store}>
      <VibexShell />
    </VibexStoreContext.Provider>
  );
}

function VibexShell() {
  const ff = useFormFactor();
  const win = useWindow();
  const store = useVibexStore();

  // Deep links: a "new message" banner → the chat; a shared link → the post.
  useEffect(() => {
    const { chatId, postId } = win.params;
    if (typeof chatId === "string") store.getState().openChat(chatId);
    else if (typeof postId === "string") store.getState().push({ kind: "post", id: postId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.paramsVersion]);

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-surface-secondary/40" data-testid="vibex-app">
      {ff === "desktop" ? <DesktopVibex /> : <MobileVibex />}
      <PostComposer />
      <ShareSheet />
    </div>
  );
}

function useUnread() {
  const chats = useChats();
  return (chats.data ?? []).reduce((n, c) => n + c.unread, 0);
}

function Badge({ n, className }: { n: number; className?: string }) {
  if (!n) return null;
  return (
    <span className={cx("flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-white", className)} data-testid="vibex-unread">
      {n > 99 ? "99+" : n}
    </span>
  );
}

function Feed() {
  const feed = useFeed();
  return (
    <div className="flex flex-col gap-3" data-testid="vibex-feed">
      <ComposerPrompt />
      <PostList query={feed} empty={<FeedEmpty />} />
    </div>
  );
}

function SectionBody({ section }: { section: VibexSection }) {
  switch (section) {
    case "feed":
      return <Feed />;
    case "people":
      return <PeopleSection />;
    case "history":
      return <HistorySection />;
    case "me":
      return <MePage />;
    default:
      return null;
  }
}

function PageBody({ page }: { page: VibexPage }) {
  if (page.kind === "person") return <PersonPage id={page.id} />;
  if (page.kind === "post") return <PostPage id={page.id} />;
  return null;
}

function Column({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[640px] px-3 pb-8 pt-1 sm:px-4">{children}</div>;
}

// ---------------------------------------------------------------- desktop

function DesktopVibex() {
  const t = useT();
  const section = useVibex((s) => s.section);
  const go = useVibex((s) => s.go);
  const stack = useVibex((s) => s.stack);
  const back = useVibex((s) => s.back);
  const chatId = useVibex((s) => s.chatId);
  const compose = useVibex((s) => s.compose);
  const unread = useUnread();
  const page = stack.at(-1);
  const title = page ? null : t(NAV.find((n) => n.id === section)!.label);

  return (
    <>
      <aside className="flex w-[212px] shrink-0 flex-col border-r bg-surface/70">
        <WindowHeader menu={false}>
          <span className="flex items-center gap-2 pl-1.5">
            <VibexGlyph className="size-7" />
            <span className="text-[16px] font-semibold tracking-tight">{t("vibex.title")}</span>
          </span>
        </WindowHeader>
        <nav className="flex flex-col gap-0.5 px-2" data-testid="vibex-nav">
          {NAV.map((n) => {
            const active = section === n.id && !page;
            const Icon = active ? n.fill : n.line;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => go(n.id)}
                className={cx(
                  "flex h-11 items-center gap-3 rounded-2xl px-3 text-[15px] transition-colors",
                  active ? "bg-primary-soft font-semibold text-primary-strong" : "text-text hover:bg-surface-hover",
                )}
                data-testid={`vibex-nav-${n.id}`}
              >
                <Icon className={cx("size-[21px]", active ? "text-primary" : "text-text-secondary")} />
                <span className="flex-1 text-left">{t(n.label)}</span>
                {n.id === "chats" && <Badge n={unread} />}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto p-3">
          <button
            type="button"
            onClick={() => compose(true)}
            className="pressable flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[15px] font-semibold text-white shadow-glow"
            data-testid="vibex-new-post"
          >
            <RiQuillPenLine className="size-5" /> {t("vibex.newPost")}
          </button>
        </div>
      </aside>

      {section === "chats" && !page ? (
        <div className="flex min-w-0 flex-1">
          <section className="flex w-[330px] shrink-0 flex-col border-r bg-surface/60">
            <WindowHeader menu={false}>
              <span className="flex-1 pl-1.5 text-[17px] font-semibold">{t("vibex.nav.chats")}</span>
              <IconButton label={t("vibex.chats.new")} onClick={() => go("people")} data-testid="vibex-new-chat">
                <RiAddLine className="size-5" />
              </IconButton>
            </WindowHeader>
            <div className="scroll-area flex-1">
              <ChatList />
            </div>
          </section>
          <section className="relative flex min-w-0 flex-1 flex-col">
            {chatId ? (
              <Conversation chatId={chatId} key={chatId} />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-tertiary">
                <WindowHeader className="absolute inset-x-0 top-0" />
                <VibexGlyph className="size-16 opacity-30 grayscale" />
                <span className="text-[14px]">{t("vibex.chats.select")}</span>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <WindowHeader>
            {page && (
              <IconButton label={t("common.back")} onClick={back} data-testid="vibex-back">
                <RiArrowLeftSLine className="size-7" />
              </IconButton>
            )}
            {title && <span className="pl-1.5 text-[17px] font-semibold">{title}</span>}
          </WindowHeader>
          <div className="scroll-area flex-1">
            <Column>{page ? <PageBody page={page} key={`${page.kind}:${page.id}`} /> : <SectionBody section={section} />}</Column>
          </div>
        </div>
      )}
    </>
  );
}

// ----------------------------------------------------------------- mobile

function MobileVibex() {
  const t = useT();
  const section = useVibex((s) => s.section);
  const go = useVibex((s) => s.go);
  const stack = useVibex((s) => s.stack);
  const back = useVibex((s) => s.back);
  const chatId = useVibex((s) => s.chatId);
  const compose = useVibex((s) => s.compose);
  const unread = useUnread();

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <WindowHeader>
        <span className="flex items-center gap-2 pl-1">
          <VibexGlyph className="size-7" />
          <span className="text-[18px] font-semibold tracking-tight">{t(NAV.find((n) => n.id === section)!.label)}</span>
        </span>
        <span className="flex-1" />
        {section === "chats" && (
          <IconButton label={t("vibex.chats.new")} onClick={() => go("people")} data-testid="vibex-new-chat">
            <RiAddLine className="size-5" />
          </IconButton>
        )}
      </WindowHeader>

      <div className="scroll-area flex-1 pb-24">
        {section === "chats" ? <ChatList /> : <Column><SectionBody section={section} /></Column>}
      </div>

      {(section === "feed" || section === "me") && (
        <motion.button
          onClick={() => compose(true)}
          className="absolute bottom-[calc(84px+var(--safe-bottom))] right-4 z-10 flex size-14 items-center justify-center rounded-full bg-primary text-white shadow-glow"
          whileTap={{ scale: 0.92 }}
          aria-label={t("vibex.newPost")}
          data-testid="vibex-new-post"
        >
          <RiQuillPenLine className="size-6" />
        </motion.button>
      )}

      {/* Tab bar */}
      <nav className="vx-glass-strong absolute inset-x-3 bottom-[max(var(--safe-bottom),10px)] z-10 flex h-16 items-stretch rounded-[26px] px-1" data-testid="vibex-nav">
        {NAV.map((n) => {
          const active = section === n.id;
          const Icon = active ? n.fill : n.line;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => go(n.id)}
              className={cx("relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-primary" : "text-text-secondary")}
              data-testid={`vibex-nav-${n.id}`}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="size-6" />
              <span className="max-w-full truncate px-0.5">{t(n.label)}</span>
              {n.id === "chats" && <Badge n={unread} className="absolute left-1/2 top-1.5 ml-1.5" />}
            </button>
          );
        })}
      </nav>

      {/* Chat page */}
      <AnimatePresence>
        {chatId && (
          <SlidePage key={`chat:${chatId}`} onBack={back} z={30}>
            <Conversation chatId={chatId} onBack={back} />
          </SlidePage>
        )}
      </AnimatePresence>

      {/* Pushed pages: person, post */}
      <AnimatePresence>
        {stack.map((p, i) => (
          <SlidePage key={`${p.kind}:${p.id}:${i}`} onBack={back} z={40 + i}>
            <WindowHeader>
              <IconButton label={t("common.back")} onClick={back} data-testid="vibex-back">
                <RiArrowLeftSLine className="size-7" />
              </IconButton>
            </WindowHeader>
            <div className="scroll-area flex-1">
              <Column>
                <PageBody page={p} />
              </Column>
            </div>
          </SlidePage>
        ))}
      </AnimatePresence>
    </div>
  );
}

function SlidePage({ children, onBack, z }: { children: ReactNode; onBack: () => void; z: number }) {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col bg-surface"
      style={{ zIndex: z }}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ duration: 0.32, ease: EASE }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 0.8 }}
      dragDirectionLock
      onDragEnd={(_, info) => (info.offset.x > 110 || info.velocity.x > 700) && onBack()}
    >
      {children}
    </motion.div>
  );
}
