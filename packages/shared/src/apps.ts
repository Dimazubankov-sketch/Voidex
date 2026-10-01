import type { LanguageCode } from "./regions.js";

/**
 * VOIDEX App Registry.
 *
 * VOIDEX is a closed ecosystem: only apps described here can ever be installed
 * or launched. System apps ship with the OS; `market` apps will be delivered by
 * the future VOIDEX App Market, which will add manifests to this registry
 * (server side) instead of letting users sideload anything.
 */
export type AppId = "settings" | "mail";

/** Capabilities an app may request. Enforced by the server per endpoint group. */
export type AppPermission =
  | "account.read"
  | "account.write"
  | "security.manage"
  | "mail.read"
  | "mail.send"
  | "notifications.post";

/**
 * Default grouping of apps in the "by category" desktop view. A user can move
 * an app to another category; that choice is stored in their workspace layout.
 */
export const APP_CATEGORIES = ["work", "communication", "media", "tools", "entertainment", "system"] as const;
export type AppCategory = (typeof APP_CATEGORIES)[number];

export interface AppManifest {
  id: AppId;
  name: Record<LanguageCode, string>;
  /** Short secondary label under the icon (e.g. "System"). */
  caption: Record<LanguageCode, string>;
  version: string;
  kind: "system" | "market";
  /** System apps cannot be uninstalled. */
  removable: boolean;
  /** Installed for every new account automatically. */
  preinstalled: boolean;
  permissions: AppPermission[];
  status: "available" | "disabled";
  category: AppCategory;
  /** Extra words app search matches (other names people use for the app). */
  keywords: Record<LanguageCode, string[]>;
  window: {
    defaultWidth: number;
    defaultHeight: number;
    minWidth: number;
    minHeight: number;
    /** Only one window of this app may exist at a time. */
    singleton: boolean;
  };
}

export const APP_REGISTRY: Record<AppId, AppManifest> = {
  settings: {
    id: "settings",
    name: { en: "Settings", ru: "Настройки", es: "Ajustes", de: "Einstellungen", fr: "Réglages", pt: "Configurações", zh: "设置", ja: "設定", ko: "설정", tr: "Ayarlar" },
    caption: { en: "System", ru: "Система", es: "Sistema", de: "System", fr: "Système", pt: "Sistema", zh: "系统", ja: "システム", ko: "시스템", tr: "Sistem" },
    version: "1.0.0",
    kind: "system",
    removable: false,
    preinstalled: true,
    permissions: ["account.read", "account.write", "security.manage"],
    status: "available",
    category: "system",
    keywords: {
      en: ["preferences", "account", "security", "system", "wallpaper", "desktop"],
      ru: ["параметры", "аккаунт", "безопасность", "система", "обои", "рабочий стол"],
      es: ["preferencias", "cuenta", "seguridad", "sistema", "fondo", "escritorio"],
      de: ["Präferenzen", "Konto", "Sicherheit", "System", "Hintergrund", "Schreibtisch"],
      fr: ["préférences", "compte", "sécurité", "système", "fond d'écran", "bureau"],
      pt: ["preferências", "conta", "segurança", "sistema", "papel de parede", "área de trabalho"],
      zh: ["偏好", "账户", "安全", "系统", "壁纸", "桌面"],
      ja: ["環境設定", "アカウント", "セキュリティ", "システム", "壁紙", "デスクトップ"],
      ko: ["환경설정", "계정", "보안", "시스템", "배경화면", "바탕화면"],
      tr: ["tercihler", "hesap", "güvenlik", "sistem", "duvar kâğıdı", "masaüstü"],
    },
    window: { defaultWidth: 920, defaultHeight: 640, minWidth: 560, minHeight: 440, singleton: true },
  },
  mail: {
    id: "mail",
    name: { en: "Mail", ru: "Почта", es: "Correo", de: "Mail", fr: "Courrier", pt: "E-mail", zh: "邮件", ja: "メール", ko: "메일", tr: "Posta" },
    caption: { en: "VOIDEX Mail", ru: "VOIDEX Mail", es: "VOIDEX Mail", de: "VOIDEX Mail", fr: "VOIDEX Mail", pt: "VOIDEX Mail", zh: "VOIDEX Mail", ja: "VOIDEX Mail", ko: "VOIDEX Mail", tr: "VOIDEX Mail" },
    version: "1.0.0",
    kind: "system",
    removable: false,
    preinstalled: true,
    permissions: ["mail.read", "mail.send", "notifications.post"],
    status: "available",
    category: "communication",
    keywords: {
      en: ["email", "inbox", "messages", "letters", "voidops"],
      ru: ["почта", "письма", "входящие", "email", "voidops"],
      es: ["correo", "email", "bandeja", "mensajes", "voidops"],
      de: ["E-Mail", "Posteingang", "Nachrichten", "Briefe", "voidops"],
      fr: ["e-mail", "courriel", "boîte de réception", "messages", "voidops"],
      pt: ["email", "correio", "caixa de entrada", "mensagens", "voidops"],
      zh: ["邮箱", "电子邮件", "收件箱", "消息", "voidops"],
      ja: ["メール", "Eメール", "受信トレイ", "メッセージ", "voidops"],
      ko: ["이메일", "메일함", "받은편지함", "메시지", "voidops"],
      tr: ["e-posta", "gelen kutusu", "mesajlar", "mektup", "voidops"],
    },
    window: { defaultWidth: 1180, defaultHeight: 720, minWidth: 720, minHeight: 480, singleton: true },
  },
};

export const APP_IDS = Object.keys(APP_REGISTRY) as AppId[];

export function isAppId(value: unknown): value is AppId {
  return typeof value === "string" && value in APP_REGISTRY;
}
