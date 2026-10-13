import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { RiArrowLeftLine, RiArrowRightSLine, RiCloseLine, RiDeleteBinLine, RiHistoryLine, RiSearchLine, RiShareForwardLine, RiShieldCheckLine } from "@remixicon/react";
import { APP_REGISTRY, type AppCategory } from "@voidex/shared";
import { StoreGlyph } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useFormFactor } from "@/lib/form-factor";
import { useLanguage, useT, type MessageKey } from "@/lib/i18n";
import { WindowHeader, useWindow } from "@/os/window-context";
import { VoidexShareDialog, type ShareSendInput } from "@/os/share/share-dialog";
import { sendText } from "@/os/share/send-files";
import { IconButton, EmptyState } from "@/ui/controls";
import { ConfirmDialog, toast } from "@/ui/overlays";
import { VoidexSearchField } from "@/ui/search-field";
import { CATALOG, COLLECTIONS, DEVELOPER, HERO, STORE_APPS, type StoreAppId } from "./catalog";
import { removeApp, useAppStates, useReviews, useStoreStats } from "./data";
import { AppRow, GetButton, ScreenshotStrip, ShotViewer, Stars, StoreIcon, useAppName } from "./parts";
import { RatingSummary, ReviewCard, ReviewSheet, ReviewsPage } from "./reviews";

/**
 * Step 2.11: Appex Store, the VOIDEX app catalog, as a native app (from the
 * delivered prototype; no iframe, no second sign-in, no backend of its own:
 * the VOIDEX session and API). Pages: the catalog (a carousel and
 * collections), search (history and matching apps while typing, results
 * with screenshots on Enter), an app's page (screenshots, description,
 * what is new, the developer, ratings and reviews), all reviews, the
 * developer's apps. Every button does something real.
 */

type Page = { kind: "home" } | { kind: "all"; developer?: boolean } | { kind: "app"; id: StoreAppId } | { kind: "reviews"; id: StoreAppId };

const CATEGORY: Record<AppCategory, MessageKey> = {
  work: "store.category.work",
  communication: "store.category.communication",
  media: "store.category.media",
  tools: "store.category.tools",
  entertainment: "store.category.entertainment",
  system: "store.category.system",
};

const HISTORY_KEY = "voidex-store-history";
function loadHistory(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}
function saveHistory(list: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    /* private mode: no history */
  }
}

/** Apps matching a query: name, keywords and category in the interface language (and English). */
function useMatch() {
  const lang = useLanguage();
  const t = useT();
  return (q: string) => {
    const s = q.trim().toLocaleLowerCase(lang);
    if (!s) return [];
    return STORE_APPS.filter((id) => {
      const m = APP_REGISTRY[id];
      const hay = [m.name[lang], m.name.en, ...(m.keywords[lang] ?? []), ...m.keywords.en, t(CATEGORY[m.category]), t(CATALOG[id].subtitle)].join(" ").toLocaleLowerCase(lang);
      return hay.includes(s);
    });
  };
}

export function StoreApp() {
  const t = useT();
  const lang = useLanguage();
  const ff = useFormFactor();
  const win = useWindow();
  const [stack, setStack] = useState<Page[]>(() => {
    const id = win.params?.appId as StoreAppId | undefined;
    return id && STORE_APPS.includes(id) ? [{ kind: "home" }, { kind: "app", id }] : [{ kind: "home" }];
  });
  const page = stack.at(-1)!;
  const push = (p: Page) => setStack((s) => [...s, p]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => scroller.current?.scrollTo({ top: 0 }), [stack.length, page.kind]);

  // Search: typing shows history and matching apps; Enter shows the results; X goes back to the catalog.
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [submitted, setSubmitted] = useState("");
  const [history, setHistory] = useState(loadHistory);
  const submit = (text: string) => {
    const v = text.trim();
    if (!v) return;
    setQ(v);
    setSubmitted(v);
    setSearching(true);
    const next = [v, ...history.filter((h) => h.toLocaleLowerCase() !== v.toLocaleLowerCase())];
    setHistory(next);
    saveHistory(next);
  };
  const closeSearch = () => {
    setQ("");
    setSubmitted("");
    setSearching(false);
  };
  const openApp = (id: StoreAppId) => push({ kind: "app", id });

  const top = page.kind === "home";
  return (
    <div className="vx-app relative flex min-h-0 flex-1 flex-col" data-testid="store-app">
      <WindowHeader className={cx("bg-surface", !top && "border-b")}>
        {!top ? (
          <>
            <IconButton label={t("common.back")} onClick={back} data-testid="store-back">
              <RiArrowLeftLine className="size-5" />
            </IconButton>
            <span className="truncate text-[16px] font-semibold">{page.kind === "app" || page.kind === "reviews" ? APP_REGISTRY[page.id].name[lang] : t(page.developer ? "store.developerApps" : "store.allApps")}</span>
          </>
        ) : (
          <span className="flex items-center gap-2 pl-1">
            <StoreGlyph className="size-6" />
            <span className="text-[16px] font-semibold">Appex Store</span>
          </span>
        )}
      </WindowHeader>
      <div ref={scroller} className="scroll-area min-h-0 flex-1">
        <div className={cx("mx-auto flex w-full max-w-[920px] flex-col gap-6 px-4 pb-10", ff === "desktop" ? "pt-4" : "pt-2")}>
          {top && (
            <>
              <h1 className="text-[32px] font-bold leading-tight tracking-tight" data-testid="store-title">
                {t("store.title")}
              </h1>
              <form
                role="search"
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(q);
                }}
              >
                <span className="min-w-0 flex-1" onFocus={() => setSearching(true)}>
                  <VoidexSearchField value={q} onChange={(v) => (setQ(v), setSubmitted(""), setSearching(true))} placeholder={t("store.searchHint")} testId="store-search" />
                </span>
                {searching && (
                  <button type="button" onClick={closeSearch} aria-label={t("store.closeSearch")} className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-text-secondary" data-testid="store-search-close">
                    <RiCloseLine className="size-5" />
                  </button>
                )}
              </form>
            </>
          )}
          {top && searching ? (
            <SearchBody q={q} submitted={submitted} history={history} onPick={submit} onClear={() => (setHistory([]), saveHistory([]))} onOpen={openApp} />
          ) : page.kind === "home" ? (
            <Home onOpen={openApp} onAll={() => push({ kind: "all" })} />
          ) : page.kind === "all" ? (
            <AllApps onOpen={openApp} developer={page.developer} />
          ) : page.kind === "app" ? (
            <AppPage id={page.id} onReviews={() => push({ kind: "reviews", id: page.id })} onDeveloper={() => push({ kind: "all", developer: true })} key={page.id} />
          ) : (
            <ReviewsPage appId={page.id} />
          )}
        </div>
      </div>
    </div>
  );
}

function SearchBody({ q, submitted, history, onPick, onClear, onOpen }: { q: string; submitted: string; history: string[]; onPick: (q: string) => void; onClear: () => void; onOpen: (id: StoreAppId) => void }) {
  const t = useT();
  const match = useMatch();
  const name = useAppName();
  if (submitted) {
    const found = match(submitted);
    return (
      <section className="flex flex-col gap-5" data-testid="store-search-results">
        <p className="text-[13px] text-text-secondary">{t("store.found", { n: found.length })}</p>
        {found.length ? (
          found.map((id) => <SearchResult key={id} id={id} onOpen={onOpen} />)
        ) : (
          <EmptyState icon={<RiSearchLine className="size-7" />} title={t("store.nothingFound")} hint={t("store.nothingFoundHint")} />
        )}
      </section>
    );
  }
  const shown = history.filter((h) => !q || h.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase()));
  const apps = match(q).slice(0, 6);
  return (
    <div className="flex flex-col gap-5" data-testid="store-search-suggestions">
      {shown.length > 0 && (
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-[17px] font-bold">{t("store.history")}</h2>
            <button type="button" onClick={onClear} className="text-[14px] font-medium text-primary" data-testid="store-history-clear">
              {t("store.clear")}
            </button>
          </div>
          {shown.map((h) => (
            <button key={h} type="button" onClick={() => onPick(h)} className="flex h-11 w-full items-center gap-3 text-left text-[15px]" data-testid="store-history-item">
              <RiHistoryLine className="size-5 text-text-tertiary" />
              <span className="min-w-0 flex-1 truncate">{h}</span>
              <RiArrowRightSLine className="size-5 text-text-tertiary" />
            </button>
          ))}
        </section>
      )}
      <section>
        <h2 className="mb-1 text-[17px] font-bold">{q.trim() ? t("store.matching") : t("store.popular")}</h2>
        {(q.trim() ? apps : (["vibex", "notes", "mail"] as StoreAppId[])).map((id) => (
          <button key={id} type="button" onClick={() => (q.trim() ? onOpen(id) : onPick(name(id)))} className="flex h-12 w-full items-center gap-3 text-left text-[15px]" data-testid="store-suggestion" data-app={id}>
            <RiSearchLine className="size-5 text-text-tertiary" />
            <span className="min-w-0 flex-1 truncate">{name(id)}</span>
            <RiArrowRightSLine className="size-5 text-text-tertiary" />
          </button>
        ))}
        {q.trim() && !apps.length && <p className="py-2 text-[14px] text-text-tertiary">{t("store.noMatching")}</p>}
      </section>
    </div>
  );
}

function SearchResult({ id, onOpen }: { id: StoreAppId; onOpen: (id: StoreAppId) => void }) {
  const [shot, setShot] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-2" data-testid="store-search-result" data-app={id}>
      <AppRow id={id} onOpen={onOpen} />
      <ScreenshotStrip id={id} kind="phone" onOpen={setShot} />
      <ShotViewer shots={CATALOG[id].phone} index={shot} onIndex={setShot} />
    </div>
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

function Section({ title, apps, onOpen, onAll }: { title: string; apps: StoreAppId[]; onOpen: (id: StoreAppId) => void; onAll?: () => void }) {
  const t = useT();
  return (
    <section data-testid="store-section">
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
function AppPage({ id, onReviews, onDeveloper }: { id: StoreAppId; onReviews: () => void; onDeveloper: () => void }) {
  const t = useT();
  const name = useAppName()(id);
  const m = APP_REGISTRY[id];
  const entry = CATALOG[id];
  const stats = useStoreStats().data?.[id];
  const state = useAppStates()[id];
  const reviews = useReviews(id, "helpful");
  const [kind, setKind] = useState<"phone" | "pc">("phone");
  const [shot, setShot] = useState<number | null>(null);
  const [writing, setWriting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const top = (reviews.data?.items ?? []).slice(0, 2);
  const share = async (input: ShareSendInput) => {
    const text = `${t("store.shareText", { app: name })}\n${t(entry.subtitle)}`;
    await sendText(input, `Appex Store · ${name}`, input.text.trim() ? `${input.text.trim()}\n\n${text}` : text);
  };
  return (
    <div className="flex flex-col gap-6" data-testid="store-app-page" data-app={id}>
      <section className="flex items-center gap-4">
        <StoreIcon id={id} size={96} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[24px] font-bold leading-tight tracking-tight" data-testid="store-app-name">
            {name}
          </h1>
          <p className="truncate text-[14px] text-text-secondary">{t(entry.subtitle)}</p>
          <div className="mt-2.5 flex items-center gap-2">
            <GetButton id={id} size="lg" />
            <button type="button" onClick={() => setSharing(true)} aria-label={t("store.share")} title={t("store.share")} className="flex size-10 items-center justify-center rounded-full bg-surface-secondary text-text" data-testid="store-share-open">
              <RiShareForwardLine className="size-5" />
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-4 divide-x divide-border/60 rounded-[20px] bg-surface py-3 text-center shadow-tile" data-testid="store-stats">
        <Stat value={stats && stats.total ? stats.average.toFixed(1) : "–"} label={t("store.stat.rating", { n: stats?.total ?? 0 })} />
        <Stat value={t(CATEGORY[m.category])} label={t("store.stat.category")} />
        <Stat value={m.version} label={t("store.stat.version")} />
        <Stat value={DEVELOPER.name} label={t("store.stat.developer")} />
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[20px] font-bold tracking-tight">{t("store.screenshots")}</h2>
          {entry.pc.length > 0 && (
            <div className="flex rounded-full bg-surface-secondary p-0.5 text-[13px]" role="tablist">
              {(["phone", "pc"] as const).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={cx("h-8 rounded-full px-3 font-medium", kind === k ? "bg-surface text-text shadow-tile" : "text-text-secondary")} data-testid={`store-shots-${k}`}>
                  {t(k === "phone" ? "store.phone" : "store.pc")}
                </button>
              ))}
            </div>
          )}
        </div>
        <ScreenshotStrip id={id} kind={kind} onOpen={setShot} />
        <ShotViewer shots={entry[kind]} index={shot} onIndex={setShot} />
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

      <section className="rounded-[22px] bg-surface p-4 shadow-tile" data-testid="store-news">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[17px] font-bold">{t("store.whatsNew")}</h2>
          <span className="text-[13px] text-text-tertiary">{t("store.version", { v: m.version })}</span>
        </div>
        <p className="mt-1.5 text-[14.5px] text-text-secondary">{t(entry.news)}</p>
      </section>

      <button type="button" onClick={onDeveloper} className="flex items-center gap-3 rounded-[22px] bg-surface p-4 text-left shadow-tile" data-testid="store-developer-link">
        <RiShieldCheckLine className="size-6 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{t("store.developer", { name: DEVELOPER.name })}</span>
          <span className="block text-[13px] text-text-secondary">{t("store.developerAll")}</span>
        </span>
        <RiArrowRightSLine className="size-5 text-text-tertiary" />
      </button>

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

      {state !== "get" && (
        <button type="button" onClick={() => setRemoving(true)} className="flex h-11 items-center justify-center gap-2 rounded-full text-[15px] font-medium text-danger hover:bg-danger-soft" data-testid="store-remove">
          <RiDeleteBinLine className="size-5" /> {t("store.remove")}
        </button>
      )}

      <ReviewSheet open={writing} appId={id} mine={reviews.data?.mine ?? null} onClose={() => setWriting(false)} />
      <VoidexShareDialog
        subject={sharing ? { key: `store:${id}`, icon: <StoreIcon id={id} size={48} />, title: name, hint: t(entry.subtitle) } : null}
        onClose={() => setSharing(false)}
        onSend={share}
        testId="store-share"
        sentTitle={t("store.shared")}
      />
      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        onConfirm={() => {
          setRemoving(false);
          void removeApp(id).catch((e) => toast({ title: errorMessage(t, e), tone: "danger" }));
        }}
        title={t("store.removeTitle", { app: name })}
        message={t("store.removeBody")}
        confirmLabel={t("store.remove")}
        danger
        testId="store-remove-confirm"
      />
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5 px-1">
      <strong className="max-w-full truncate text-[15px] font-semibold text-text">{value}</strong>
      <span className="max-w-full truncate text-[11.5px] text-text-tertiary">{label}</span>
    </div>
  );
}
