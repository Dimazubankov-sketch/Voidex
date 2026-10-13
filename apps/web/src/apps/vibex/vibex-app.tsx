import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import {
  RiAddLine,
  RiArrowLeftLine,
  RiChat3Fill,
  RiChat3Line,
  RiHome5Fill,
  RiHome5Line,
  RiNotification3Fill,
  RiNotification3Line,
  RiSearchFill,
  RiSearchLine,
  RiUser3Fill,
  RiUser3Line,
} from "@remixicon/react";
import { VibexGlyph } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT, type MessageKey } from "@/lib/i18n";
import { IconButton } from "@/ui/controls";
import { WindowHeader, useWindow } from "@/os/window-context";
import { Conversation } from "./chats";
import { ChatsPane } from "./chat-home";
import { NewChatFab } from "./groups";
import { CommentsScreen } from "./comments";
import { FeedEmpty, ComposerPrompt, PostComposer, PostList } from "./posts";
import { HistoryScreen, PostPage } from "./people";
import { SearchScreen } from "./search-tab";
import { ActivityScreen } from "./activity-tab";
import { MePage, PersonPage } from "./profile";
import { VibexSettingsScreen } from "./settings";
import { useEdgeSwipe } from "@/ui/edge-swipe";
import { mayStart } from "@/os/gesture-priority";
import { ShareSheet } from "./share-sheet";
import { DRAWER_WIDTH, SidebarPanel, drawerProgress } from "./sidebar";
import { PushDrawer } from "@/ui/push-drawer";
import { useActivityCount, useChats, useFeed } from "./data";
import { VibexHeader, VibexSearchButton, VibexTitle } from "./header";
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
  activity: "vibex.nav.activity",
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
      // Step 2.10: the Search tab (accounts, posts, the grid of public photos and videos).
      return <SearchScreen />;
    case "activity":
      return <ActivityScreen />;
    case "history":
    case "bookmarks":
      return <HistoryScreen />;
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
  const [hostWidth, setHostWidth] = useState(1100);
  useEffect(() => {
    if (!host) return;
    const ro = new ResizeObserver(() => {
      setNarrow(host.clientWidth < 860);
      setHostWidth(host.clientWidth);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [host]);
  // Step 2.9: the chat list column is 300–360 px (by the window's width); the conversation takes the rest.
  const listWidth = Math.round(Math.max(300, Math.min(360, hostWidth * 0.3)));
  const collapsed = manual ?? narrow;
  const page = stack.at(-1);

  return (
    <>
      <span ref={(el) => setHost(el?.parentElement ?? null)} className="hidden" aria-hidden />
      <SidebarPanel variant="rail" collapsed={collapsed} onToggle={() => setManual(!collapsed)} />

      {section === "chats" && !page ? (
        <div className="flex min-w-0 flex-1">
          {/* Step 2.10: the column is a plain surface, so the chat cards take the secondary tone on it. */}
          <section className="relative flex shrink-0 flex-col border-r bg-surface [--chat-card:var(--surface-secondary)]" style={{ width: listWidth }} data-testid="vibex-chat-column">
            <ChatsPane
              header={(stories) => (
                <WindowHeader menu={false}>
                  <VibexTitle className="flex-1 justify-start pl-1.5">{t("vibex.nav.messages")}</VibexTitle>
                  {stories}
                </WindowHeader>
              )}
            />
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
          <WindowHeader className="bg-surface/90 backdrop-blur">
            {page && (
              <IconButton label={t("common.back")} onClick={back} data-testid="vibex-back">
                <RiArrowLeftLine className="size-5" />
              </IconButton>
            )}
            {!page && <VibexTitle className="justify-start pl-1.5">{t(SECTION_TITLE[section])}</VibexTitle>}
            {/* Step 2.11: the same search button as on phones (Главная, Профиль): it opens the Search tab. */}
            {!page && (section === "feed" || section === "me") && <VibexSearchButton className="ml-auto" />}
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
  const section = useVibex((s) => s.section);
  const go = useVibex((s) => s.go);
  const stack = useVibex((s) => s.stack);
  const back = useVibex((s) => s.back);
  const chatId = useVibex((s) => s.chatId);
  const drawer = useVibex((s) => s.drawer);
  const setDrawer = useVibex((s) => s.setDrawer);
  const unread = (useChats().data ?? []).reduce((n, c) => n + c.unread, 0);
  const root = useRef<HTMLDivElement>(null);
  // A swipe to the right from anywhere opens the side menu (only on the main screens, not over a chat / page).
  useEdgeSwipe(root, { enabled: !drawer && !chatId && stack.length === 0, onOpen: () => setDrawer(true), progress: drawerProgress, width: DRAWER_WIDTH });

  // Step 2.9: a new post is the floating "+" (feed and profile), like the pencil in «Чаты».
  // Step 2.10: Главная | Поиск | Уведомления | Чаты | Профиль.
  const activityUnread = useActivityCount().data?.unread ?? 0;
  const tabs = [
    { key: "feed" as const, label: "vibex.nav.home" as const, line: RiHome5Line, fill: RiHome5Fill },
    { key: "people" as const, label: "vibex.nav.search" as const, line: RiSearchLine, fill: RiSearchFill },
    { key: "activity" as const, label: "vibex.nav.activity" as const, line: RiNotification3Line, fill: RiNotification3Fill },
    { key: "chats" as const, label: "vibex.nav.messages" as const, line: RiChat3Line, fill: RiChat3Fill },
    { key: "me" as const, label: "vibex.nav.profile" as const, line: RiUser3Line, fill: RiUser3Fill },
  ];

  return (
    // Step 2.10: vertical lists scroll natively but leave sideways moves to the page (the drawer swipe starts anywhere).
    <div ref={root} className="relative flex min-h-0 min-w-0 flex-1 flex-col [&_.scroll-area:not(.overflow-x-auto)]:touch-pan-y">
      {/* Step 2.9: the system side drawer — the menu lies under the screen, which slides right over it (no dimming). */}
      <PushDrawer open={drawer} onClose={() => setDrawer(false)} progress={drawerProgress} width={DRAWER_WIDTH} menu={<SidebarPanel variant="drawer" onClose={() => setDrawer(false)} />} testId="vibex-drawer">
      {/* Step 2.11: one header for every tab (search only on Главная and Профиль). Chats bring their own (with the stories). */}
      {section !== "chats" && <VibexHeader title={t(SECTION_TITLE[section])} search={section === "feed" || section === "me"} />}

      {section === "chats" ? (
        // Step 2.9 (Telegram-like): stacked story avatars beside «Чаты»; pull down for the search, then the stories.
        <ChatsPane
          header={(stories) => <VibexHeader title={t(SECTION_TITLE[section])} beside={stories} />}
        />
      ) : (
        <div className="scroll-area flex-1">
          <Column>
            <SectionBody section={section} />
          </Column>
        </div>
      )}
      {section === "chats" && <NewChatFab className="right-4" style={{ bottom: 80 }} />}
      {(section === "feed" || section === "me") && <NewPostFab className="right-4 bottom-[84px]" />}

      {/* No safe-area padding here: the window frame already keeps the home-indicator area below the app.
          (Adding it again squeezed this 64px bar on iPhone and pushed the icons across the divider.) */}
      {/* Step 2.10: five tabs; on narrow phones (< 380 px) the icons carry them (the labels stay for screen readers). */}
      <nav className="flex h-[68px] shrink-0 items-center justify-around border-t bg-surface px-1" data-testid="vibex-tabbar">
        {tabs.map((item) => {
          const active = section === item.key;
          const Icon = active ? item.fill : item.line;
          const badge = item.key === "chats" ? unread : item.key === "activity" ? activityUnread : 0;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => go(item.key)}
              aria-current={active ? "page" : undefined}
              aria-label={t(item.label)}
              className="relative flex min-w-0 flex-1 flex-col items-center gap-0.5 py-1.5 active:scale-95"
              data-testid={`vibex-tab-${item.key}`}
            >
              {/* Step 2.8 (reference): the active tab sits on a soft violet pill. */}
              <span className={cx("relative flex h-8 w-12 items-center justify-center rounded-full transition-colors", active && "bg-primary/10")}>
                <Icon className={cx("size-6 transition-colors", active ? "text-primary" : "text-text-tertiary")} />
                {badge > 0 && (
                  <span
                    className="absolute right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white"
                    data-testid={item.key === "activity" ? "vibex-activity-unread" : "vibex-unread"}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </span>
              <span className={cx("max-w-full truncate px-0.5 text-[11px] font-medium max-[379px]:sr-only", active ? "text-primary" : "text-text-secondary")}>{t(item.label)}</span>
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
      </PushDrawer>
    </div>
  );
}

/**
 * A page over the section (chat, person, post); swipe right to go back.
 * Step 2.9 gesture ownership: a drag that starts on an interactive player
 * (voice waveform, a circle's ring, a carousel — anything marked
 * data-gesture-owner) belongs to it; anywhere else the swipe-back works as
 * before (and only a clearly horizontal drag engages it).
 */
function SlidePage({ children, onBack, z }: { children: ReactNode; onBack: () => void; z: number }) {
  const controls = useDragControls();
  return (
    <motion.div
      // The browser's touch-action stops at the nearest scroller, so vertical lists inside the page are pan-y
      // too: otherwise it claims a horizontal touch (pointercancel) and the swipe back never starts.
      className="absolute inset-0 flex flex-col bg-surface [&_.scroll-area:not(.overflow-x-auto)]:touch-pan-y"
      // dragListener={false} drops motion's own touch-action, so keep vertical scrolling native here.
      style={{ zIndex: z, touchAction: "pan-y" }}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ duration: 0.32, ease: EASE }}
      drag="x"
      dragListener={false}
      dragControls={controls}
      onPointerDown={(e) => {
        // Step 2.10: one priority for every gesture (os/gesture-priority): players and seeks first.
        if (!mayStart("chat-swipe-back", e.target)) return;
        controls.start(e);
      }}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 0.8 }}
      dragDirectionLock
      onDragEnd={(_, info) => (info.offset.x > 110 || info.velocity.x > 700) && onBack()}
      data-testid="vibex-slide-page"
    >
      {children}
    </motion.div>
  );
}
