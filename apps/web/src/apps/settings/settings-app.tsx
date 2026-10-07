import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  RiArrowLeftSLine,
  RiNotification3Line,
  RiDeviceLine,
  RiArrowRightSLine,
  RiLock2Line,
  RiMapPinLine,
  RiInformationLine,
  RiKeyLine,
  RiLayoutGridLine,
  RiMailLine,
  RiPhoneLine,
  RiShieldCheckLine,
  RiShieldUserLine,
  RiTranslate2,
  RiUserLine,
  RiPaletteLine,
  RiImageLine,
  
  
  RiHome5Line,
} from "@remixicon/react";
import { useFormFactor } from "@/lib/form-factor";
import { countryName, useLanguage, useT, type MessageKey } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { cx } from "@/lib/cx";
import { Avatar, VoidexMark } from "@/brand/brand";
import { ensureStepUp } from "@/lib/security";
import { IconButton } from "@/ui/controls";
import { WindowHeader, useWindow } from "@/os/window-context";
import { AccountSection, CountrySection, EmailSection, LanguageSection, PersonalSection } from "./sections/account";
import { DevicesSection, PasswordSection, PhoneSection, SecuritySection } from "./sections/security";
import { DesktopSection } from "./sections/desktop";
import { LockSection } from "./sections/lock";
import { BrandFooter } from "./kit";
import { AboutSection, NotificationsSection, PrivacySection } from "./sections/system";
import { PersonalizationSection } from "./sections/personalization";
import { WallpapersSection, setNextWallpaperTab } from "./sections/wallpapers";
import { VoidexSearchField } from "@/ui/search-field";

export type SectionId =
  | "account"
  | "personal"
  | "security"
  | "password"
  | "phone"
  | "email"
  | "devices"
  | "privacy"
  | "language"
  | "country"
  | "notifications"
  | "desktop"
  | "lock"
  | "personalization"
  | "wallpapers"
  | "about";

export interface SectionProps {
  navigate: (id: SectionId) => void;
}

interface SectionDef {
  id: SectionId;
  label: MessageKey;
  hint?: MessageKey;
  icon: ComponentType<{ className?: string }>;
  Component: ComponentType<SectionProps>;
  group: "account" | "app" | "privacy";
  /** Personal / security data: opening it asks for the code-password or Face ID (when set). */
  sensitive?: boolean;
}

const SECTIONS: SectionDef[] = [
  { id: "account", label: "settings.account", icon: RiUserLine, Component: AccountSection, group: "account" },
  { id: "personal", label: "settings.personal", hint: "settings.hint.personal", icon: RiShieldUserLine, Component: PersonalSection, group: "account", sensitive: true },
  { id: "security", label: "settings.security", hint: "settings.hint.security", icon: RiShieldCheckLine, Component: SecuritySection, group: "account", sensitive: true },
  { id: "password", label: "settings.password", hint: "settings.hint.password", icon: RiKeyLine, Component: PasswordSection, group: "account", sensitive: true },
  { id: "phone", label: "settings.phone", icon: RiPhoneLine, Component: PhoneSection, group: "account", sensitive: true },
  { id: "email", label: "settings.email", icon: RiMailLine, Component: EmailSection, group: "account" },
  { id: "devices", label: "settings.devices", hint: "settings.hint.devices", icon: RiDeviceLine, Component: DevicesSection, group: "account", sensitive: true },
  { id: "desktop", label: "settings.desktop", hint: "settings.hint.desktop", icon: RiLayoutGridLine, Component: DesktopSection, group: "app" },
  { id: "personalization", label: "settings.personalization", hint: "settings.hint.personalization", icon: RiPaletteLine, Component: PersonalizationSection, group: "app" },
  { id: "wallpapers", label: "settings.wallpapers", hint: "settings.hint.wallpapers", icon: RiImageLine, Component: WallpapersSection, group: "app" },
  { id: "lock", label: "settings.lock", hint: "settings.hint.lock", icon: RiLock2Line, Component: LockSection, group: "app" },
  { id: "language", label: "settings.language", hint: "settings.hint.language", icon: RiTranslate2, Component: LanguageSection, group: "app" },
  { id: "country", label: "settings.country", hint: "settings.hint.country", icon: RiMapPinLine, Component: CountrySection, group: "app" },
  { id: "notifications", label: "settings.notifications", hint: "settings.hint.notifications", icon: RiNotification3Line, Component: NotificationsSection, group: "app" },
  { id: "privacy", label: "settings.privacy", hint: "settings.hint.privacy", icon: RiShieldCheckLine, Component: PrivacySection, group: "privacy" },
  { id: "about", label: "settings.about", hint: "settings.hint.about", icon: RiInformationLine, Component: AboutSection, group: "privacy" },
];

const GROUPS: { id: "app" | "privacy"; label: MessageKey }[] = [
  { id: "app", label: "settings.groupApp" },
  { id: "privacy", label: "settings.groupPrivacy" },
];

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Step 2.5 — what Settings search finds: every section by its name and hint,
 * plus the actions people look for by name, each opening its exact section.
 */
const ACTIONS: { label: MessageKey; section: SectionId; words: string }[] = [
  { label: "lock.faceId", section: "lock", words: "face id faceid лицо биометрия windows hello touch id" },
  { label: "lockSettings.code", section: "lock", words: "код-пароль код пароль блокировка passcode pin" },
  { label: "settings.lock", section: "lock", words: "экран блокировки lock screen автоблокировка auto-lock" },
  { label: "settings.wallpapers", section: "wallpapers", words: "обои фон картинка заставка wallpaper background синхронизация обоев sync экран блокировки рабочий стол" },
  { label: "settings.notifications", section: "notifications", words: "уведомления звук баннер notifications sound banner" },
  { label: "settings.language", section: "language", words: "язык language" },
  { label: "settings.password", section: "password", words: "пароль сменить пароль password change" },
  { label: "appearance.dock", section: "desktop", words: "док dock панель приложений размер дока" },
  { label: "personalization.theme", section: "personalization", words: "тема тёмная темная светлая dark light theme ночной режим стекло glass" },
  { label: "personalization.searchBg", section: "personalization", words: "фон поиска поиск белый системный search background white" },
  { label: "settings.privacy", section: "privacy", words: "конфиденциальность приватность privacy данные" },
];

function searchSettings(q: string, t: ReturnType<typeof useT>) {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const out: { key: string; label: string; hint?: string; section: SectionId; icon: SectionDef["icon"] }[] = [];
  const seen = new Set<string>();
  const add = (key: string, label: string, section: SectionId, hint?: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, label, hint, section, icon: SECTIONS.find((s) => s.id === section)!.icon });
  };
  for (const a of ACTIONS) {
    if (`${t(a.label)} ${a.words}`.toLowerCase().includes(needle)) add(`a-${a.label}`, t(a.label), a.section, t(SECTIONS.find((s) => s.id === a.section)!.label));
  }
  for (const s of SECTIONS) {
    if (`${t(s.label)} ${s.hint ? t(s.hint) : ""}`.toLowerCase().includes(needle)) add(`s-${s.id}`, t(s.label), s.id, s.hint ? t(s.hint) : undefined);
  }
  return out;
}

/** The search field (top of the list on PC, bottom of the screen on phones). */
function SettingsSearch({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const t = useT();
  return (
    <VoidexSearchField className={className} value={value} onChange={onChange} placeholder={t("settings.search")} aria-label={t("settings.search")} testId="settings-search" />
  );
}

function SearchResults({ query, onOpen }: { query: string; onOpen: (id: SectionId) => void }) {
  const t = useT();
  const results = searchSettings(query, t);
  if (!results.length) {
    return (
      <p className="px-3 py-8 text-center text-[14px] text-text-tertiary" data-testid="settings-search-empty">
        {t("settings.searchEmpty")}
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-[22px] border border-border/70 bg-surface shadow-tile" data-testid="settings-search-results">
      {results.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => onOpen(r.section)}
          className="flex min-h-[58px] w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface-hover [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border/70"
          data-testid={`settings-result-${r.section}`}
        >
          <SectionIcon icon={r.icon} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] text-text">{r.label}</span>
            {r.hint && <span className="block truncate text-[12.5px] text-text-tertiary">{r.hint}</span>}
          </span>
          <RiArrowRightSLine className="size-5 text-text-tertiary" />
        </button>
      ))}
    </div>
  );
}

/** Opens a section; sensitive ones first ask "confirm it's you" (only when a code-password is set). */
async function allowed(id: SectionId) {
  if (!SECTIONS.find((s) => s.id === id)?.sensitive) return true;
  try {
    return await ensureStepUp();
  } catch {
    return false;
  }
}

/**
 * Settings — the first system app (Step 2.4 design): a VOIDEX header, the
 * profile card and section cards with a line of description. PC: the list on
 * the left, the section on the right. Phone: the list pushes section pages.
 */
export function SettingsApp() {
  const t = useT();
  const ff = useFormFactor();
  const win = useWindow();
  // Step 2.5: Settings always opens on its home page (unless a section is deep-linked).
  const [stack, setStack] = useState<SectionId[]>([]);
  const [query, setQuery] = useState("");
  const current = stack.at(-1) ?? null;

  // Other apps / notifications can deep-link: open("settings", { params: { section } }).
  useEffect(() => {
    const s = win.params.section as SectionId | undefined;
    if (s === "wallpapers" && (win.params.tab === "lock" || win.params.tab === "home")) setNextWallpaperTab(win.params.tab);
    if (s && SECTIONS.some((x) => x.id === s)) void allowed(s).then((ok) => ok && setStack([s]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.paramsVersion]);

  const navigate = (id: SectionId) =>
    void allowed(id).then((ok) => ok && setStack((s) => (ff === "desktop" ? [...s.filter((x) => x !== id), id].slice(-8) : [...s, id])));
  const openRoot = (id: SectionId) => void allowed(id).then((ok) => ok && setStack([id]));
  const openFound = (id: SectionId) =>
    void allowed(id).then((ok) => {
      if (!ok) return;
      setQuery("");
      setStack(ff === "desktop" ? [id] : [id]);
    });
  const back = () => setStack((s) => s.slice(0, -1));
  const def = SECTIONS.find((s) => s.id === current);

  if (ff === "desktop") {
    return (
      <div className="flex min-h-0 flex-1">
        <aside className="vx-settings-nav flex w-[300px] shrink-0 flex-col border-r">
          <WindowHeader menu={false}>
            <BrandLine />
          </WindowHeader>
          <nav className="scroll-area flex-1 px-3 pb-4">
            <button type="button" onClick={() => setStack([])} className="block px-2 pb-3 pt-1 text-left" data-testid="settings-home-link">
              <h1 className="text-[26px] font-bold tracking-tight text-text">{t("settings.title")}</h1>
            </button>
            <SettingsSearch value={query} onChange={setQuery} className="mb-3" />
            {query.trim() ? (
              <SearchResults query={query} onOpen={openFound} />
            ) : (
              <>
            <ProfileCard onClick={() => setStack(["account"])} active={def?.group === "account"} />
            {GROUPS.map((g) => (
              <div key={g.id} className="mt-4">
                <div className="px-2 pb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t(g.label)}</div>
                <div className="flex flex-col gap-0.5">
                  {SECTIONS.filter((s) => s.group === g.id).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => openRoot(s.id)}
                      data-testid={`settings-nav-${s.id}`}
                      aria-current={current === s.id ? "page" : undefined}
                      className={cx(
                        "flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors",
                        current === s.id ? "bg-white shadow-tile" : "hover:bg-white/70",
                      )}
                    >
                      <SectionIcon icon={s.icon} />
                      <span className="min-w-0 flex-1">
                        <span className={cx("block truncate text-[14px]", current === s.id ? "font-semibold text-text" : "text-text")}>{t(s.label)}</span>
                        {s.hint && <span className="block truncate text-[11.5px] text-text-tertiary">{t(s.hint)}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
              </>
            )}
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <WindowHeader>
            {stack.length > 1 && (
              <IconButton label={t("common.back")} onClick={back} size="sm" data-testid="settings-pc-back">
                <RiArrowLeftSLine className="size-5" />
              </IconButton>
            )}
            {/* Step 2.5.1: the way back to the Settings home page from any section. */}
            {def && (
              <nav className="flex min-w-0 items-center gap-1 text-[13.5px]" aria-label={t("settings.title")} data-no-drag>
                <button
                  type="button"
                  onClick={() => setStack([])}
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 font-medium text-primary transition-colors hover:bg-primary/10"
                  data-testid="settings-home-button"
                >
                  <RiHome5Line className="size-4" />
                  {t("settings.home")}
                </button>
                <RiArrowRightSLine className="size-4 shrink-0 text-text-tertiary" aria-hidden />
                <span className="truncate font-medium text-text-secondary" data-testid="settings-breadcrumb">{t(def.label)}</span>
              </nav>
            )}
          </WindowHeader>
          {/* A stable gutter: the page never shifts sideways when its scrollbar comes and goes. */}
          <div className="scroll-area flex-1 px-8 pb-10 [scrollbar-gutter:stable]" data-testid="settings-content">
            <div className="mx-auto max-w-[640px]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={current ?? "home"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                  {def ? <def.Component navigate={navigate} /> : <DesktopHome onOpen={openRoot} />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // mobile: pushed pages
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <MobilePage key="root" footer={<SettingsSearch value={query} onChange={setQuery} />}>
        {query.trim() ? <div className="pt-3"><SearchResults query={query} onOpen={openFound} /></div> : <MobileIndex onOpen={navigate} />}
      </MobilePage>
      <AnimatePresence initial={false}>
        {stack.map((id, i) => {
          const s = SECTIONS.find((x) => x.id === id)!;
          return (
            <motion.div
              key={`${id}-${i}`}
              className="vx-app-bg absolute inset-0 flex flex-col"
              style={{ zIndex: 10 + i }}
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.34, ease: EASE }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0, right: 0.8 }}
              onDragEnd={(_, info) => (info.offset.x > 110 || info.velocity.x > 700) && back()}
            >
              <MobilePage onBack={back}>
                <s.Component navigate={navigate} />
              </MobilePage>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function BrandLine() {
  return (
    <span className="flex items-center gap-1.5 pl-1.5">
      <VoidexMark className="size-[18px]" />
      <span className="text-[11.5px] font-semibold tracking-[0.22em] text-text-secondary">VOIDEX</span>
    </span>
  );
}

/** The violet icon tile of a section. */
export function SectionIcon({ icon: Icon, danger }: { icon: ComponentType<{ className?: string }>; danger?: boolean }) {
  return (
    <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-[12px]", danger ? "bg-danger-soft text-danger" : "bg-primary/10 text-primary")}>
      <Icon className="size-[18px]" />
    </span>
  );
}

function MobilePage({ onBack, children, footer }: { onBack?: () => void; children: ReactNode; footer?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WindowHeader>
        {onBack ? (
          <button onClick={onBack} className="pressable -ml-1 flex h-10 items-center gap-0.5 rounded-full pr-3 text-[16px] text-primary" data-testid="settings-back">
            <RiArrowLeftSLine className="size-7" />
            {t("common.back")}
          </button>
        ) : (
          <BrandLine />
        )}
      </WindowHeader>
      <div className="vx-settings-bg scroll-area flex-1 px-4 pb-10 pt-1">{children}</div>
      {/* Step 2.5: phone search sits at the bottom, within thumb reach. */}
      {footer && <div className="vx-kb-footer vx-glass-strong shrink-0 border-x-0 border-b-0 px-3 pb-2 pt-2" data-testid="settings-search-bar">{footer}</div>}
    </div>
  );
}

/** Decorative VOIDEX glass: two soft violet cards, the same motif as the Desktops icon. */
function HeroGlass() {
  return (
    <div className="pointer-events-none absolute -right-3 -top-2 h-[118px] w-[150px]" aria-hidden>
      <div className="absolute right-3 top-2 h-[78px] w-[64px] rotate-[14deg] rounded-[18px] bg-[linear-gradient(150deg,rgba(214,204,255,0.9),rgba(150,128,255,0.55))] shadow-[0_10px_30px_-12px_rgba(106,77,245,0.55)]" />
      <div className="absolute right-[52px] top-[22px] h-[78px] w-[64px] rotate-[-8deg] rounded-[18px] border border-white/80 bg-[linear-gradient(150deg,rgba(255,255,255,0.85),rgba(228,221,255,0.65))] shadow-[0_10px_30px_-14px_rgba(106,77,245,0.45)] backdrop-blur-sm" />
    </div>
  );
}

/** PC: the home page of Settings — the profile and every section as a card. */
function DesktopHome({ onOpen }: { onOpen: (id: SectionId) => void }) {
  const t = useT();
  return (
    <div className="pt-2" data-testid="settings-home">
      <div className="relative mb-6 overflow-hidden rounded-[26px] border border-border/70 bg-surface p-5 shadow-tile">
        <HeroGlass />
        <h2 className="relative text-[26px] font-bold tracking-tight text-text">{t("settings.title")}</h2>
        <p className="relative mt-1 max-w-[320px] text-[14px] text-text-secondary">{t("settings.subtitle")}</p>
      </div>
      <ProfileCard onClick={() => onOpen("account")} large />
      {GROUPS.map((g) => (
        <div key={g.id} className="mt-6">
          <div className="px-2 pb-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t(g.label)}</div>
          <div className="grid grid-cols-2 gap-3">
            {SECTIONS.filter((s) => s.group === g.id).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpen(s.id)}
                className="flex items-center gap-3 rounded-[20px] border border-border/70 bg-surface p-3 text-left shadow-tile transition hover:-translate-y-0.5"
                data-testid={`settings-home-${s.id}`}
              >
                <SectionIcon icon={s.icon} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-medium text-text">{t(s.label)}</span>
                  {s.hint && <span className="block truncate text-[12px] text-text-tertiary">{t(s.hint)}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <BrandFooter />
    </div>
  );
}

function MobileIndex({ onOpen }: { onOpen: (id: SectionId) => void }) {
  const t = useT();
  return (
    <>
      <div className="relative mb-4 pt-2">
        <HeroGlass />
        <h1 className="relative text-[30px] font-bold leading-tight tracking-tight text-text">{t("settings.title")}</h1>
        <p className="relative mt-1 max-w-[220px] text-[13.5px] leading-snug text-text-secondary">{t("settings.subtitle")}</p>
      </div>
      <ProfileCard onClick={() => onOpen("account")} large />
      {GROUPS.map((g) => (
        <div key={g.id} className="mt-5">
          <div className="px-2 pb-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t(g.label)}</div>
          <div className="overflow-hidden rounded-[22px] border border-white bg-white/90 shadow-tile">
            {SECTIONS.filter((s) => s.group === g.id).map((s) => (
              <button
                key={s.id}
                onClick={() => onOpen(s.id)}
                data-testid={`settings-nav-${s.id}`}
                className="flex min-h-[62px] w-full items-center gap-3 px-3.5 py-2.5 text-left active:bg-surface-secondary [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border/70"
              >
                <SectionIcon icon={s.icon} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15.5px] font-medium text-text">{t(s.label)}</span>
                  {s.hint && <span className="block truncate text-[12.5px] text-text-tertiary">{t(s.hint)}</span>}
                </span>
                <RiArrowRightSLine className="size-5 text-text-tertiary" />
              </button>
            ))}
          </div>
        </div>
      ))}
      <BrandFooter />
    </>
  );
}

function ProfileCard({ onClick, active, large }: { onClick: () => void; active?: boolean; large?: boolean }) {
  const user = useSession((s) => s.user)!;
  const lang = useLanguage();
  const name = `${user.firstName} ${user.lastName}`;
  return (
    <button
      onClick={onClick}
      data-testid="settings-nav-account"
      className={cx(
        "flex w-full items-center gap-3 text-left transition-colors",
        large ? "rounded-[22px] border border-white bg-white/90 p-3.5 shadow-tile" : "rounded-[20px] border p-2.5",
        !large && (active ? "border-white bg-white shadow-tile" : "border-transparent hover:bg-white/70"),
      )}
    >
      <Avatar name={name} userId={user.id} version={user.avatarVersion} size={large ? 58 : 44} />
      <span className="min-w-0 flex-1">
        <span className={cx("block truncate font-semibold text-text", large ? "text-[18px]" : "text-[14.5px]")}>{name}</span>
        <span className="block truncate text-[12px] text-text-secondary">{user.mailAddress}</span>
        {large && (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary-strong">
            <RiMapPinLine className="size-3" /> {countryName(user.country, lang)}
          </span>
        )}
      </span>
      <RiArrowRightSLine className="size-5 shrink-0 text-text-tertiary" />
    </button>
  );
}
