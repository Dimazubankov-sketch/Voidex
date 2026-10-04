import type { LanguageCode } from "./regions.js";

/**
 * VOIDEX App Registry.
 *
 * VOIDEX is a closed ecosystem: only apps described here can ever be installed
 * or launched. System apps ship with the OS; `market` apps will be delivered by
 * the future VOIDEX App Market, which will add manifests to this registry
 * (server side) instead of letting users sideload anything.
 */
export type AppId = "settings" | "mail" | "vibex" | "calculator" | "notes";

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
    // Step 2.5: the mail service is VoidOps (addresses stay @voidops.ru).
    name: {
      en: "VoidOps Mail",
      ru: "Почта VoidOps",
      es: "Correo VoidOps",
      de: "VoidOps Mail",
      fr: "Courrier VoidOps",
      pt: "E-mail VoidOps",
      zh: "VoidOps 邮件",
      ja: "VoidOps メール",
      ko: "VoidOps 메일",
      tr: "VoidOps Posta",
    },
    caption: { en: "@voidops.ru", ru: "@voidops.ru", es: "@voidops.ru", de: "@voidops.ru", fr: "@voidops.ru", pt: "@voidops.ru", zh: "@voidops.ru", ja: "@voidops.ru", ko: "@voidops.ru", tr: "@voidops.ru" },
    version: "1.0.0",
    kind: "system",
    removable: false,
    preinstalled: true,
    permissions: ["mail.read", "mail.send", "notifications.post"],
    status: "available",
    category: "communication",
    keywords: {
      en: ["email", "inbox", "messages", "letters", "voidops", "mail"],
      ru: ["почта", "письма", "входящие", "email", "voidops", "mail"],
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
  vibex: {
    id: "vibex",
    name: { en: "Vibex", ru: "Vibex", es: "Vibex", de: "Vibex", fr: "Vibex", pt: "Vibex", zh: "Vibex", ja: "Vibex", ko: "Vibex", tr: "Vibex" },
    caption: { en: "Chats & feed", ru: "Чаты и лента", es: "Chats y noticias", de: "Chats & Feed", fr: "Discussions et fil", pt: "Chats e feed", zh: "聊天与动态", ja: "チャットとフィード", ko: "채팅 및 피드", tr: "Sohbetler ve akış" },
    version: "1.0.0",
    kind: "system",
    removable: false,
    preinstalled: true,
    permissions: ["account.read", "notifications.post"],
    status: "available",
    category: "communication",
    keywords: {
      en: ["messenger", "chat", "messages", "feed", "posts", "social"],
      ru: ["мессенджер", "чат", "сообщения", "лента", "посты", "соцсеть"],
      es: ["mensajería", "chat", "mensajes", "noticias", "publicaciones", "social"],
      de: ["Messenger", "Chat", "Nachrichten", "Feed", "Beiträge", "sozial"],
      fr: ["messagerie", "discussion", "messages", "fil", "publications", "social"],
      pt: ["mensageiro", "chat", "mensagens", "feed", "publicações", "social"],
      zh: ["即时通讯", "聊天", "消息", "动态", "帖子", "社交"],
      ja: ["メッセンジャー", "チャット", "メッセージ", "フィード", "投稿", "ソーシャル"],
      ko: ["메신저", "채팅", "메시지", "피드", "게시물", "소셜"],
      tr: ["mesajlaşma", "sohbet", "mesajlar", "akış", "gönderiler", "sosyal"],
    },
    window: { defaultWidth: 1120, defaultHeight: 740, minWidth: 720, minHeight: 500, singleton: true },
  },
  calculator: {
    id: "calculator",
    name: { en: "Calculator", ru: "Калькулятор", es: "Calculadora", de: "Rechner", fr: "Calculatrice", pt: "Calculadora", zh: "计算器", ja: "電卓", ko: "계산기", tr: "Hesap Makinesi" },
    caption: { en: "Maths & equations", ru: "Математика и уравнения", es: "Matemáticas y ecuaciones", de: "Mathe & Gleichungen", fr: "Maths et équations", pt: "Matemática e equações", zh: "数学与方程", ja: "数学と方程式", ko: "수학 및 방정식", tr: "Matematik ve denklemler" },
    version: "1.0.0",
    kind: "system",
    removable: false,
    preinstalled: true,
    // Works entirely on the device: no account data, photos are recognised locally.
    permissions: [],
    status: "available",
    category: "tools",
    keywords: {
      en: ["calc", "maths", "math", "equation", "fractions", "scientific", "solver", "ocr"],
      ru: ["калькулятор", "математика", "уравнение", "дроби", "научный", "решение", "вычисления"],
      es: ["calculadora", "matemáticas", "ecuación", "fracciones", "científica", "resolver"],
      de: ["Taschenrechner", "Mathe", "Gleichung", "Brüche", "wissenschaftlich", "lösen"],
      fr: ["calculette", "maths", "équation", "fractions", "scientifique", "résoudre"],
      pt: ["calculadora", "matemática", "equação", "frações", "científica", "resolver"],
      zh: ["计算", "数学", "方程", "分数", "科学计算器", "解题"],
      ja: ["計算機", "数学", "方程式", "分数", "関数電卓", "計算"],
      ko: ["계산", "수학", "방정식", "분수", "공학용", "풀이"],
      tr: ["hesap", "matematik", "denklem", "kesirler", "bilimsel", "çözüm"],
    },
    window: { defaultWidth: 900, defaultHeight: 740, minWidth: 360, minHeight: 560, singleton: true },
  },
  notes: {
    id: "notes",
    name: { en: "Notes", ru: "Заметки", es: "Notas", de: "Notizen", fr: "Notes", pt: "Notas", zh: "笔记", ja: "メモ", ko: "노트", tr: "Notlar" },
    caption: {
      en: "Docs & slides",
      ru: "Документы и слайды",
      es: "Documentos y diapositivas",
      de: "Dokumente & Folien",
      fr: "Documents et diapos",
      pt: "Documentos e slides",
      zh: "文档与幻灯片",
      ja: "ドキュメントとスライド",
      ko: "문서 및 슬라이드",
      tr: "Belgeler ve slaytlar",
    },
    version: "1.0.0",
    kind: "system",
    removable: false,
    preinstalled: true,
    // Notes live in the account (one document, synced with revisions).
    permissions: ["account.read"],
    status: "available",
    category: "work",
    keywords: {
      en: ["notes", "documents", "text", "editor", "presentation", "slides", "pages", "write"],
      ru: ["заметки", "документы", "текст", "редактор", "презентация", "слайды", "страницы", "записи"],
      es: ["notas", "documentos", "texto", "editor", "presentación", "diapositivas", "páginas"],
      de: ["Notizen", "Dokumente", "Text", "Editor", "Präsentation", "Folien", "Seiten"],
      fr: ["notes", "documents", "texte", "éditeur", "présentation", "diapositives", "pages"],
      pt: ["notas", "documentos", "texto", "editor", "apresentação", "slides", "páginas"],
      zh: ["笔记", "文档", "文本", "编辑器", "演示", "幻灯片", "页面"],
      ja: ["メモ", "ノート", "ドキュメント", "テキスト", "エディタ", "プレゼンテーション", "スライド"],
      ko: ["노트", "메모", "문서", "텍스트", "편집기", "프레젠테이션", "슬라이드"],
      tr: ["notlar", "belgeler", "metin", "düzenleyici", "sunum", "slaytlar", "sayfalar"],
    },
    window: { defaultWidth: 1180, defaultHeight: 780, minWidth: 380, minHeight: 500, singleton: true },
  },
};

export const APP_IDS = Object.keys(APP_REGISTRY) as AppId[];

export function isAppId(value: unknown): value is AppId {
  return typeof value === "string" && value in APP_REGISTRY;
}
