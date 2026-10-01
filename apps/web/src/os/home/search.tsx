import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RiSearchLine } from "@remixicon/react";
import { APP_REGISTRY, type InstalledAppDto, type LanguageCode, type WorkspaceLayout } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { translate, useLanguage, useT } from "@/lib/i18n";
import { AppTile } from "@/brand/brand";
import { AppGlyph } from "./icons";
import { CATEGORY_LABEL, appCategory, appLabel, openApp } from "./actions";
import { useHomeUi } from "./ui-store";

const EASE = [0.22, 1, 0.36, 1] as const;

const fold = (s: string) => s.toLocaleLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ё/g, "е");

/**
 * App search over what the user sees and what they might type: the icon label,
 * the app's name and caption in every language, its keywords (aliases) and its
 * category. Ranked: label / name prefix first, then word prefix, then anywhere.
 */
export function searchApps(apps: InstalledAppDto[], layout: WorkspaceLayout, query: string, lang: LanguageCode): InstalledAppDto[] {
  const q = fold(query.trim());
  if (!q) return [];
  const scored = apps.map((a) => {
    const m = APP_REGISTRY[a.id];
    const names = [appLabel(layout, a.id), ...Object.values(m.name)].map(fold);
    const other = [...Object.values(m.caption), ...Object.values(m.keywords).flat(), translate(lang, CATEGORY_LABEL[appCategory(layout, a.id)])].map(fold);
    let score = 0;
    if (names.some((n) => n.startsWith(q))) score = 4;
    else if (names.some((n) => n.split(/\s+/).some((w) => w.startsWith(q)))) score = 3;
    else if (other.some((o) => o.split(/\s+/).some((w) => w.startsWith(q)))) score = 2;
    else if ([...names, ...other].some((s) => s.includes(q))) score = 1;
    return { a, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score || appLabel(layout, x.a.id).localeCompare(appLabel(layout, y.a.id), lang))
    .map((s) => s.a);
}

function ResultRow({ app, layout, active, onOpen }: { app: InstalledAppDto; layout: WorkspaceLayout; active: boolean; onOpen: (el: HTMLElement) => void }) {
  const lang = useLanguage();
  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget)}
      className={cx("pressable flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left", active ? "bg-primary-soft" : "hover:bg-surface-hover")}
      data-testid={`search-result-${app.id}`}
    >
      <span data-tile>
        <AppTile size={40}>
          <AppGlyph id={app.id} />
        </AppTile>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{appLabel(layout, app.id)}</span>
        <span className="block truncate text-[12px] text-text-tertiary">{APP_REGISTRY[app.id].caption[lang]}</span>
      </span>
    </button>
  );
}

/**
 * PC: the search field of the dock. Inside the dock's glass it is a quiet inset
 * field; alone (nothing in the dock) it is a glass field of its own.
 */
export function DesktopSearchBar({ apps, layout, inDock, height = 44 }: { apps: InstalledAppDto[]; layout: WorkspaceLayout; inDock?: boolean; height?: number }) {
  const t = useT();
  const lang = useLanguage();
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchApps(apps, layout, q, lang), [apps, layout, q, lang]);
  const open = focused && q.trim().length > 0;
  useEffect(() => setSel(0), [q]);

  const launch = (i: number, el?: HTMLElement | null) => {
    const app = results[i];
    if (!app) return;
    openApp(app.id, el);
    setQ("");
    input.current?.blur();
  };

  return (
    <div className={cx("relative", inDock ? "w-[clamp(170px,18vw,250px)]" : "w-[min(440px,calc(100vw-48px))]")} data-no-home-gesture>
      <AnimatePresence>
        {open && (
          <motion.div
            className={cx("vx-glass-strong absolute bottom-full max-h-[50vh] min-w-[300px] overflow-auto rounded-[22px] p-1.5", inDock ? "left-0 mb-4" : "inset-x-0 mb-2")}
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.16, ease: EASE }}
            data-testid="home-search-results"
          >
            {results.length ? (
              results.map((a, i) => <ResultRow key={a.id} app={a} layout={layout} active={i === sel} onOpen={(el) => launch(i, el)} />)
            ) : (
              <div className="px-3 py-3 text-[14px] text-text-secondary">{t("home.searchNothing")}</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <label
        className={cx(
          "flex items-center gap-2.5 rounded-full px-4 transition-shadow",
          inDock ? "vx-dock-field" : "vx-glass focus-within:shadow-float",
        )}
        style={{ height }}
      >
        <RiSearchLine className="size-[18px] shrink-0 text-text-tertiary" />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, results.length - 1));
            else if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
            else if (e.key === "Enter") launch(sel);
            else if (e.key === "Escape") {
              setQ("");
              input.current?.blur();
            } else return;
            e.preventDefault();
          }}
          placeholder={t("home.search")}
          aria-label={t("home.search")}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-text-tertiary"
          data-testid="home-search"
        />
      </label>
    </div>
  );
}

/** Phone: pull down on the home screen → quick search. */
export function MobileSearch({ apps, layout }: { apps: InstalledAppDto[]; layout: WorkspaceLayout }) {
  const t = useT();
  const lang = useLanguage();
  const search = useHomeUi((s) => s.search);
  const setSearch = useHomeUi((s) => s.setSearch);
  const results = useMemo(() => (search.query.trim() ? searchApps(apps, layout, search.query, lang) : apps), [apps, layout, search.query, lang]);
  const close = () => setSearch({ open: false, query: "" });

  return (
    <AnimatePresence>
      {search.open && (
        <motion.div
          className="fixed inset-0 z-[150] flex flex-col bg-white/75 px-4 pt-[max(var(--safe-top),14px)] backdrop-blur-2xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: "none" }}
          transition={{ duration: 0.2 }}
          data-testid="home-search-overlay"
          data-no-home-gesture
        >
          <motion.div className="flex items-center gap-2" initial={{ y: -24 }} animate={{ y: 0 }} transition={{ duration: 0.28, ease: EASE }}>
            <label className="flex h-11 flex-1 items-center gap-2 rounded-2xl bg-surface px-3.5 shadow-tile">
              <RiSearchLine className="size-[18px] text-text-tertiary" />
              <input
                autoFocus
                value={search.query}
                onChange={(e) => setSearch({ query: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && results[0]) {
                    close();
                    openApp(results[0].id);
                  }
                  if (e.key === "Escape") close();
                }}
                placeholder={t("home.search")}
                aria-label={t("home.search")}
                enterKeyHint="go"
                className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-text-tertiary"
                data-testid="home-search"
              />
            </label>
            <button type="button" onClick={close} className="pressable h-11 px-2 text-[16px] font-medium text-primary" data-testid="home-search-cancel">
              {t("common.cancel")}
            </button>
          </motion.div>
          <div className="scroll-area -mx-1 mt-3 flex-1 px-1 pb-8">
            {search.query.trim() && !results.length && <div className="px-2 py-4 text-[15px] text-text-secondary">{t("home.searchNothing")}</div>}
            {results.map((a) => (
              <ResultRow
                key={a.id}
                app={a}
                layout={layout}
                active={false}
                onOpen={(el) => {
                  close();
                  openApp(a.id, el);
                }}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
