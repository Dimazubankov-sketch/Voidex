import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  RiAddCircleFill,
  RiAddCircleLine,
  RiAddLine,
  RiArrowLeftLine,
  RiChat3Fill,
  RiChat3Line,
  RiHome5Fill,
  RiHome5Line,
  RiSearchLine,
} from "@remixicon/react";
import { Avatar, VibexGlyph } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT, type MessageKey } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { IconButton } from "@/ui/controls";
import { WindowHeader, useWindow } from "@/os/window-context";
import { ChatList, Conversation } from "./chats";
import { NewChatFab } from "./groups";
import { CommentsScreen } from "./comments";
import { FeedEmpty, ComposerPrompt, PostComposer, PostList } from "./posts";
import { HistorySection, PeopleSection, PostPage } from "./people";
import { MePage, PersonPage } from "./profile";
import { VibexSettingsScreen } from "./settings";
import { useEdgeSwipe } from "./edge-swipe";
import { ShareSheet } from "./share-sheet";
import { SidebarDrawer, SidebarPanel } from "./sidebar";
import { useChats, useFeed } from "./data";
import { VibexStoreContext, createVibexStore, useVibex, useVibexStore, type VibexPage, type VibexSection } from "./store";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Vibex — messenger and feed of VOIDEX, in the Voyzen layout. Identity is the
 * VOIDEX session (Step 2.3): no sign-in, no second account inside the app.
 */
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

  // Deep links: notifications / banners → a chat, a post (or its comments), a person; shared links → the post.
  useEffect(() => {
    const { chatId, postId, userId, comments } = win.params;
    const s = store.getState();
    if (typeof chatId === "string") s.openChat(chatId);
    else if (typeof postId === "string") {
      s.push({ kind: "post", id: postId });
      if (typeof comments === "string") s.openComments(postId);
    } else if (typeof userId === "string") s.push({ kind: "person", id: userId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.paramsVersion]);

  return (
    <div className="vx-app-bg relative flex min-h-0 flex-1 overflow-hidden" data-testid="vibex-app">
      {ff === "desktop" ? <DesktopVibex /> : <MobileVibex />}
      <CommentsScreen />
      <PostComposer />
      <ShareSheet />
    </div>
  );
}

const SECTION_TITLE: Record<VibexSection, MessageKey> = {
  feed: "vibex.nav.home",
  people: "vibex.nav.search",
  chats: "vibex.nav.messages",
  history: "vibex.nav.history",
  bookmarks: "vibex.nav.bookmarks",
  settings: "vibex.nav.settings",
  me: "vibex.nav.profile",
};

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
      return <HistorySection kind="liked" />;
    case "bookmarks":
      return <HistorySection kind="bookmarks" />;
    case "settings":
      return <VibexSettingsScreen />;
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
  return <div className="mx-auto w-full max-w-[640px] px-3 pb-24 pt-3 sm:px-4">{children}</div>;
}

/** Voyzen's round "new post" button. */
function NewPostFab({ className }: { className?: string }) {
  const t = useT();
  const compose = useVibex((s) => s.compose);
  return (
    <motion.button
      type="button"
      onClick={() => compose(true)}
      className={cx("absolute z-10 flex size-14 items-center justify-center rounded-full bg-primary text-white shadow-float", className)}
      whileTap={{ scale: 0.94 }}
      aria-label={t("vibex.newPost")}
      title={t("vibex.newPost")}
      data-testid="vibex-new-post"
    >
      <RiAddLine className="size-7" />
    </motion.button>
  );
}

// ---------------------------------------------------------------- desktop

function DesktopVibex() {
  const t = useT();
  const section = useVibex((s) => s.section);
  const stack = useVibex((s) => s.stack);
  const back = useVibex((s) => s.back);
  const chatId = useVibex((s) => s.chatId);
  // Step 2.5.1: a narrow window collapses the rail to icons by itself; the toggle still wins.
  const [manual, setManual] = useState<boolean | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!host) return;
    const ro = new ResizeObserver(() => setNarrow(host.clientWidth < 860));
    ro.observe(host);
    return () => ro.disconnect();
  }, [host]);
  const collapsed = manual ?? narrow;
  const page = stack.at(-1);

  return (
    <>
      <span ref={(el) => setHost(el?.parentElement ?? null)} className="hidden" aria-hidden />
      <SidebarPanel variant="rail" collapsed={collapsed} onToggle={() => setManual(!collapsed)} />

      {section === "chats" && !page ? (
        <div className="flex min-w-0 flex-1">
          <section className="relative flex w-[300px] shrink-0 flex-col border-r bg-surface">
            <WindowHeader menu={false}>
              <span className="flex-1 pl-1.5 text-[17px] font-bold">{t("vibex.nav.messages")}</span>
            </WindowHeader>
            <div className="scroll-area flex-1 pb-20">
              <ChatList />
            </div>
            {/* The pencil: a new conversation (a person or a group), like the feed's "+" */}
            <NewChatFab className="bottom-5 right-5" />
          </section>
          <section className="relative flex min-w-0 flex-1 flex-col bg-surface">
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
        <div className="relative flex min-w-0 flex-1 flex-col">
          <WindowHeader className="border-b bg-surface/90 backdrop-blur">
            {page && (
              <IconButton label={t("common.back")} onClick={back} data-testid="vibex-back">
                <RiArrowLeftLine className="size-5" />
              </IconButton>
            )}
            {!page && <span className="pl-1.5 text-[17px] font-bold">{t(SECTION_TITLE[section])}</span>}
          </WindowHeader>
          <div className="scroll-area flex-1">
            <Column>{page ? <PageBody page={page} key={`${page.kind}:${page.id}`} /> : <SectionBody section={section} />}</Column>
          </div>
          {(section === "feed" || section === "me") && !page && <NewPostFab className="bottom-6 right-6" />}
        </div>
      )}
    </>
  );
}

// ----------------------------------------------------------------- mobile

/** Phones: Voyzen layout — avatar opens the side menu; bottom bar Home · New post · Messages. */
function MobileVibex() {
  const t = useT();
  const me = useSession((s) => s.user)!;
  const section = useVibex((s) => s.section);
  const go = useVibex((s) => s.go);
  const stack = useVibex((s) => s.stack);
  const back = useVibex((s) => s.back);
  const chatId = useVibex((s) => s.chatId);
  const compose = useVibex((s) => s.compose);
  const drawer = useVibex((s) => s.drawer);
  const setDrawer = useVibex((s) => s.setDrawer);
  const unread = (useChats().data ?? []).reduce((n, c) => n + c.unread, 0);
  const root = useRef<HTMLDivElement>(null);
  // Swipe from the left edge opens the side menu (only on the main screens, not over a chat / page).
  useEdgeSwipe(root, { enabled: !drawer && !chatId && stack.length === 0, onOpen: () => setDrawer(true) });

  const tabs = [
    { key: "feed" as const, label: "vibex.nav.home" as const, line: RiHome5Line, fill: RiHome5Fill },
    { key: "compose" as const, label: "vibex.newPost" as const, line: RiAddCircleLine, fill: RiAddCircleFill },
    { key: "chats" as const, label: "vibex.nav.messages" as const, line: RiChat3Line, fill: RiChat3Fill },
  ];

  return (
    <div ref={root} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <WindowHeader className="border-b bg-surface">
        <button type="button" onClick={() => setDrawer(true)} aria-label={t("vibex.nav.menu")} className="shrink-0 rounded-full" data-testid="vibex-menu">
          <Avatar name={`${me.firstName} ${me.lastName}`} userId={me.id} version={me.avatarVersion} size={34} />
        </button>
        <span className="flex-1 truncate text-center text-[17px] font-bold">{t(SECTION_TITLE[section])}</span>
        <IconButton label={t("vibex.nav.search")} onClick={() => go("people")} data-testid="vibex-search">
          <RiSearchLine className="size-5" />
        </IconButton>
      </WindowHeader>

      <div className="scroll-area flex-1">{section === "chats" ? <div className="pb-20"><ChatList /></div> : <Column><SectionBody section={section} /></Column>}</div>
      {section === "chats" && <NewChatFab className="right-4" style={{ bottom: 80 }} />}

      {/* No safe-area padding here: the window frame already keeps the home-indicator area below the app.
          (Adding it again squeezed this 64px bar on iPhone and pushed the icons across the divider.) */}
      <nav className="flex h-16 shrink-0 items-center justify-around border-t bg-surface px-2" data-testid="vibex-tabbar">
        {tabs.map((item) => {
          const active = item.key !== "compose" && section === item.key;
          const Icon = active ? item.fill : item.line;
          const badge = item.key === "chats" ? unread : 0;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => (item.key === "compose" ? compose(true) : go(item.key))}
              aria-current={active ? "page" : undefined}
              aria-label={t(item.label)}
              className="relative flex flex-1 flex-col items-center gap-0.5 py-1.5 active:scale-95"
              data-testid={`vibex-tab-${item.key}`}
            >
              <span className="relative">
                <Icon className={cx("size-6 transition-colors", active ? "text-primary" : "text-text-tertiary")} />
                {badge > 0 && (
                  <span className="absolute -right-2 -top-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white" data-testid="vibex-unread">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </span>
              <span className={cx("text-[11px] font-medium", active ? "text-primary" : "text-text-tertiary")}>{t(item.label)}</span>
            </button>
          );
        })}
      </nav>

      <SidebarDrawer open={drawer} onClose={() => setDrawer(false)} />

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
            <WindowHeader className="border-b">
              <IconButton label={t("common.back")} onClick={back} data-testid="vibex-back">
                <RiArrowLeftLine className="size-5" />
              </IconButton>
            </WindowHeader>
            <div className="scroll-area flex-1 bg-surface-secondary/50">
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
