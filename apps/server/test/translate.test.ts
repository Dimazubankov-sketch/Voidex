import { describe, expect, it } from "vitest";
import { MyMemoryTranslator } from "../src/services/translate.js";

describe("MyMemory translator", () => {
  it("sends the detected source (or Autodetect) and the target, joins chunks", async () => {
    const calls: URL[] = [];
    const fake = (async (url: URL) => {
      calls.push(url);
      return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: `T(${url.searchParams.get("q")})` } }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = new MyMemoryTranslator("ops@example.com", fake);
    expect(await t.translate("Hello there.", "en", "ru")).toBe("T(Hello there.)");
    expect(calls[0]!.searchParams.get("langpair")).toBe("en|ru");
    expect(calls[0]!.searchParams.get("de")).toBe("ops@example.com");
    await t.translate("Hallo", null, "ru");
    expect(calls[1]!.searchParams.get("langpair")).toBe("Autodetect|ru");
    const long = "A".repeat(300) + ". " + "B".repeat(300) + ".";
    calls.length = 0;
    await t.translate(long, "en", "de");
    expect(calls.length).toBe(2);
  });

  it("provider errors become an honest 503, never a fake translation", async () => {
    const t = new MyMemoryTranslator(undefined, (async () => new Response(JSON.stringify({ responseStatus: 429 }), { status: 429 })) as unknown as typeof fetch);
    await expect(t.translate("Hello", "en", "ru")).rejects.toMatchObject({ code: "service_unavailable" });
    const down = new MyMemoryTranslator(undefined, (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch);
    await expect(down.translate("Hello", "en", "ru")).rejects.toMatchObject({ code: "service_unavailable" });
  });
});
