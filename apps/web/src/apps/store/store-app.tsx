import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiChat3Line,
  RiDownloadCloud2Line,
  RiLinkM,
  RiNotification3Line,
  RiRefreshLine,
  RiSearchLine,
  RiUpload2Line,
  RiShieldCheckLine,
  RiStarLine,
} from "@remixicon/react";
import { APP_REGISTRY, toPublicAddress, type AppCategory } from "@voidex/shared";
import { Avatar, StoreGlyph } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { formatDate, useLanguage, useT, type MessageKey } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useMailDomain } from "@/lib/system";
import { WindowHeader, useWindow } from "@/os/window-context";
import { VoidexShareDialog, type ShareSendInput } from "@/os/share/share-dialog";
import { sendText } from "@/os/share/send-files";
import { EmptyState, Spinner, Switch } from "@/ui/controls";
import { MenuList, Popover, toast, usePopover } from "@/ui/overlays";
import { CATALOG, COLLECTIONS, DEVELOPER, HERO, STORE_APPS, releasesOf, type StoreAppId } from "./catalog";
import { installApp, setAppAutoUpdate, useAppStates, useInstalledRows, useInstalls, useMyReviews, useReviews, useStorePrefs } from "./data";
import { AppRow, GetButton, RoundButton, ScreenshotStrip, ShotViewer, Stars, StoreIcon, StoreSearch, useAppName, useShotKind } from "./parts";
import { RatingSummary, ReviewCard, ReviewSheet, ReviewsPage } from "./reviews";

/**
 * Step 2.11 / 2.12: Appex Store, the VOIDEX app catalog, as a native app (no
 * iframe, no second sign-in, no backend of its own: the VOIDEX session and
 * API; one VOIDEX account is one Store account). Pages: the catalog with its
 * search, an app's page (this device's screenshots, description, versions,
 * ratings and reviews, more apps), all reviews, the version history, the
 * developer's apps, and the account: updates, auto-update, update
 * notifications, my reviews. Every button does something real.
 */

type Page =
  | { kind: "home" }
  | { kind: "all"; developer?: boolean }
  | { kind: "app"; id: StoreAppId }
  | { kind: "reviews"; id: StoreAppId }
  | { kind: "versions"; id: StoreAppId }
  | { kind: "account" }
  | { kind: "updates" }
  | { kind: "myReviews" };

const CATEGORY: Record<AppCategory, MessageKey> = {
  work: "store.category.work",
  communication: "store.category.communication",
  media: "store.category.media",
  tools: "store.category.tools",
  developer: "store.category.developer",
  entertainment: "store.category.entertainment",
  system: "store.category.system",
};

/** Step 2.12: a link that opens an app's page in the Store (workspace.tsx follows #store/app/<id>). */
export const storeLink = (id: StoreAppId) => `${window.location.origin}/#store/app/${id}`;

/** Apps matching a query: name, category, developer, keywords and subtitle, in the interface language (and English). */
function useMatch() {
  const lang = useLanguage();
  const t = useT();
  return (q: string) => {
    const s = q.trim().toLocaleLowerCase(lang);
    if (!s) return [];
    return STORE_APPS.filter((id) => {
      const m = APP_REGISTRY[id];
      const hay = [m.name[lang], m.name.en, ...(m.keywords[lang] ?? []), ...m.keywords.en, t(CATEGORY[m.category]), t(CATALOG[id].subtitle), DEVELOPER.name].join(" ").toLocaleLowerCase(lang);
      return hay.includes(s);
    });
  };
}

/** The page a deep link asks for (window params): an app's page, the updates, the account. */
function linked(params: Record<string, unknown> | undefined): Page[] | null {
  const id = params?.appId as StoreAppId | undefined;
  if (id && STORE_APPS.includes(id)) return [{ kind: "home" }, { kind: "app", id }];
  if (params?.page === "updates") return [{ kind: "home" }, { kind: "account" }, { kind: "updates" }];
  if (params?.page === "account") return [{ kind: "home" }, { kind: "account" }];
  return null;
}

export function StoreApp() {
  const t = useT();
  const ff = useFormFactor();
  const win = useWindow();
  const [stack, setStack] = useState<Page[]>(() => linked(win.params) ?? [{ kind: "home" }]);
  // A link followed while the Store is open (a notification, a shared link) shows its page.
  const seen = useRef(win.paramsVersion);
  useEffect(() => {
    if (win.paramsVersion === seen.current) return;
    seen.current = win.paramsVersion;
    const next = linked(win.params);
    if (next) setStack(next);
  }, [win.paramsVersion, win.params]);
  const page = stack.at(-1)!;
  const push = (p: Page) => setStack((s) => [...s, p]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const scroller = useRef<HTMLDivElement>(null);
  // Braces: newer browsers return a Promise from scrollTo, and an effect may only return a clean-up.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [stack.length, page.kind]);

  const [q, setQ] = useState("");
  const openApp = (id: StoreAppId) => push({ kind: "app", id });
  const top = page.kind === "home";

  return (
    <div className="vx-app relative flex min-h-0 flex-1 flex-col" data-testid="store-app" data-page={page.kind}>
      {/* Step 2.12: no bar around the top: on inner pages only Back (left) and, on an app's page, Share (right). */}
      {(!top || ff === "desktop") && (
        <WindowHeader className="bg-transparent" right={page.kind === "app" ? <ShareButton id={page.id} /> : undefined}>
          {top ? (
            <span className="flex items-center gap-2 pl-1 text-text-secondary">
              <StoreGlyph className="size-6" />
              <span className="text-[15px] font-semibold">Appex Store</span>
            </span>
          ) : (
            <RoundButton label={t("common.back")} onClick={back} testId="store-back">
              <RiArrowLeftSLine className="size-6" />
            </RoundButton>
          )}
        </WindowHeader>
      )}
      <div ref={scroller} className="scroll-area min-h-0 flex-1">
        <div className={cx("mx-auto flex w-full max-w-[920px] flex-col gap-6 px-4 pb-10", top && ff === "mobile" ? "pt-[max(var(--safe-top),14px)]" : "pt-2")}>
          {top && (
            <>
              <div className="flex items-center justify-between gap-3">
                <h1 className="text-[32px] font-bold leading-tight tracking-tight" data-testid="store-title">
                  {t(q.trim() ? "store.searchTitle" : "store.title")}
                </h1>
                <AccountButton onClick={() => push({ kind: "account" })} />
              </div>
              <StoreSearch value={q} onChange={setQ} onExit={() => setQ("")} placeholder={t("store.searchHint")} />
            </>
          )}
          {top && q.trim() ? (
            <SearchResults q={q} onOpen={openApp} />
          ) : page.kind === "home" ? (
            <Home onOpen={openApp} onAll={() => push({ kind: "all" })} />
          ) : page.kind === "all" ? (
            <AllApps onOpen={openApp} developer={page.developer} />
          ) : page.kind === "app" ? (
            <AppPage
              id={page.id}
              onOpen={openApp}
              onReviews={() => push({ kind: "reviews", id: page.id })}
              onVersions={() => push({ kind: "versions", id: page.id })}
              onDeveloper={() => push({ kind: "all", developer: true })}
              key={page.id}
            />
          ) : page.kind === "reviews" ? (
            <ReviewsPage appId={page.id} />
          ) : page.kind === "versions" ? (
            <VersionsPage id={page.id} />
          ) : page.kind === "account" ? (
            <AccountPage onUpdates={() => push({ kind: "updates" })} onReviews={() => push({ kind: "myReviews" })} />
          ) : page.kind === "updates" ? (
            <UpdatesPage onOpen={openApp} />
          ) : (
            <MyReviewsPage onOpen={openApp} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Step 2.12: the account's avatar (top right of the catalog): opens the Store's account page. */
function AccountButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  const user = useSession((s) => s.user);
  const pending = usePendingUpdates().length;
  if (!user) return null;
  const name = `${user.firstName} ${user.lastName}`.trim();
  return (
    <button type="button" onClick={onClick} aria-label={t("store.account")} className="pressable relative shrink-0 rounded-full" data-testid="store-account-open">
      <Avatar name={name} userId={user.id} version={user.avatarVersion} size={40} />
      {pending > 0 && (
        <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[11px] font-semibold text-white ring-2 ring-[var(--surface)]" data-testid="store-account-badge">
          {pending}
        </span>
      )}
    </button>
  );
}

/** Step 2.12: Share on an app's page: the phone's share sheet (else the link is copied); on a computer a menu: copy the link or send it in Vibex. */
function ShareButton({ id }: { id: StoreAppId }) {
  const t = useT();
  const ff = useFormFactor();
  const name = useAppName()(id);
  const pop = usePopover();
  const [vibex, setVibex] = useState(false);
  const link = storeLink(id);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: t("store.linkCopied"), tone: "success" });
    } catch {
      toast({ title: link });
    }
  };
  const share = async () => {
    if (ff === "mobile" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: `Appex Store · ${name}`, text: t(CATALOG[id].subtitle), url: link });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return;
      }
    }
    if (ff === "mobile") return void copy();
    pop.toggle();
  };
  const send = async (input: ShareSendInput) => {
    const text = `${t("store.shareText", { app: name })}\n${link}`;
    await sendText(input, `Appex Store · ${name}`, input.text.trim() ? `${input.text.trim()}\n\n${text}` : text);
  };
  return (
    <>
      <button
        ref={pop.anchor}
        type="button"
        onClick={() => void share()}
        aria-label={t("store.share")}
        title={t("store.share")}
        className="pressable flex size-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-surface text-text-secondary shadow-[0_4px_14px_-10px_rgba(40,30,90,0.35)]"
        data-testid="store-share-open"
      >
        <RiUpload2Line className="size-5" />
      </button>
      <Popover open={pop.open} onClose={pop.close} anchor={pop.anchor} testId="store-share-menu">
        <MenuList
          onDone={pop.close}
          items={[
            { id: "store-copy-link", label: t("store.copyLink"), icon: <RiLinkM className="size-5" />, onSelect: () => void copy() },
            { id: "store-send-vibex", label: t("store.sendVibex"), icon: <RiChat3Line className="size-5" />, onSelect: () => setVibex(true) },
          ]}
        />
      </Popover>
      <VoidexShareDialog
        subject={vibex ? { key: `store:${id}`, icon: <StoreIcon id={id} size={48} />, title: name, hint: t(CATALOG[id].subtitle) } : null}
        onClose={() => setVibex(false)}
        onSend={send}
        testId="store-share"
        sentTitle={t("store.shared")}
      />
    </>
  );
}

/** Step 2.12: results while typing (an empty field shows the catalog again; X clears). */
function SearchResults({ q, onOpen }: { q: string; onOpen: (id: StoreAppId) => void }) {
  const t = useT();
  const found = useMatch()(q);
  const kind = useShotKind();
  const [shot, setShot] = useState<{ id: StoreAppId; i: number } | null>(null);
  return (
    <section className="flex flex-col gap-5" data-testid="store-search-results" data-count={found.length}>
      {found.length ? (
        found.map((id) => (
          <div key={id} className="flex flex-col gap-2" data-testid="store-search-result" data-app={id}>
            <AppRow id={id} onOpen={onOpen} />
            <ScreenshotStrip id={id} kind={kind} onOpen={(i) => setShot({ id, i })} />
          </div>
        ))
      ) : (
        <EmptyState icon={<RiSearchLine className="size-7" />} title={t("store.nothingFound")} hint={t("store.nothingFoundHint")} />
      )}
      <ShotViewer shots={shot ? CATALOG[shot.id].screenshots[kind] : []} index={shot?.i ?? null} onIndex={(i) => setShot((s) => (s && i !== null ? { ...s, i } : null))} />
    </section>
  );
}

/** The carousel of the catalog: one story per app, by itself every 6.5 s, swiped by hand, dots to pick. */
function Hero({ onOpen }: { onOpen: (id: StoreAppId) => void }) {
  const t = useT();
  const name = useAppName();
  const reduced = useReducedMotion();
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [hold, setHold] = useState(false);
  const go = (i: number, smooth = true) => {
    const el = strip.current;
    if (!el) return;
    const n = (i + HERO.length) % HERO.length;
    el.scrollTo({ left: n * el.clientWidth, behavior: smooth && !reduced ? "smooth" : ("instant" as ScrollBehavior) });
    setIndex(n);
  };
  useEffect(() => {
    if (hold || reduced) return;
    const id = window.setTimeout(() => !document.hidden && go(index + 1), 6500);
    return () => window.clearTimeout(id);
  }, [index, hold, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section aria-label={t("store.featured")} data-testid="store-hero" data-index={index} onPointerEnter={() => setHold(true)} onPointerLeave={() => setHold(false)} onFocusCapture={() => setHold(true)} onBlurCapture={() => setHold(false)}>
      <div
        ref={strip}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-[28px] [scrollbar-width:none]"
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (i !== index) setIndex(i);
        }}
        onTouchStart={() => setHold(true)}
        onTouchEnd={() => setHold(false)}
      >
        {HERO.map((h) => (
          <article key={h.id} className={cx("relative flex w-full shrink-0 snap-center flex-col justify-between bg-gradient-to-br p-5 text-white", h.tone)} style={{ minHeight: 210 }} data-testid="store-hero-card" data-app={h.id}>
            <button type="button" className="absolute inset-0" onClick={() => onOpen(h.id)} aria-label={t("store.more", { app: name(h.id) })} />
            <div className="pointer-events-none">
              <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-white/80">{t("store.discover")}</div>
              <h2 className="mt-1 text-[24px] font-bold leading-tight">{t(h.title)}</h2>
              <p className="mt-1 max-w-[460px] text-[14.5px] text-white/85">{t(h.text)}</p>
            </div>
            <div className="relative mt-4 flex items-center gap-3 rounded-[18px] bg-white/14 p-2.5 backdrop-blur">
              <StoreIcon id={h.id} size={44} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{name(h.id)}</span>
                <span className="block truncate text-[12.5px] text-white/80">{t(CATALOG[h.id].subtitle)}</span>
              </span>
              <GetButton id={h.id} onColor />
            </div>
          </article>
        ))}
      </div>
      <div className="mt-2.5 flex justify-center gap-1.5">
        {HERO.map((h, i) => (
          <button
            key={h.id}
            type="button"
            onClick={() => go(i)}
            aria-label={t("store.slide", { n: i + 1, app: name(h.id) })}
            aria-pressed={i === index}
            className={cx("h-2 rounded-full transition-all", i === index ? "w-5 bg-primary" : "w-2 bg-border")}
            data-testid="store-hero-dot"
          />
        ))}
      </div>
    </section>
  );
}

function Section({ title, apps, onOpen, onAll, testId = "store-section" }: { title: string; apps: StoreAppId[]; onOpen: (id: StoreAppId) => void; onAll?: () => void; testId?: string }) {
  const t = useT();
  return (
    <section data-testid={testId}>
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] font-bold tracking-tight">{title}</h2>
        {onAll && (
          <button type="button" onClick={onAll} className="flex items-center text-[14px] font-medium text-primary" data-testid="store-see-all">
            {t("store.seeAll")} <RiArrowRightSLine className="size-5" />
          </button>
        )}
      </div>
      <div className="mt-1 divide-y divide-border/60">
        {apps.map((id) => (
          <AppRow key={id} id={id} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function Home({ onOpen, onAll }: { onOpen: (id: StoreAppId) => void; onAll: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-7" data-testid="store-home">
      <Hero onOpen={onOpen} />
      {COLLECTIONS.map((c) => (
        <Section key={c.title} title={t(c.title)} apps={c.apps} onOpen={onOpen} onAll={onAll} />
      ))}
    </div>
  );
}

function AllApps({ onOpen, developer }: { onOpen: (id: StoreAppId) => void; developer?: boolean }) {
  const t = useT();
  const name = useAppName();
  const lang = useLanguage();
  const sorted = useMemo(() => [...STORE_APPS].sort((a, b) => new Intl.Collator(lang).compare(name(a), name(b))), [lang]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="flex flex-col" data-testid={developer ? "store-developer" : "store-all"}>
      <h1 className="text-[26px] font-bold tracking-tight">{developer ? DEVELOPER.name : t("store.allApps")}</h1>
      {developer && <p className="mt-1 text-[14px] text-text-secondary">{t("store.developerHint")}</p>}
      <div className="mt-2 divide-y divide-border/60">
        {sorted.map((id, i) => (
          <AppRow key={id} id={id} onOpen={onOpen} rank={developer ? undefined : i + 1} />
        ))}
      </div>
    </section>
  );
}

/** An app's page. */
function AppPage({ id, onOpen, onReviews, onVersions, onDeveloper }: { id: StoreAppId; onOpen: (id: StoreAppId) => void; onReviews: () => void; onVersions: () => void; onDeveloper: () => void }) {
  const t = useT();
  const lang = useLanguage();
  const name = useAppName()(id);
  const m = APP_REGISTRY[id];
  const entry = CATALOG[id];
  const kind = useShotKind();
  const reviews = useReviews(id, "helpful");
  const state = useAppStates()[id];
  const row = useInstalledRows()[id];
  const [prefs] = useStorePrefs();
  const [shot, setShot] = useState<number | null>(null);
  const [writing, setWriting] = useState(false);
  const stats = reviews.data?.stats;
  const top = (reviews.data?.items ?? []).slice(0, 2);
  const release = releasesOf(id)[0];
  const auto = row?.autoUpdate ?? prefs.autoUpdate;
  return (
    <div className="flex flex-col gap-6" data-testid="store-app-page" data-app={id}>
      <section className="flex items-center gap-4">
        <StoreIcon id={id} size={96} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[26px] font-bold leading-tight tracking-tight" data-testid="store-app-name">
            {name}
          </h1>
          <p className="truncate text-[14px] text-text-secondary">{t(entry.subtitle)}</p>
          <div className="mt-2.5">
            <GetButton id={id} size="lg" />
          </div>
        </div>
      </section>

      {/* Phones: the four facts scroll sideways at their own width (never cut); a computer has room for four columns. */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0" data-testid="store-stats">
        <Stat value={stats && stats.total ? stats.average.toFixed(1) : "–"} label={t("store.stat.rating", { n: stats?.total ?? 0 })} />
        <Stat value={t(CATEGORY[m.category])} label={t("store.stat.category")} />
        <Stat value={m.version} label={t("store.stat.version")} />
        <Stat value={DEVELOPER.name} label={t("store.stat.developer")} />
      </div>

      <section>
        <h2 className="mb-2 text-[20px] font-bold tracking-tight">{t("store.screenshots")}</h2>
        <ScreenshotStrip id={id} kind={kind} onOpen={setShot} />
        <ShotViewer shots={entry.screenshots[kind]} index={shot} onIndex={setShot} />
      </section>

      <section data-testid="store-description">
        <p className="whitespace-pre-line text-[15px] leading-relaxed text-text">{t(entry.description)}</p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {entry.features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-[14.5px] text-text-secondary">
              <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              {t(f)}
            </li>
          ))}
        </ul>
      </section>

      {release && (
        <button type="button" onClick={onVersions} className="flex flex-col gap-1.5 rounded-[22px] border border-border/60 bg-surface p-4 text-left shadow-[0_8px_22px_-18px_rgba(40,30,110,0.35)]" data-testid="store-news">
          <span className="flex w-full items-baseline justify-between gap-3">
            <span className="text-[17px] font-bold">{t("store.whatsNew")}</span>
            <span className="flex items-center text-[13.5px] font-medium text-primary" data-testid="store-versions-open">
              {t("store.versionHistory")} <RiArrowRightSLine className="size-4" />
            </span>
          </span>
          <span className="text-[13px] text-text-tertiary">
            {t("store.version", { v: release.version })} · {formatDate(new Date(release.date), lang, { day: "numeric", month: "long", year: "numeric" })}
          </span>
          <span className="text-[14.5px] text-text-secondary">{t(release.notes.title)}</span>
        </button>
      )}

      <button type="button" onClick={onDeveloper} className="flex items-center gap-3 rounded-[22px] border border-border/60 bg-surface p-4 text-left shadow-[0_8px_22px_-18px_rgba(40,30,110,0.35)]" data-testid="store-developer-link">
        <RiShieldCheckLine className="size-6 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{t("store.developer", { name: DEVELOPER.name })}</span>
          <span className="block text-[13px] text-text-secondary">{t("store.developerAll")}</span>
        </span>
        <RiArrowRightSLine className="size-5 text-text-tertiary" />
      </button>

      {state !== "get" && (
        <div className="flex items-center gap-3 rounded-[22px] border border-border/60 bg-surface px-4 py-3" data-testid="store-app-auto">
          <RiRefreshLine className="size-5 shrink-0 text-text-secondary" />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">{t("store.autoUpdateApp")}</span>
            <span className="block text-[12.5px] text-text-tertiary">{t(row?.autoUpdate == null ? "store.autoUpdateFollows" : "store.autoUpdateOwn")}</span>
          </span>
          <Switch checked={auto} label={t("store.autoUpdateApp")} onChange={(v) => void setAppAutoUpdate(id, v === prefs.autoUpdate ? null : v)} />
        </div>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-bold tracking-tight">{t("store.reviews")}</h2>
          <button type="button" onClick={onReviews} className="flex items-center text-[14px] font-medium text-primary" data-testid="store-all-reviews">
            {t("store.seeAll")} <RiArrowRightSLine className="size-5" />
          </button>
        </div>
        <RatingSummary data={reviews.data} />
        {top.map((r) => (
          <ReviewCard key={r.id} appId={id} r={r} onEdit={() => setWriting(true)} />
        ))}
        <button type="button" onClick={() => setWriting(true)} className="flex h-11 items-center justify-center gap-2 rounded-full bg-surface-secondary text-[15px] font-semibold text-primary" data-testid="store-write-review">
          <Stars value={0} size={14} /> {t(reviews.data?.mine ? "store.review.edit" : "store.review.write")}
        </button>
      </section>

      {/* Step 2.12: more real apps of the catalog (never this one, the Store or Settings). */}
      <Section title={t("store.more.space")} apps={STORE_APPS.filter((x) => x !== id)} onOpen={onOpen} testId="store-more" />

      <ReviewSheet open={writing} appId={id} mine={reviews.data?.mine ?? null} onClose={() => setWriting(false)} />
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-[92px] shrink-0 flex-col gap-0.5 rounded-[16px] border border-border/60 bg-surface px-3 py-2.5 sm:min-w-0">
      <strong className="max-w-full truncate text-[16px] font-semibold text-text">{value}</strong>
      <span className="max-w-full truncate text-[11.5px] text-text-tertiary">{label}</span>
    </div>
  );
}

/** Step 2.12: every release of the app, newest first: the version, its date, what it brought; the current one is marked. */
function VersionsPage({ id }: { id: StoreAppId }) {
  const t = useT();
  const lang = useLanguage();
  const name = useAppName()(id);
  const installed = useInstalledRows()[id]?.version;
  const list = releasesOf(id);
  return (
    <section className="flex flex-col" data-testid="store-versions" data-app={id}>
      <div className="flex items-center gap-2 self-end text-[13.5px] text-text-secondary">
        <StoreIcon id={id} size={28} /> {name}
      </div>
      <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">{t("store.versions.eyebrow")}</p>
      <h1 className="mt-1 text-[32px] font-bold leading-tight tracking-tight">{t("store.versionHistory")}</h1>
      <p className="mt-1 text-[14.5px] text-text-secondary">{t("store.versions.hint")}</p>
      <ol className="mt-6 flex flex-col gap-4 border-l border-primary/25 pl-5">
        {list.map((r, i) => (
          <li key={r.version} className="relative rounded-[22px] border border-border/60 bg-surface p-4 shadow-[0_8px_22px_-18px_rgba(40,30,110,0.35)]" data-testid="store-release" data-version={r.version}>
            <span className={cx("absolute -left-[29px] top-6 size-3.5 rounded-full border-[3px] border-surface", i === 0 ? "bg-primary" : "bg-border-strong")} aria-hidden />
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-[24px] font-bold tracking-tight">{r.version}</strong>
              {i === 0 && (
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[12px] font-medium text-primary" data-testid="store-release-current">
                  {t("store.versions.current")}
                </span>
              )}
              {installed === r.version && i > 0 && <span className="rounded-full bg-surface-secondary px-2.5 py-0.5 text-[12px] text-text-secondary">{t("store.versions.installed")}</span>}
            </div>
            <p className="mt-0.5 text-[13px] text-text-tertiary">{formatDate(new Date(r.date), lang, { day: "numeric", month: "long", year: "numeric" })}</p>
            <h2 className="mt-2.5 text-[16px] font-semibold">{t(r.notes.title)}</h2>
            <ul className="mt-1.5 flex flex-col gap-1">
              {r.notes.items.map((k) => (
                <li key={k} className="flex items-start gap-2 text-[14.5px] text-text-secondary">
                  <span className="mt-[8px] size-1.5 shrink-0 rounded-full bg-text-tertiary" aria-hidden />
                  {t(k)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ------------------------------------------------------------------ account

/** Installed catalog apps (on the desktop) with a newer version available. */
function usePendingUpdates(): StoreAppId[] {
  const states = useAppStates();
  return STORE_APPS.filter((id) => states[id] === "update");
}

function AccountPage({ onUpdates, onReviews }: { onUpdates: () => void; onReviews: () => void }) {
  const t = useT();
  const user = useSession((s) => s.user);
  const mailDomain = useMailDomain();
  const states = useAppStates();
  const pending = usePendingUpdates();
  const [prefs, setPrefs] = useStorePrefs();
  if (!user) return null;
  const name = `${user.firstName} ${user.lastName}`.trim();
  const installed = STORE_APPS.filter((id) => states[id] !== "get").length;
  return (
    <section className="flex flex-col gap-5" data-testid="store-account">
      <div className="flex items-center gap-4 rounded-[24px] border border-border/60 bg-surface p-4 shadow-[0_8px_22px_-18px_rgba(40,30,110,0.35)]">
        <Avatar name={name} userId={user.id} version={user.avatarVersion} size={64} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[19px] font-bold" data-testid="store-account-name">
            {name}
          </p>
          <p className="truncate text-[14px] text-text-secondary" data-testid="store-account-address">
            {toPublicAddress(user.mailAddress, mailDomain)}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat value={String(installed)} label={t("store.account.installed")} />
        <Stat value={String(pending.length)} label={t("store.account.pending")} />
      </div>
      <div className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-[22px] border border-border/60 bg-surface">
        <button type="button" onClick={onUpdates} className="flex h-14 items-center gap-3 px-4 text-left hover:bg-surface-hover" data-testid="store-account-updates">
          <RiDownloadCloud2Line className="size-5 text-text-secondary" />
          <span className="flex-1 text-[15.5px]">{t("store.updates.title")}</span>
          {pending.length > 0 && <span className="rounded-full bg-primary px-2 text-[12px] font-semibold leading-5 text-white">{pending.length}</span>}
          <RiArrowRightSLine className="size-5 text-text-tertiary" />
        </button>
        <div className="flex min-h-14 items-center gap-3 px-4 py-2">
          <RiRefreshLine className="size-5 text-text-secondary" />
          <span className="min-w-0 flex-1">
            <span className="block text-[15.5px]">{t("store.autoUpdate")}</span>
            <span className="block text-[12.5px] text-text-tertiary">{t("store.autoUpdateHint")}</span>
          </span>
          <span data-testid="store-pref-auto">
            <Switch checked={prefs.autoUpdate} label={t("store.autoUpdate")} onChange={(v) => setPrefs({ autoUpdate: v })} />
          </span>
        </div>
        <div className="flex min-h-14 items-center gap-3 px-4 py-2">
          <RiNotification3Line className="size-5 text-text-secondary" />
          <span className="min-w-0 flex-1">
            <span className="block text-[15.5px]">{t("store.updateNotifications")}</span>
            <span className="block text-[12.5px] text-text-tertiary">{t("store.updateNotificationsHint")}</span>
          </span>
          <span data-testid="store-pref-notify">
            <Switch checked={prefs.updateNotifications} label={t("store.updateNotifications")} onChange={(v) => setPrefs({ updateNotifications: v })} />
          </span>
        </div>
        <button type="button" onClick={onReviews} className="flex h-14 items-center gap-3 px-4 text-left hover:bg-surface-hover" data-testid="store-account-reviews">
          <RiStarLine className="size-5 text-text-secondary" />
          <span className="flex-1 text-[15.5px]">{t("store.myReviews")}</span>
          <RiArrowRightSLine className="size-5 text-text-tertiary" />
        </button>
      </div>
    </section>
  );
}

/** Step 2.12: the update center: what can be updated (installed vs. new version) and what was updated lately. */
function UpdatesPage({ onOpen }: { onOpen: (id: StoreAppId) => void }) {
  const t = useT();
  const lang = useLanguage();
  const name = useAppName();
  const rows = useInstalledRows();
  const states = useAppStates();
  const busy = useInstalls((s) => s.busy);
  const pending = usePendingUpdates();
  const recent = STORE_APPS.filter((id) => states[id] !== "get" && rows[id]?.updatedAt).sort((a, b) => (rows[b]!.updatedAt! > rows[a]!.updatedAt! ? 1 : -1));
  const updateAll = async () => {
    for (const id of pending) await installApp(id).catch(() => undefined);
  };
  return (
    <section className="flex flex-col gap-6" data-testid="store-updates">
      <h1 className="text-[28px] font-bold tracking-tight">{t("store.updates.title")}</h1>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[17px] font-bold">{t("store.updates.available")}</h2>
          {pending.length > 1 && (
            <button type="button" onClick={() => void updateAll()} className="text-[14px] font-medium text-primary" data-testid="store-update-all">
              {t("store.updates.all")}
            </button>
          )}
        </div>
        {pending.length ? (
          <div className="divide-y divide-border/60">
            {pending.map((id) => (
              <div key={id} className="flex items-center gap-3 py-2.5" data-testid="store-update-row" data-app={id}>
                <button type="button" onClick={() => onOpen(id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <StoreIcon id={id} size={52} />
                  <span className="min-w-0">
                    <span className="block truncate text-[15.5px] font-semibold">{name(id)}</span>
                    <span className="block truncate text-[13px] text-text-secondary" data-testid="store-update-versions">
                      {rows[id]?.version} → {APP_REGISTRY[id].version}
                    </span>
                  </span>
                </button>
                {busy[id] ? <Spinner size={18} /> : <GetButton id={id} />}
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-[18px] bg-surface-secondary px-4 py-3.5 text-[14.5px] text-text-secondary" data-testid="store-updates-none">
            {t("store.updates.none")}
          </p>
        )}
      </div>
      <div>
        <h2 className="mb-1 text-[17px] font-bold">{t("store.updates.recent")}</h2>
        {recent.length ? (
          <div className="divide-y divide-border/60">
            {recent.map((id) => (
              <div key={id} className="flex items-center gap-3 py-2.5" data-testid="store-recent-row" data-app={id}>
                <button type="button" onClick={() => onOpen(id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <StoreIcon id={id} size={52} />
                  <span className="min-w-0">
                    <span className="block truncate text-[15.5px] font-semibold">{name(id)}</span>
                    <span className="block truncate text-[13px] text-text-secondary">
                      {t("store.version", { v: rows[id]!.version ?? "" })} · {formatDate(new Date(rows[id]!.updatedAt!), lang, { day: "numeric", month: "long" })}
                    </span>
                  </span>
                </button>
                <GetButton id={id} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[14px] text-text-tertiary">{t("store.updates.noRecent")}</p>
        )}
      </div>
    </section>
  );
}

/** Step 2.12: the reviews I wrote: the app, my stars, the date, the start of the text; a tap opens the app's page. */
function MyReviewsPage({ onOpen }: { onOpen: (id: StoreAppId) => void }) {
  const t = useT();
  const lang = useLanguage();
  const name = useAppName();
  const mine = useMyReviews();
  const list = (mine.data ?? []).filter((r): r is typeof r & { appId: StoreAppId } => STORE_APPS.includes(r.appId as StoreAppId));
  return (
    <section className="flex flex-col gap-3" data-testid="store-my-reviews">
      <h1 className="text-[28px] font-bold tracking-tight">{t("store.myReviews")}</h1>
      {mine.isLoading ? (
        <Spinner className="mx-auto mt-6" />
      ) : list.length ? (
        list.map((r) => (
          <button key={r.id} type="button" onClick={() => onOpen(r.appId)} className="flex items-start gap-3 rounded-[22px] border border-border/60 bg-surface p-4 text-left" data-testid="store-my-review" data-app={r.appId}>
            <StoreIcon id={r.appId} size={52} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15.5px] font-semibold">{name(r.appId)}</span>
              <span className="mt-0.5 flex items-center gap-2 text-[12.5px] text-text-tertiary">
                <Stars value={r.rating} size={12} /> {formatDate(new Date(r.editedAt ?? r.createdAt), lang, { day: "numeric", month: "short", year: "numeric" })}
              </span>
              {(r.title || r.text) && <span className="mt-1 line-clamp-2 text-[14px] text-text-secondary">{r.title ? `${r.title}. ${r.text}` : r.text}</span>}
            </span>
          </button>
        ))
      ) : (
        <EmptyState icon={<RiStarLine className="size-7" />} title={t("store.myReviews.empty")} hint={t("store.myReviews.emptyHint")} />
      )}
    </section>
  );
}
