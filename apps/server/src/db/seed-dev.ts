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
import { createDb } from "./client.js";
import { consents, installedApps, mailAccounts, userPreferences, users, vibexProfiles } from "./schema.js";

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
  const vibex = new VibexService({
    db,
    config,
    sms: new ConsoleSmsProvider(() => {}),
    events: new EventHub(),
    blobs: new PgBlobStorage(db),
    translator: new DisabledTranslator(),
    now: () => new Date(),
  });

  const ids: string[] = [];
  let created = 0;
  for (const [i, p] of PEOPLE.entries()) {
    const [existing] = await db.select({ id: mailAccounts.userId }).from(mailAccounts).where(eq(mailAccounts.localPart, p.username));
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const now = new Date();
    const [u] = await db
      .insert(users)
      .values({
        firstName: p.firstName,
        lastName: p.lastName,
        birthDate: "1994-05-0" + (i + 1),
        country: "RU",
        language: "ru",
        // Fictional numbers in a reserved test range; never a real subscriber.
        phone: `+7999000000${i}`,
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
    ids.push(u!.id);
    created++;
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

  if (target) {
    const [acc] = await db.select({ id: mailAccounts.userId }).from(mailAccounts).where(and(eq(mailAccounts.address, target)));
    if (!acc) console.warn(`No VOIDEX account ${target}: skipped the demo chats with it.`);
    else {
      await db.insert(vibexProfiles).values({ userId: acc.id }).onConflictDoNothing();
      for (const [i, line] of ["Привет! Добро пожаловать в Vibex 👋", "Это демо-чат: можно отвечать, отправлять файлы и делиться постами."].entries()) {
        const chat = await vibex.openDirect(ids[i]!, acc.id);
        await vibex.send(ids[i]!, chat.id, { text: line, fileIds: [] });
      }
    }
  }

  await pool.end();
  console.log(`Demo Vibex data ready: ${created} new account(s). Sign in as demo.alina@${config.mailDomain} / ${DEMO_PASSWORD}`);
}

await main();
