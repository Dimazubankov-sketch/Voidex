/**
 * Development / test demo data for Vibex: a few people with profiles, posts
 * (some with pictures), comments, likes and chats.
 *
 *   pnpm --filter @voidex/server db:seed:dev [your-address@voidops.ru]
 *
 * With an address, the demo people also write to that account, so its chat
 * list is not empty. Idempotent: existing demo accounts are left as they are.
 *
 * NEVER in production: the script refuses to run when NODE_ENV=production (or
 * when the server would refuse dev providers), so production users only ever
 * see real accounts and real posts.
 */
import { deflateSync } from "node:zlib";
import { APP_REGISTRY, DEFAULT_PREFERENCES, LEGAL_DOCUMENTS } from "@voidex/shared";
import { and, eq } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { hashPassword } from "../lib/password.js";
import { PgBlobStorage } from "../services/blobs.js";
import { EventHub } from "../services/events.js";
import { ConsoleSmsProvider } from "../services/sms/index.js";
import { DisabledTranslator } from "../services/translate.js";
import { VibexService } from "../services/vibex.js";
import { NotificationService } from "../services/notifications.js";
import { createDb } from "./client.js";
import { sql } from "drizzle-orm";
import { consents, installedApps, mailAccounts, userAvatars, userPreferences, users, vibexProfiles } from "./schema.js";

export const DEMO_PASSWORD = "Demo-Vibex-2026";

const PEOPLE = [
  { username: "demo.alina", firstName: "Алина", lastName: "Морозова", tone: [124, 108, 255] },
  { username: "demo.mark", firstName: "Марк", lastName: "Лебедев", tone: [75, 107, 255] },
  { username: "demo.sofia", firstName: "Sofia", lastName: "Rossi", tone: [162, 102, 255] },
  { username: "demo.timur", firstName: "Тимур", lastName: "Ахметов", tone: [47, 155, 255] },
] as const;

const POSTS: { by: number; text: string; picture?: boolean }[] = [
  { by: 0, text: "Первый день в Vibex! Здесь спокойно и чисто — как и должно быть.", picture: true },
  { by: 1, text: "Кто-нибудь уже пробовал свободное размещение значков на рабочем столе VOIDEX? Собрал всё рабочее в левый угол 👌" },
  { by: 2, text: "Good morning from Milan! Coffee, sunshine and a long list of ideas for today.", picture: true },
  { by: 3, text: "Сегодня закончил большой проект. Спасибо всем, кто помогал советами 🙏" },
  { by: 2, text: "Ich lerne gerade Deutsch und es ist wirklich nicht einfach, aber sehr schön." },
  { by: 0, text: "Поделитесь любимыми обоями VOIDEX — у меня «Молоко и фиолет»." },
];

/**
 * Step 2.3 demo people — explicitly named "Demo …" so nobody mistakes them for
 * real accounts: avatars, covers, profile details, photo posts, comment
 * threads, follows and chats (pinned, a reply, a voice message, a file).
 */
const DEMO23 = [
  { username: "demo.anna", firstName: "Demo", lastName: "Anna", tone: [124, 92, 255], bio: "Тестовый профиль Vibex. Фото, кофе и интерфейсы.", website: "voidex.su", city: "Москва" },
  { username: "demo.alex", firstName: "Demo", lastName: "Alex", tone: [64, 120, 255], bio: "Demo account · пишу о технологиях", website: "", city: "Санкт-Петербург" },
  { username: "demo.mia", firstName: "Demo", lastName: "Mia", tone: [196, 92, 230], bio: "Demo · travel & photography", website: "example.com", city: "Milan" },
] as const;

const CHATS: { a: number; b: number; lines: [number, string][] }[] = [
  { a: 0, b: 1, lines: [[0, "Привет! Как дела?"], [1, "Отлично, только что вернулся с прогулки"], [0, "Скинь фото, если есть 🙂"]] },
  { a: 2, b: 3, lines: [[2, "Hi Timur! Are we still on for Friday?"], [3, "Yes, 7 pm works for me"]] },
];

/** A soft two-tone wave picture (PNG) — demo post media without external files. */
function wavePng(w: number, h: number, a: readonly number[], b: readonly number[]): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const edge = h * 0.55 + Math.sin((x / w) * Math.PI * 1.6) * h * 0.18;
      const t = Math.max(0, Math.min(1, (y - edge) / (h * 0.08) + 0.5));
      const i = y * (w * 3 + 1) + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[i + c] = Math.round(a[c]! * (1 - t) + b[c]! * t);
    }
  }
  return png(w, h, raw);
}


/** A soft round "portrait" (PNG): a two-tone radial gradient — demo avatars without external files. */
function avatarPng(size: number, tone: readonly number[]): Buffer {
  const light = [250, 248, 255];
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size * 0.35, y - size * 0.3) / size;
      const t = Math.max(0, Math.min(1, d * 1.4));
      const i = y * (size * 3 + 1) + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[i + c] = Math.round(light[c]! * (1 - t) + tone[c]! * t);
    }
  }
  return png(size, size, raw);
}

/** A short soft tone (WAV) — a demo voice message without a microphone. */
function toneWav(seconds: number): Buffer {
  const rate = 16000;
  const n = Math.round(rate * seconds);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 1600, (n - i) / 1600) * (0.55 + 0.45 * Math.sin(i / 2400));
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 9000 * env), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function png(w: number, h: number, raw: Buffer): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function crc32(buf: Buffer) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to seed demo users: NODE_ENV=production. Demo data exists only in development / test.");
    process.exit(1);
  }
  const config = loadConfig();
  if (config.production) {
    console.error("Refusing to seed demo users: NODE_ENV=production. Demo data exists only in development / test.");
    process.exit(1);
  }
  const target = process.argv[2]?.trim().toLowerCase();
  const { db, pool } = createDb(config.databaseUrl);
  const ctx = {
    db,
    config,
    sms: new ConsoleSmsProvider(() => {}),
    events: new EventHub(),
    blobs: new PgBlobStorage(db),
    translator: new DisabledTranslator(),
    now: () => new Date(),
  };
  // Demo activity also fills the demo people's Notification Center (follows, comments, messages).
  const vibex = new VibexService(ctx, new NotificationService(ctx));

  /** Creates a demo VOIDEX account (or finds it): returns its id and whether it is new. */
  async function ensureAccount(p: { username: string; firstName: string; lastName: string }, i: number): Promise<{ id: string; created: boolean }> {
    const [existing] = await db.select({ id: mailAccounts.userId }).from(mailAccounts).where(eq(mailAccounts.localPart, p.username));
    if (existing) return { id: existing.id, created: false };
    const now = new Date();
    const [u] = await db
      .insert(users)
      .values({
        firstName: p.firstName,
        lastName: p.lastName,
        birthDate: `1994-05-${String((i % 28) + 1).padStart(2, "0")}`,
        country: "RU",
        language: "ru",
        // Fictional numbers in a reserved test range; never a real subscriber.
        phone: `+79990000${String(i).padStart(3, "0")}`,
        phoneVerifiedAt: now,
        passwordHash: await hashPassword(DEMO_PASSWORD),
        passwordChangedAt: now,
      })
      .returning();
    await db.insert(mailAccounts).values({ userId: u!.id, localPart: p.username, domain: config.mailDomain, address: `${p.username}@${config.mailDomain}` });
    await db.insert(userPreferences).values({ userId: u!.id, data: DEFAULT_PREFERENCES });
    await db.insert(consents).values(LEGAL_DOCUMENTS.map((d) => ({ userId: u!.id, documentKey: d.key, documentVersion: d.version })));
    await db.insert(installedApps).values(
      Object.values(APP_REGISTRY)
        .filter((a) => a.preinstalled)
        .map((a) => ({ userId: u!.id, appId: a.id, version: a.version })),
    );
    await db.insert(vibexProfiles).values({ userId: u!.id }).onConflictDoNothing();
    return { id: u!.id, created: true };
  }

  const ids: string[] = [];
  let created = 0;
  for (const [i, p] of PEOPLE.entries()) {
    // Step 2.2 demo accounts keep their numbers (+79990000000…3).
    const r = await ensureAccount(p, i);
    ids.push(r.id);
    if (r.created) created++;
  }

  if (created) {
    const posts: string[] = [];
    for (const p of POSTS) {
      const author = ids[p.by]!;
      const mediaIds: string[] = [];
      if (p.picture) {
        const tone = PEOPLE[p.by]!.tone;
        const file = await vibex.upload(author, "post", { filename: "vibex-demo.png", data: wavePng(640, 400, [247, 245, 252], tone) });
        mediaIds.push(file.id);
      }
      posts.push((await vibex.createPost(author, { text: p.text, mediaIds })).id);
    }
    await vibex.like(ids[1]!, posts[0]!, true);
    await vibex.like(ids[2]!, posts[0]!, true);
    await vibex.like(ids[0]!, posts[2]!, true);
    await vibex.addComment(ids[3]!, posts[0]!, "Добро пожаловать! 🎉");
    await vibex.addComment(ids[1]!, posts[3]!, "Поздравляю!");
    await vibex.repost(ids[3]!, posts[2]!);
    for (const c of CHATS) {
      const chat = await vibex.openDirect(ids[c.a]!, ids[c.b]!);
      for (const [who, text] of c.lines) await vibex.send(ids[who]!, chat.id, { text, fileIds: [] });
    }
  }

  // ---- Step 2.3 demo people
  const demo: string[] = [];
  let created23 = 0;
  for (const [i, p] of DEMO23.entries()) {
    const r = await ensureAccount(p, 10 + i);
    demo.push(r.id);
    if (!r.created) continue;
    created23++;
    await db.insert(userAvatars).values({ userId: r.id, mimeType: "image/png", data: avatarPng(256, p.tone) }).onConflictDoNothing();
    await db.update(users).set({ avatarVersion: sql`${users.avatarVersion} + 1` }).where(eq(users.id, r.id));
    await vibex.updateProfile(r.id, { bio: p.bio, website: p.website, city: p.city });
    await vibex.setCover(r.id, "image/png", wavePng(1200, 400, [246, 244, 252], p.tone));
  }
  if (created23) {
    const [anna, alex, mia] = demo as [string, string, string];
    const pic = async (who: string, tone: readonly number[], w = 800, h = 600) => (await vibex.upload(who, "post", { filename: "demo-photo.png", data: wavePng(w, h, [248, 246, 255], tone) })).id;
    const p1 = await vibex.createPost(anna, { text: "Утро в Москве и новый интерфейс VOIDEX ☕️ (демо-пост)", mediaIds: [await pic(anna, DEMO23[0].tone)] });
    await vibex.createPost(alex, { text: "Demo: проверяем ленту, лайки и комментарии в Vibex.", mediaIds: [] });
    await vibex.createPost(mia, { text: "Milano — three shots from today (demo)", mediaIds: [await pic(mia, DEMO23[2].tone), await pic(mia, [255, 160, 120]), await pic(mia, [90, 190, 200])] });
    await vibex.createPost(anna, { text: "Ещё одно демо-фото для вкладки «Фото/Видео».", mediaIds: [await pic(anna, [255, 170, 210], 600, 800)] });
    // A comment thread: root, reply, reply to a reply.
    const root = await vibex.addComment(alex, p1.id, "Красиво! Где это?");
    const r1 = await vibex.addComment(mia, p1.id, "Похоже на Патриаршие 🙂", root.id);
    await vibex.addComment(anna, p1.id, "Да, угадала!", r1.id);
    await vibex.like(alex, p1.id, true);
    await vibex.like(mia, p1.id, true);
    // Follows.
    for (const a of demo) for (const b of demo) if (a !== b) await vibex.follow(a, b, true);
    await vibex.follow(anna, ids[0]!, true);
    // Chats: text, a reply, a file, a voice message; Anna pins the chat with Alex.
    const chat = await vibex.openDirect(anna, alex);
    const m1 = await vibex.send(alex, chat.id, { text: "Привет! Это демо-чат Vibex.", fileIds: [] });
    await vibex.send(anna, chat.id, { text: "Привет! Отвечаю на твоё сообщение 👋", fileIds: [], replyToId: m1.id });
    const doc = await vibex.upload(alex, "message", { filename: "demo-notes.txt", data: Buffer.from("Demo file from Vibex seed.\n") });
    await vibex.send(alex, chat.id, { text: "Вот файл с заметками", fileIds: [doc.id] });
    const voice = await vibex.upload(anna, "voice", { filename: "voice.wav", data: toneWav(2.5) });
    await vibex.send(anna, chat.id, { text: "", fileIds: [voice.id], kind: "voice", durationMs: 2500 });
    await vibex.setPins(anna, [chat.id]);
    const chat2 = await vibex.openDirect(mia, anna);
    await vibex.send(mia, chat2.id, { text: "Hi Anna! Demo message from Mia ✈️", fileIds: [] });
  }

  if (target) {
    const [acc] = await db.select({ id: mailAccounts.userId }).from(mailAccounts).where(and(eq(mailAccounts.address, target)));
    if (!acc) console.warn(`No VOIDEX account ${target}: skipped the demo chats with it.`);
    else {
      await db.insert(vibexProfiles).values({ userId: acc.id }).onConflictDoNothing();
      for (const [i, line] of ["Привет! Добро пожаловать в Vibex 👋", "Это демо-чат: можно отвечать, отправлять файлы и делиться постами."].entries()) {
        const chat = await vibex.openDirect(ids[i]!, acc.id);
        await vibex.send(ids[i]!, chat.id, { text: line, fileIds: [] });
      }
      for (const who of demo) {
        await vibex.follow(who, acc.id, true);
        const chat = await vibex.openDirect(who, acc.id);
        await vibex.send(who, chat.id, { text: "Привет! Я демо-профиль Vibex — можно ответить голосом или кружком 🙂", fileIds: [] });
      }
    }
  }

  await pool.end();
  console.log(`Demo Vibex data ready: ${created + created23} new account(s). Sign in as demo.anna@${config.mailDomain} / ${DEMO_PASSWORD}`);
}

await main();
