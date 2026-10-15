import { describe, expect, it } from "vitest";
import { linkParts, safeHref } from "./links.js";

describe("Step 2.13: links in plain text", () => {
  it("finds http, https and www addresses and leaves the rest as text", () => {
    expect(linkParts("see https://voidex.su/a?b=1 and http://example.com or www.mail.ru today")).toEqual([
      { text: "see " },
      { text: "https://voidex.su/a?b=1", href: "https://voidex.su/a?b=1" },
      { text: " and " },
      { text: "http://example.com", href: "http://example.com/" },
      { text: " or " },
      { text: "www.mail.ru", href: "https://www.mail.ru/" },
      { text: " today" },
    ]);
  });

  it("drops sentence punctuation after an address but keeps balanced brackets", () => {
    expect(linkParts("Go to https://voidex.su.")).toEqual([{ text: "Go to " }, { text: "https://voidex.su", href: "https://voidex.su/" }, { text: "." }]);
    expect(linkParts("(https://a.ru/x)")).toEqual([{ text: "(" }, { text: "https://a.ru/x", href: "https://a.ru/x" }, { text: ")" }]);
    expect(linkParts("https://en.wikipedia.org/wiki/A_(b)!")[0]).toEqual({
      text: "https://en.wikipedia.org/wiki/A_(b)",
      href: "https://en.wikipedia.org/wiki/A_(b)",
    });
  });

  it("malformed or unsafe addresses stay text", () => {
    expect(linkParts("http://x and http:// and https://.ru")).toEqual([{ text: "http://x and http:// and https://.ru" }]);
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(linkParts("javascript:alert(1) data:text/html,<b>")).toEqual([{ text: "javascript:alert(1) data:text/html,<b>" }]);
    expect(linkParts('<a href="https://evil.ru">x</a>')).toEqual([{ text: '<a href="' }, { text: "https://evil.ru", href: "https://evil.ru/" }, { text: '">x</a>' }]);
  });

  it("plain text without addresses is one part", () => {
    expect(linkParts("Привет! Как дела?")).toEqual([{ text: "Привет! Как дела?" }]);
    expect(linkParts("")).toEqual([]);
  });
});
