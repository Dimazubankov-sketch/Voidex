import { APP_IDS, APP_RELEASES, type AppId } from "@voidex/shared";
import type { MessageKey } from "@/lib/i18n";

/**
 * Step 2.11 / 2.12: what Appex Store shows about each app. The list itself is
 * the App Registry (every registered, available app except the Store and
 * Settings); this file only adds the Store's words and pictures.
 *
 * Screenshots are real captures of the running apps, made in development by
 * `pnpm --filter @voidex/web store:screens` (tools/store-screens) and shipped
 * as static files in public/store/screens: `<app>-phone-<n>.jpg` (a phone,
 * 390 x 844) and `<app>-desktop-<n>.jpg` (a computer, 1440 x 900), at least
 * three of each, no account data in them. A new app: add its entry here, its
 * scenes to the capture script, run it.
 *
 * Release notes: one entry per version of APP_RELEASES (shared/apps.ts): a
 * headline and what the release brought. A new version gets its notes here
 * together with its APP_RELEASES entry (a version without notes is not listed).
 */
export type StoreAppId = Exclude<AppId, "store" | "settings">;

export const STORE_APPS = APP_IDS.filter((id): id is StoreAppId => id !== "store" && id !== "settings");

export interface StoreRelease {
  title: MessageKey;
  items: MessageKey[];
}

export interface StoreEntry {
  subtitle: MessageKey;
  description: MessageKey;
  features: MessageKey[];
  screenshots: { phone: string[]; desktop: string[] };
  /** Notes per version (keys: the versions of APP_RELEASES). */
  releases: Record<string, StoreRelease>;
}

/** The screenshot files of an app (static, never inlined): `n` per platform. */
export const screenshots = (id: StoreAppId, n = 3) => ({
  phone: Array.from({ length: n }, (_, i) => `/store/screens/${id}-phone-${i + 1}.jpg`),
  desktop: Array.from({ length: n }, (_, i) => `/store/screens/${id}-desktop-${i + 1}.jpg`),
});

const entry = (id: StoreAppId): StoreEntry => {
  const f = [`store.app.${id}.f1`, `store.app.${id}.f2`, `store.app.${id}.f3`] as MessageKey[];
  return {
    subtitle: `store.app.${id}.subtitle` as MessageKey,
    description: `store.app.${id}.desc` as MessageKey,
    features: f,
    screenshots: screenshots(id),
    // 1.0.0: what the app is today (its first and only release so far).
    releases: { "1.0.0": { title: `store.app.${id}.news` as MessageKey, items: f } },
  };
};

export const CATALOG = Object.fromEntries(STORE_APPS.map((id) => [id, entry(id)])) as Record<StoreAppId, StoreEntry>;

/** An app's releases with their notes, newest first (only versions that have notes). */
export function releasesOf(id: StoreAppId) {
  return APP_RELEASES[id].filter((r) => CATALOG[id].releases[r.version]).map((r) => ({ ...r, notes: CATALOG[id].releases[r.version]! }));
}

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
