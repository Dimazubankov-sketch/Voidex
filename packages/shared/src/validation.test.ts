import { describe, expect, it } from "vitest";
import {
  checkPassword,
  isPasswordAcceptable,
  maskPhone,
  parsePhone,
  usernameCandidates,
  validateBirthDate,
  validateName,
  validateUsername,
  subjectWithPrefix,
  parseAddress,
} from "./index.js";

const NOW = new Date(Date.UTC(2026, 8, 28));

describe("names", () => {
  it("accepts latin and cyrillic names", () => {
    expect(validateName("Anna")).toBeNull();
    expect(validateName("Дмитрий")).toBeNull();
    expect(validateName("Jean-Luc O'Neil")).toBeNull();
  });
  it("rejects empty, digits and overly long names", () => {
    expect(validateName("   ")).toBe("required");
    expect(validateName("R2D2")).toBe("invalid");
    expect(validateName("a".repeat(51))).toBe("too_long");
  });
});

describe("birth date", () => {
  it("rejects impossible calendar dates", () => {
    expect(validateBirthDate({ day: 31, month: 2, year: 2000 }, "US", NOW)).toBe("invalid");
    expect(validateBirthDate({ day: 29, month: 2, year: 2001 }, "US", NOW)).toBe("invalid");
    expect(validateBirthDate({ day: 29, month: 2, year: 2000 }, "US", NOW)).toBeNull();
  });
  it("rejects future dates and implausible ages", () => {
    expect(validateBirthDate({ day: 1, month: 1, year: 2030 }, "US", NOW)).toBe("future");
    expect(validateBirthDate({ day: 1, month: 1, year: 1890 }, "US", NOW)).toBe("too_old");
  });
  it("enforces regional minimum age", () => {
    expect(validateBirthDate({ day: 1, month: 1, year: 2014 }, "RU", NOW)).toBe("too_young");
    expect(validateBirthDate({ day: 1, month: 1, year: 2012 }, "RU", NOW)).toBeNull();
    expect(validateBirthDate({ day: 1, month: 1, year: 2012 }, "DE", NOW)).toBe("too_young");
  });
});

describe("phone", () => {
  it("parses valid mobile numbers to E.164", () => {
    expect(parsePhone("+7 916 123-45-67")?.e164).toBe("+79161234567");
    expect(parsePhone("8 916 123 45 67", "RU")?.e164).toBe("+79161234567");
    expect(parsePhone("+1 415 555 2671")?.e164).toBe("+14155552671");
  });
  it("rejects invalid numbers", () => {
    expect(parsePhone("12345")).toBeNull();
    expect(parsePhone("+7 000 000")).toBeNull();
    expect(parsePhone("hello")).toBeNull();
  });
  it("masks middle digits", () => {
    const masked = maskPhone("+79161234567");
    expect(masked.startsWith("+7 9")).toBe(true);
    expect(masked.endsWith("67")).toBe(true);
    expect(masked).toContain("•");
  });
});

describe("username", () => {
  it("validates format and reserved names", () => {
    expect(validateUsername("anna.smith")).toBeNull();
    expect(validateUsername("ab")).toBe("too_short");
    expect(validateUsername("1anna")).toBe("invalid");
    expect(validateUsername("anna..smith")).toBe("invalid");
    expect(validateUsername("anna.")).toBe("invalid");
    expect(validateUsername("admin")).toBe("reserved");
    expect(validateUsername("voidexteam")).toBe("reserved");
  });
  it("suggests valid alternatives, including transliteration", () => {
    const c = usernameCandidates("dima", "Дмитрий", "Зубанков", 42);
    expect(c.length).toBeGreaterThan(3);
    expect(c).toContain("dmitriy.zubankov");
    for (const v of c) expect(validateUsername(v)).toBeNull();
  });
});

describe("password", () => {
  it("rejects weak passwords", () => {
    expect(isPasswordAcceptable("short1")).toBe(false);
    expect(isPasswordAcceptable("onlyletterslong")).toBe(false);
    expect(isPasswordAcceptable("password123")).toBe(false);
    expect(checkPassword("annasmith2024!", { firstName: "Anna", lastName: "Smith" }).notPersonal).toBe(false);
  });
  it("accepts a strong password", () => {
    expect(isPasswordAcceptable("Violet-Orbit-42")).toBe(true);
  });
});

describe("mail helpers", () => {
  it("prefixes subjects once", () => {
    expect(subjectWithPrefix("Hello", "Re")).toBe("Re: Hello");
    expect(subjectWithPrefix("Re: Hello", "Re")).toBe("Re: Hello");
    expect(subjectWithPrefix("Hello", "Fwd")).toBe("Fwd: Hello");
  });
  it("parses addresses with a default domain", () => {
    expect(parseAddress("Anna", "voidex.app")).toEqual({ local: "anna", domain: "voidex.app" });
    expect(parseAddress("anna@voidex.app", "voidex.app")).toEqual({ local: "anna", domain: "voidex.app" });
    expect(parseAddress("anna@", "voidex.app")).toBeNull();
  });
});
