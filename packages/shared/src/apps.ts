import type { LanguageCode } from "./regions.js";

/**
 * VOIDEX App Registry.
 *
 * VOIDEX is a closed ecosystem: only apps described here can ever be installed
 * or launched. System apps ship with the OS; `market` apps will be delivered by
 * the future VOIDEX App Market, which will add manifests to this registry
 * (server side) instead of letting users sideload anything.
 */
export type AppId = "settings" | "mail" | "vibex" | "calculator" | "notes" | "files" | "media" | "store";

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
    // Step 2.5: the mail service is VoidOps. Step 2.9: people see addresses as username@voidops (the server keeps @voidops.ru as an alias).
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
    caption: { en: "@voidops", ru: "@voidops", es: "@voidops", de: "@voidops", fr: "@voidops", pt: "@voidops", zh: "@voidops", ja: "@voidops", ko: "@voidops", tr: "@voidops" },
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
      en: ["messenger", "chat", "chats", "messages", "stories", "feed", "posts", "social"],
      ru: ["мессенджер", "чат", "чаты", "сообщения", "истории", "лента", "посты", "соцсеть"],
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
      en: ["notes", "documents", "text", "editor", "presentation", "slides", "pages", "write", "book", "reading"],
      ru: ["заметки", "документы", "текст", "редактор", "презентация", "слайды", "страницы", "записи", "книга", "чтение"],
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
  files: {
    id: "files",
    name: { en: "Files", ru: "Файлы", es: "Archivos", de: "Dateien", fr: "Fichiers", pt: "Arquivos", zh: "文件", ja: "ファイル", ko: "파일", tr: "Dosyalar" },
    caption: {
      en: ".txt, .prsn and .book",
      ru: ".txt, .prsn и .book",
      es: ".txt, .prsn y .book",
      de: ".txt, .prsn und .book",
      fr: ".txt, .prsn et .book",
      pt: ".txt, .prsn e .book",
      zh: ".txt、.prsn 和 .book",
      ja: ".txt、.prsn、.book",
      ko: ".txt, .prsn 및 .book",
      tr: ".txt, .prsn ve .book",
    },
    version: "1.0.0",
    kind: "system",
    removable: false,
    preinstalled: true,
    // Step 2.7: the UI ships now; its storage (VOIDEX Cloud) is not connected yet.
    permissions: ["account.read"],
    status: "available",
    category: "work",
    keywords: {
      en: ["files", "documents", "folders", "txt", "prsn", "book", "cloud", "downloads"],
      ru: ["файлы", "документы", "папки", "txt", "prsn", "book", "облако", "скачанные"],
      es: ["archivos", "documentos", "carpetas", "txt", "prsn", "nube", "descargas"],
      de: ["Dateien", "Dokumente", "Ordner", "txt", "prsn", "Cloud", "Downloads"],
      fr: ["fichiers", "documents", "dossiers", "txt", "prsn", "cloud", "téléchargements"],
      pt: ["arquivos", "documentos", "pastas", "txt", "prsn", "nuvem", "downloads"],
      zh: ["文件", "文档", "文件夹", "txt", "prsn", "云", "下载"],
      ja: ["ファイル", "ドキュメント", "フォルダ", "txt", "prsn", "クラウド", "ダウンロード"],
      ko: ["파일", "문서", "폴더", "txt", "prsn", "클라우드", "다운로드"],
      tr: ["dosyalar", "belgeler", "klasörler", "txt", "prsn", "bulut", "indirilenler"],
    },
    window: { defaultWidth: 1080, defaultHeight: 720, minWidth: 380, minHeight: 480, singleton: true },
  },
  media: {
    id: "media",
    name: { en: "Media", ru: "Медиатека", es: "Fototeca", de: "Mediathek", fr: "Médiathèque", pt: "Mídia", zh: "媒体库", ja: "メディア", ko: "미디어", tr: "Medya" },
    caption: {
      en: "Photos & videos",
      ru: "Фото и видео",
      es: "Fotos y vídeos",
      de: "Fotos & Videos",
      fr: "Photos et vidéos",
      pt: "Fotos e vídeos",
      zh: "照片与视频",
      ja: "写真とビデオ",
      ko: "사진 및 동영상",
      tr: "Fotoğraflar ve videolar",
    },
    version: "1.0.0",
    kind: "system",
    removable: false,
    preinstalled: true,
    // Step 2.7: the UI ships now; its storage (VOIDEX Cloud) is not connected yet.
    permissions: ["account.read"],
    status: "available",
    category: "media",
    keywords: {
      en: ["photos", "videos", "gallery", "albums", "screenshots", "pictures", "media"],
      ru: ["фото", "видео", "галерея", "альбомы", "скриншоты", "фотографии", "медиатека"],
      es: ["fotos", "vídeos", "galería", "álbumes", "capturas", "imágenes"],
      de: ["Fotos", "Videos", "Galerie", "Alben", "Bildschirmfotos", "Bilder"],
      fr: ["photos", "vidéos", "galerie", "albums", "captures", "images"],
      pt: ["fotos", "vídeos", "galeria", "álbuns", "capturas", "imagens"],
      zh: ["照片", "视频", "图库", "相册", "截图", "图片"],
      ja: ["写真", "ビデオ", "ギャラリー", "アルバム", "スクリーンショット", "画像"],
      ko: ["사진", "동영상", "갤러리", "앨범", "스크린샷", "이미지"],
      tr: ["fotoğraflar", "videolar", "galeri", "albümler", "ekran görüntüleri", "resimler"],
    },
    window: { defaultWidth: 1120, defaultHeight: 760, minWidth: 380, minHeight: 500, singleton: true },
  },
  store: {
    id: "store",
    // Step 2.11: Appex Store, the catalog of the registry (install, open, update, reviews).
    name: { en: "Appex Store", ru: "Appex Store", es: "Appex Store", de: "Appex Store", fr: "Appex Store", pt: "Appex Store", zh: "Appex Store", ja: "Appex Store", ko: "Appex Store", tr: "Appex Store" },
    caption: { en: "Apps", ru: "Приложения", es: "Aplicaciones", de: "Apps", fr: "Applications", pt: "Aplicativos", zh: "应用", ja: "アプリ", ko: "앱", tr: "Uygulamalar" },
    version: "1.0.0",
    kind: "system",
    removable: false,
    preinstalled: true,
    permissions: ["account.read"],
    status: "available",
    category: "system",
    keywords: {
      en: ["store", "apps", "install", "update", "market", "appex"],
      ru: ["магазин", "приложения", "установить", "обновить", "маркет", "appex"],
      es: ["tienda", "aplicaciones", "instalar", "actualizar", "appex"],
      de: ["Laden", "Apps", "installieren", "aktualisieren", "appex"],
      fr: ["boutique", "applications", "installer", "mettre à jour", "appex"],
      pt: ["loja", "aplicativos", "instalar", "atualizar", "appex"],
      zh: ["商店", "应用", "安装", "更新", "appex"],
      ja: ["ストア", "アプリ", "インストール", "アップデート", "appex"],
      ko: ["스토어", "앱", "설치", "업데이트", "appex"],
      tr: ["mağaza", "uygulamalar", "yükle", "güncelle", "appex"],
    },
    window: { defaultWidth: 1120, defaultHeight: 760, minWidth: 380, minHeight: 520, singleton: true },
  },
};

export const APP_IDS = Object.keys(APP_REGISTRY) as AppId[];

export function isAppId(value: unknown): value is AppId {
  return typeof value === "string" && value in APP_REGISTRY;
}

/**
 * Step 2.12: every release of each app, newest first. The first one is always
 * the manifest's version (checked by a test); the Store shows this list as the
 * app's version history and compares it with the version an account has.
 * A new release = a new entry on top + the manifest's version + its notes in
 * the Store catalog (web: apps/store/catalog.ts). Dates are when the release
 * reached VOIDEX (yyyy-mm-dd).
 */
export interface AppRelease {
  version: string;
  date: string;
}

export const APP_RELEASES: Record<AppId, AppRelease[]> = {
  settings: [{ version: "1.0.0", date: "2026-09-28" }],
  mail: [{ version: "1.0.0", date: "2026-09-28" }],
  vibex: [{ version: "1.0.0", date: "2026-10-01" }],
  calculator: [{ version: "1.0.0", date: "2026-10-02" }],
  notes: [{ version: "1.0.0", date: "2026-10-04" }],
  files: [{ version: "1.0.0", date: "2026-10-06" }],
  media: [{ version: "1.0.0", date: "2026-10-06" }],
  store: [{ version: "1.0.0", date: "2026-10-13" }],
};

/** Compares dotted versions ("1.2.0" > "1.10" is false): negative, 0 or positive. Missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** An update is available when the installed version is older than the registry's. */
export function updateAvailable(installed: string | undefined | null, id: AppId): boolean {
  return !!installed && compareVersions(installed, APP_REGISTRY[id].version) < 0;
}
