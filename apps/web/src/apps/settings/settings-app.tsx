import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  RiArrowLeftSLine,
  RiNotification3Line,
  RiDeviceLine,
  RiEarthLine,
  RiInformationLine,
  RiKeyLine,
  RiLayoutGridLine,
  RiMailLine,
  RiPhoneLine,
  RiShieldCheckLine,
  RiShieldUserLine,
  RiTranslate2,
  RiUserLine,
} from "@remixicon/react";
import { useFormFactor } from "@/lib/form-factor";
import { countryName, useLanguage, useT, type MessageKey } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { cx } from "@/lib/cx";
import { Avatar } from "@/brand/brand";
import { IconButton } from "@/ui/controls";
import { WindowHeader, useWindow } from "@/os/window-context";
import { AccountSection, CountrySection, EmailSection, LanguageSection, PersonalSection } from "./sections/account";
import { DevicesSection, PasswordSection, PhoneSection, SecuritySection } from "./sections/security";
import { DesktopSection } from "./sections/desktop";
import { AboutSection, NotificationsSection, PrivacySection } from "./sections/system";

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
  | "about";

export interface SectionProps {
  navigate: (id: SectionId) => void;
}

interface SectionDef {
  id: SectionId;
  label: MessageKey;
  icon: ComponentType<{ className?: string }>;
  Component: ComponentType<SectionProps>;
  group: "account" | "system";
}

const SECTIONS: SectionDef[] = [
  { id: "account", label: "settings.account", icon: RiUserLine, Component: AccountSection, group: "account" },
  { id: "personal", label: "settings.personal", icon: RiShieldUserLine, Component: PersonalSection, group: "account" },
  { id: "security", label: "settings.security", icon: RiShieldCheckLine, Component: SecuritySection, group: "account" },
  { id: "password", label: "settings.password", icon: RiKeyLine, Component: PasswordSection, group: "account" },
  { id: "phone", label: "settings.phone", icon: RiPhoneLine, Component: PhoneSection, group: "account" },
  { id: "email", label: "settings.email", icon: RiMailLine, Component: EmailSection, group: "account" },
  { id: "devices", label: "settings.devices", icon: RiDeviceLine, Component: DevicesSection, group: "account" },
  { id: "privacy", label: "settings.privacy", icon: RiShieldCheckLine, Component: PrivacySection, group: "system" },
  { id: "language", label: "settings.language", icon: RiTranslate2, Component: LanguageSection, group: "system" },
  { id: "country", label: "settings.country", icon: RiEarthLine, Component: CountrySection, group: "system" },
  { id: "desktop", label: "settings.desktop", icon: RiLayoutGridLine, Component: DesktopSection, group: "system" },
  { id: "notifications", label: "settings.notifications", icon: RiNotification3Line, Component: NotificationsSection, group: "system" },
  { id: "about", label: "settings.about", icon: RiInformationLine, Component: AboutSection, group: "system" },
];

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Settings — the first system app. Desktop: sidebar + detail. Phone: section
 * list that pushes detail pages (with a back button), like a native settings app.
 */
export function SettingsApp() {
  const t = useT();
  const ff = useFormFactor();
  const win = useWindow();
  const [stack, setStack] = useState<SectionId[]>(ff === "desktop" ? ["account"] : []);
  const current = stack.at(-1) ?? null;

  // Other apps / notifications can deep-link: open("settings", { params: { section } }).
  useEffect(() => {
    const s = win.params.section as SectionId | undefined;
    if (s && SECTIONS.some((x) => x.id === s)) setStack(ff === "desktop" ? [s] : [s]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.paramsVersion]);
  useEffect(() => {
    if (ff === "desktop" && stack.length === 0) setStack(["account"]);
  }, [ff, stack.length]);

  const navigate = (id: SectionId) => setStack((s) => (ff === "desktop" ? [...s.filter((x) => x !== id), id].slice(-8) : [...s, id]));
  const back = () => setStack((s) => s.slice(0, -1));
  const def = SECTIONS.find((s) => s.id === current);

  if (ff === "desktop") {
    return (
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[260px] shrink-0 flex-col border-r bg-surface-secondary/60">
          <WindowHeader menu={false}>
            <span className="pl-2 text-[15px] font-semibold">{t("settings.title")}</span>
          </WindowHeader>
          <nav className="scroll-area flex-1 px-3 pb-4">
            <SidebarProfile onClick={() => setStack(["account"])} active={current === "account"} />
            {(["account", "system"] as const).map((g) => (
              <div key={g} className="mt-4">
                <div className="px-3 pb-1.5 text-[12px] font-medium uppercase tracking-wide text-text-tertiary">
                  {t(g === "account" ? "settings.groupAccount" : "settings.groupSystem")}
                </div>
                {SECTIONS.filter((s) => s.group === g && s.id !== "account").map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStack([s.id])}
                    data-testid={`settings-nav-${s.id}`}
                    className={cx(
                      "flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[14px] transition-colors",
                      current === s.id ? "bg-primary-soft font-semibold text-primary-strong" : "text-text hover:bg-surface-hover",
                    )}
                  >
                    <s.icon className={cx("size-[18px]", current === s.id ? "text-primary" : "text-text-secondary")} />
                    {t(s.label)}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <WindowHeader>
            {stack.length > 1 && (
              <IconButton label={t("common.back")} onClick={back} size="sm">
                <RiArrowLeftSLine className="size-5" />
              </IconButton>
            )}
          </WindowHeader>
          <div className="scroll-area flex-1 px-8 pb-10">
            <div className="mx-auto max-w-[640px]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={current} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                  {def && <def.Component navigate={navigate} />}
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
      <MobilePage key="root" title={t("settings.title")}>
        <MobileIndex onOpen={navigate} />
      </MobilePage>
      <AnimatePresence initial={false}>
        {stack.map((id, i) => {
          const s = SECTIONS.find((x) => x.id === id)!;
          return (
            <motion.div
              key={`${id}-${i}`}
              className="absolute inset-0 flex flex-col bg-surface"
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
              <MobilePage title={t(s.label)} onBack={back}>
                <s.Component navigate={navigate} />
              </MobilePage>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function MobilePage({ title, onBack, children }: { title: string; onBack?: () => void; children: ReactNode }) {
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
          <span className="pl-2 text-[22px] font-bold tracking-tight">{title}</span>
        )}
      </WindowHeader>
      <div className="scroll-area flex-1 bg-surface-secondary/50 px-4 pb-10 pt-2">{children}</div>
    </div>
  );
}

function MobileIndex({ onOpen }: { onOpen: (id: SectionId) => void }) {
  const t = useT();
  return (
    <>
      <SidebarProfile onClick={() => onOpen("account")} large />
      {(["account", "system"] as const).map((g) => (
        <div key={g} className="mb-6 overflow-hidden rounded-[20px] border border-border bg-surface">
          {SECTIONS.filter((s) => s.group === g && s.id !== "account").map((s) => (
            <button
              key={s.id}
              onClick={() => onOpen(s.id)}
              data-testid={`settings-nav-${s.id}`}
              className="flex h-[54px] w-full items-center gap-3 px-4 text-left text-[16px] active:bg-surface-secondary [&:not(:last-child)]:border-b"
            >
              <span className="flex size-8 items-center justify-center rounded-[10px] bg-primary-soft text-primary">
                <s.icon className="size-[18px]" />
              </span>
              <span className="flex-1">{t(s.label)}</span>
              <RiArrowLeftSLine className="size-5 rotate-180 text-text-tertiary" />
            </button>
          ))}
        </div>
      ))}
    </>
  );
}

function SidebarProfile({ onClick, active, large }: { onClick: () => void; active?: boolean; large?: boolean }) {
  const user = useSession((s) => s.user)!;
  const lang = useLanguage();
  const name = `${user.firstName} ${user.lastName}`;
  return (
    <button
      onClick={onClick}
      data-testid="settings-nav-account"
      className={cx(
        "flex w-full items-center gap-3 text-left transition-colors",
        large ? "mb-6 rounded-[20px] border border-border bg-surface p-4" : "mt-1 rounded-2xl p-2.5",
        active ? "bg-primary-soft" : !large && "hover:bg-surface-hover",
      )}
    >
      <Avatar name={name} userId={user.id} version={user.avatarVersion} size={large ? 56 : 42} />
      <span className="min-w-0 flex-1">
        <span className={cx("block truncate font-semibold", large ? "text-[18px]" : "text-[14px]")}>{name}</span>
        <span className="block truncate text-[12px] text-text-secondary">{user.mailAddress}</span>
        {large && <span className="block truncate text-[12px] text-text-tertiary">{countryName(user.country, lang)}</span>}
      </span>
    </button>
  );
}
