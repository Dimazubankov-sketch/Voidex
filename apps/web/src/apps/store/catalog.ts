import { APP_IDS, type AppId } from "@voidex/shared";
import type { MessageKey } from "@/lib/i18n";

/**
 * Step 2.11: what Appex Store shows about each app. The list itself is the
 * App Registry (every registered, available app except the Store and
 * Settings); this file only adds the Store's words and pictures: a subtitle,
 * a description, its features, what is new, and real screenshots (taken from
 * the running apps by scripts/store-screenshots.mjs in development, shipped
 * as static files; no account data in them).
 */
export type StoreAppId = Exclude<AppId, "store" | "settings">;

export const STORE_APPS = APP_IDS.filter((id): id is StoreAppId => id !== "store" && id !== "settings");

export interface StoreEntry {
  subtitle: MessageKey;
  description: MessageKey;
  news: MessageKey;
  features: MessageKey[];
  /** Real screenshots (static files): phone and, where the app has one, PC. */
  phone: string[];
  pc: string[];
}

const shots = (id: string, phone: number, pc: number) => ({
  phone: Array.from({ length: phone }, (_, i) => `/store/screens/${id}-phone-${i + 1}.jpg`),
  pc: Array.from({ length: pc }, (_, i) => `/store/screens/${id}-pc-${i + 1}.jpg`),
});

export const CATALOG: Record<StoreAppId, StoreEntry> = {
  vibex: { subtitle: "store.app.vibex.subtitle", description: "store.app.vibex.desc", news: "store.app.vibex.news", features: ["store.app.vibex.f1", "store.app.vibex.f2", "store.app.vibex.f3"], ...shots("vibex", 2, 1) },
  mail: { subtitle: "store.app.mail.subtitle", description: "store.app.mail.desc", news: "store.app.mail.news", features: ["store.app.mail.f1", "store.app.mail.f2", "store.app.mail.f3"], ...shots("mail", 2, 1) },
  notes: { subtitle: "store.app.notes.subtitle", description: "store.app.notes.desc", news: "store.app.notes.news", features: ["store.app.notes.f1", "store.app.notes.f2", "store.app.notes.f3"], ...shots("notes", 2, 1) },
  calculator: { subtitle: "store.app.calculator.subtitle", description: "store.app.calculator.desc", news: "store.app.calculator.news", features: ["store.app.calculator.f1", "store.app.calculator.f2", "store.app.calculator.f3"], ...shots("calculator", 2, 1) },
  files: { subtitle: "store.app.files.subtitle", description: "store.app.files.desc", news: "store.app.files.news", features: ["store.app.files.f1", "store.app.files.f2", "store.app.files.f3"], ...shots("files", 1, 1) },
  media: { subtitle: "store.app.media.subtitle", description: "store.app.media.desc", news: "store.app.media.news", features: ["store.app.media.f1", "store.app.media.f2", "store.app.media.f3"], ...shots("media", 1, 1) },
};

/** The home page: the carousel and three collections (only registry apps). */
export const HERO: { id: StoreAppId; title: MessageKey; text: MessageKey; tone: string }[] = [
  { id: "vibex", title: "store.hero.vibex.title", text: "store.hero.vibex.text", tone: "from-[#7d6bff] to-[#b07cff]" },
  { id: "notes", title: "store.hero.notes.title", text: "store.hero.notes.text", tone: "from-[#5b7cff] to-[#8f6bff]" },
  { id: "media", title: "store.hero.media.title", text: "store.hero.media.text", tone: "from-[#9b6bff] to-[#ff8ac8]" },
  { id: "mail", title: "store.hero.mail.title", text: "store.hero.mail.text", tone: "from-[#6a5cff] to-[#4fb6ff]" },
];

export const COLLECTIONS: { title: MessageKey; apps: StoreAppId[] }[] = [
  { title: "store.collection.everyday", apps: ["vibex", "mail", "notes"] },
  { title: "store.collection.choice", apps: ["media", "files", "notes"] },
  { title: "store.collection.handy", apps: ["calculator", "files", "mail"] },
];

/** Every app here is made by VOIDEX (the developer page lists them all). */
export const DEVELOPER = { id: "voidex", name: "VOIDEX" } as const;
