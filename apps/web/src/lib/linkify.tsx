import { Fragment, type ReactNode } from "react";
import { linkParts } from "@voidex/shared";

/**
 * Step 2.13: links in plain text (a letter's body). The text stays text: it is
 * split into strings and <a> elements (React escapes every string), never
 * parsed as HTML, so a letter can't inject markup.
 */
/** Plain text with its addresses as links that open in a new browser context. */
export function Linkified({ text, linkClassName }: { text: string; linkClassName?: string }) {
  const parts = linkParts(text);
  return (
    <>
      {parts.map((p, i): ReactNode =>
        p.href ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={linkClassName ?? "text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"}
            onClick={(e) => e.stopPropagation()}
            data-testid="mail-link"
          >
            {p.text}
          </a>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
