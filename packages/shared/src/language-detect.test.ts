import { describe, expect, it } from "vitest";
import { detectLanguage } from "./language-detect.js";

describe("detectLanguage (no source-language picker)", () => {
  it.each([
    ["Привет! Как дела сегодня?", "ru"],
    ["Good morning, how are you today?", "en"],
    ["Ich lerne gerade Deutsch und es ist nicht einfach", "de"],
    ["Hola, ¿cómo estás? Hoy es un día muy bonito", "es"],
    ["Bonjour, je suis très content aujourd'hui", "fr"],
    ["Olá, você está muito bem hoje", "pt"],
    ["Bugün çok güzel bir gün ve ben mutluyum", "tr"],
    ["今日はとても良い天気ですね", "ja"],
    ["오늘 날씨가 정말 좋네요", "ko"],
    ["今天天气很好", "zh"],
  ])("%s → %s", (text, lang) => {
    expect(detectLanguage(text)).toBe(lang);
  });

  it("no letters or no evidence → null (the provider detects)", () => {
    expect(detectLanguage("👍 123 !!!")).toBeNull();
    expect(detectLanguage("Xyzzy")).toBeNull();
  });
});
