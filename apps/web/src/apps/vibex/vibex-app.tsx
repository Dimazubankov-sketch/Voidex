import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, useTransform } from "motion/react";
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
import { Avatar, VibexGlyph } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT, type MessageKey } from "@/lib/i18n";
import { IconButton } from "@/ui/controls";
import { WindowHeader, useWindow } from "@/os/window-context";
import { Conversation } from "./chats";
import { ChatsEditButton, ChatsPane } from "./chat-home";
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
import { useActivityCount, useChats, useFeed, useFollow, useSuggested, useUpdateSettings, useVibexMe } from "./data";
import { VibexHeader, VibexSearchButton, VibexTitle } from "./header";
import { VibexTabBar } from "./tabbar";
import { PublicationViewerHost } from "./publications";
import type { VibexFeedMode, VibexPersonDto } from "@voidex/shared";
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
      <PublicationViewerHost />
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

/** Step 2.15: «Рекомендации» or «Подписки» for Главная, kept in the account's Vibex settings. */
function useFeedMode(): [VibexFeedMode, (m: VibexFeedMode) => void] {
  const raw = useVibexMe().data?.settings.feed?.mode;
  const mode: VibexFeedMode = raw === "following" ? "following" : "recommended";
  const update = useUpdateSettings();
  return [mode, (m) => m !== mode && update.mutate({ feed: { mode: m } })];
}

/** Step 2.15: Главная's two tabs (posts only), a segmented switch with one sliding pill. */
function FeedModeSwitch({ className }: { className?: string }) {
  const t = useT();
  const [mode, setMode] = useFeedMode();
  const modes = [
    { key: "recommended" as const, label: t("vibex.feed.modeRecommended") },
    { key: "following" as const, label: t("vibex.feed.modeFollowing") },
  ];
  return (
    <div role="tablist" aria-label={t("vibex.feed.mode")} className={cx("vx-feed-switch relative grid h-10 grid-cols-2 rounded-full p-1", className)} data-testid="feed-mode" data-mode={mode}>
      {modes.map((m) => {
        const on = m.key === mode;
        return (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => setMode(m.key)}
            className={cx("relative z-[1] rounded-full text-[14px] font-semibold transition-colors", on ? "text-text" : "text-text-secondary")}
            data-testid={`feed-mode-${m.key}`}
          >
            {on && <motion.span layoutId="vx-feed-mode" className="vx-feed-switch-pill absolute inset-0 -z-[1] rounded-full" transition={{ type: "spring", stiffness: 480, damping: 38 }} />}
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

/** Главная: posts only (publications live in profiles). «Подписки» shows only the people I follow. */
function Feed({ switcher = true }: { switcher?: boolean }) {
  const [mode] = useFeedMode();
  const feed = useFeed(mode);
  return (
    <div className="flex flex-col gap-3" data-testid="vibex-feed" data-mode={mode}>
      {switcher && <FeedModeSwitch className="mx-auto w-full max-w-[320px]" />}
      <ComposerPrompt />
      <PostList key={mode} query={feed} empty={mode === "following" ? <FollowingEmpty /> : <FeedEmpty />} />
    </div>
  );
}

/**
 * «Подписки» with nobody followed (or nothing posted by them yet). Step 2.16:
 * never an empty screen: people to follow, each with «Подписаться». Someone
 * just followed leaves the list at once and is not suggested again.
 */
function FollowingEmpty() {
  const t = useT();
  const people = useSuggested();
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const list = (people.data ?? []).filter((p) => !gone.has(p.id));
  return (
    <div className="flex flex-col items-center gap-2 px-4 pb-10 pt-8 text-center" data-testid="feed-following-empty">
      <p className="text-[16px] font-semibold text-text">{t("vibex.feed.followingEmpty")}</p>
      <p className="max-w-[320px] text-[14px] text-text-secondary">{t("vibex.feed.suggestHint")}</p>
      {list.length > 0 && (
        <div className="mt-4 w-full max-w-[480px] overflow-hidden rounded-[22px] bg-surface text-left shadow-[0_1px_2px_rgba(20,20,40,0.05)]" data-testid="feed-suggested">
          {list.map((p) => (
            <SuggestedPerson key={p.id} person={p} onFollowed={() => setGone((g) => new Set(g).add(p.id))} />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestedPerson({ person, onFollowed }: { person: VibexPersonDto; onFollowed: () => void }) {
  const t = useT();
  const push = useVibex((s) => s.push);
  const follow = useFollow(person.id);
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 [&+&]:border-t [&+&]:border-border" data-testid="feed-suggested-person" data-person={person.id}>
      <button type="button" onClick={() => push({ kind: "person", id: person.id })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Avatar name={person.name} userId={person.id} version={person.avatarVersion} size={44} />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold text-text">{person.name}</span>
          <span className="block truncate text-[13px] text-text-secondary">{person.address}</span>
        </span>
      </button>
      <button
        type="button"
        disabled={follow.isPending}
        onClick={() => follow.mutate(true, { onSuccess: onFollowed })}
        className="h-9 shrink-0 rounded-full bg-primary px-4 text-[14px] font-semibold text-white transition active:scale-95 disabled:opacity-60"
        data-testid="feed-suggested-follow"
      >
        {t("vibex.profile.follow")}
      </button>
    </div>
  );
}

/**
 * Step 2.13: the feed's top bar (title and the mode switch) slides away while
 * scrolling down and comes back as soon as the scroll turns up (not only at
 * the top): transform and a slight fade, no layout change.
 */
function useHideOnScroll(scroller: React.RefObject<HTMLElement | null>, height: number, enabled: boolean) {
  const y = useMotionValue(0);
  const opacity = useTransform(y, [-height, 0], [0.4, 1]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !enabled) {
      y.set(0);
      return;
    }
    let last = el.scrollTop;
    let hidden = false;
    let travel = 0;
    const show = (v: boolean) => {
      if (hidden === !v) return;
      hidden = !v;
      void animate(y, v ? 0 : -height, {
        type: "spring",
        stiffness: 420,
        damping: 40,
      });
    };
    const onScroll = () => {
      const top = el.scrollTop;
      const d = top - last;
      last = top;
      if (top <= 8) {
        travel = 0;
        return show(true);
      }
      // A little travel in one direction before it reacts (no flicker on tiny moves).
      travel = Math.sign(d) === Math.sign(travel) ? travel + d : d;
      if (travel > 14 && top > height) show(false);
      else if (travel < -10) show(true);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scroller, height, enabled, y]);
  return { y, opacity };
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
  const chatEditing = useVibex((s) => s.chatEditing && s.section === "chats");
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
          <section className="relative flex shrink-0 flex-col border-r bg-surface" style={{ width: listWidth }} data-testid="vibex-chat-column">
            <ChatsPane
              header={(stories) => (
                <WindowHeader menu={false}>
                  <VibexTitle className="flex-1 justify-start pl-1.5">{t("vibex.nav.messages")}</VibexTitle>
                  {stories}
                  <ChatsEditButton className="ml-1" />
                </WindowHeader>
              )}
            />
            {/* The pencil: a new conversation (a person or a group), like the feed's "+" */}
            {!chatEditing && <NewChatFab className="bottom-5 right-5" />}
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
            {!page && section === "me" && <VibexSearchButton className="ml-auto" />}
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
  const chatEditing = useVibex((s) => s.chatEditing && s.section === "chats");
  const drawer = useVibex((s) => s.drawer);
  const setDrawer = useVibex((s) => s.setDrawer);
  const unread = (useChats().data ?? []).reduce((n, c) => n + c.unread, 0);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const feedTop = useHideOnScroll(scroller, 112, section === "feed" && !chatId && stack.length === 0);
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
    <div ref={root} className="vx-has-tabbar relative flex min-h-0 min-w-0 flex-1 flex-col [&_.scroll-area:not(.overflow-x-auto)]:touch-pan-y">
      {/* Step 2.9: the system side drawer — the menu lies under the screen, which slides right over it (no dimming). */}
      <PushDrawer open={drawer} onClose={() => setDrawer(false)} progress={drawerProgress} width={DRAWER_WIDTH} menu={<SidebarPanel variant="drawer" onClose={() => setDrawer(false)} />} testId="vibex-drawer">
      {/* Step 2.11: one header for every tab (search only on Главная and Профиль). Chats bring their own (with the stories). */}
        {/* Step 2.13: no search in Главная's header (the Search tab is right below); its header slides away with the scroll. */}
        {section !== "chats" && section !== "feed" && <VibexHeader title={t(SECTION_TITLE[section])} search={section === "me"} />}
        {section === "feed" && (
          <motion.div className="vx-feed-top absolute inset-x-0 top-0 z-[15]" style={{ y: feedTop.y, opacity: feedTop.opacity }} data-testid="feed-top">
            <VibexHeader title={t(SECTION_TITLE[section])} />
            <div className="px-4 pb-2.5 pt-0.5">
              <FeedModeSwitch className="mx-auto w-full max-w-[320px]" />
            </div>
          </motion.div>
        )}


      {section === "chats" ? (
        // Step 2.9 (Telegram-like): stacked story avatars beside «Чаты»; pull down for the search, then the stories.
        <ChatsPane
          header={(stories) => <VibexHeader title={t(SECTION_TITLE[section])} beside={stories} action={<ChatsEditButton />} />}
        />
      ) : (
          <div ref={scroller} className={cx("vx-tab-scroll scroll-area flex-1", section === "feed" && "pt-[112px]")} data-testid="vibex-scroll">
            <Column>{section === "feed" ? <Feed switcher={false} /> : <SectionBody section={section} />}</Column>
        </div>
      )}
      {section === "chats" && !chatEditing && <NewChatFab className="right-4" style={{ bottom: 80 }} />}
      {(section === "feed" || section === "me") && <NewPostFab className="right-4 bottom-[84px]" />}

        {/* Step 2.13: the floating tab bar of the reference video (one capsule gliding between the tabs). The window
          frame already keeps the home-indicator area below the app; the content scrolls under the bar. */}
        {!chatEditing && <VibexTabBar
          items={tabs.map((tab) => ({
            ...tab,
            badge: tab.key === "chats" ? unread : tab.key === "activity" ? activityUnread : 0,
            badgeTestId: tab.key === "activity" ? "vibex-activity-unread" : "vibex-unread",
          }))}
          active={section}
          onSelect={go}
        />}



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
