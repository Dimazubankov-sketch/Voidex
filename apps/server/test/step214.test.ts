import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_REGISTRY, type InstalledAppDto, type NotificationDto, type NotificationListDto } from "@voidex/shared";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

async function user(first: string) {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: first, lastName: "Часовой" });
  return { d, id: r.user.id as string };
}

describe("Step 2.14: Clock", () => {
  it("is a preinstalled system app (tools) for new accounts, with its registry manifest", async () => {
    const a = await user("Анна");
    const apps = (await a.d.get("/api/apps")).body as InstalledAppDto[];
    const clock = apps.find((x) => x.id === "clock")!;
    expect(clock).toBeTruthy();
    expect(clock.manifest.name.ru).toBe("Часы");
    expect(clock.manifest.category).toBe("tools");
    expect(clock.manifest.kind).toBe("system");
    expect(clock.version).toBe(APP_REGISTRY.clock.version);
    // Listed once, in registry order.
    expect(apps.filter((x) => x.id === "clock")).toHaveLength(1);
  });

  it("a ring becomes a notification of the caller's account (and nobody else's), with its target", async () => {
    const a = await user("Борис");
    const b = await user("Вера");
    const r = await a.d.post("/api/notifications/clock", { type: "clock.alarm", title: "Подъём", body: "07:00", id: "alarm-1", device: "dev-a" });
    expect(r.status).toBe(200);
    const n = r.body as NotificationDto;
    expect(n.app).toBe("clock");
    expect(n.type).toBe("clock.alarm");
    expect(n.target).toEqual({ kind: "alarm", id: "alarm-1", device: "dev-a" });
    const listA = ((await a.d.get("/api/notifications")).body as NotificationListDto).items.filter((x) => x.app === "clock");
    expect(listA.map((x) => x.title)).toEqual(["Подъём"]);
    const listB = ((await b.d.get("/api/notifications")).body as NotificationListDto).items.filter((x) => x.app === "clock");
    expect(listB).toHaveLength(0);
    const t = await a.d.post("/api/notifications/clock", { type: "clock.timer", title: "Чай", body: "03:00", id: "timer-1", device: "dev-a" });
    expect((t.body as NotificationDto).target.kind).toBe("timer");
  });

  it("rejects other types, empty titles and anonymous callers", async () => {
    const a = await user("Глеб");
    expect((await a.d.post("/api/notifications/clock", { type: "mail.new", title: "x", id: "1", device: "d" })).status).toBe(400);
    expect((await a.d.post("/api/notifications/clock", { type: "clock.alarm", title: " ", id: "1", device: "d" })).status).toBe(400);
    expect((await a.d.post("/api/notifications/clock", { type: "clock.alarm", title: "x".repeat(81), id: "1", device: "d" })).status).toBe(400);
    const anon = new Device(env.app);
    expect((await anon.post("/api/notifications/clock", { type: "clock.alarm", title: "x", id: "1", device: "d" })).status).toBe(401);
  });
});
