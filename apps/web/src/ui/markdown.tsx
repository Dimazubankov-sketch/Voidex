import type { ReactNode } from "react";

/**
 * Minimal, safe Markdown renderer for legal documents: headings, paragraphs,
 * lists, blockquotes, **bold**. It builds React elements — never HTML strings —
 * so document content can't inject markup.
 */
export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const cls = level === 1 ? "text-[22px] font-bold mt-2 mb-3" : level === 2 ? "text-[17px] font-semibold mt-6 mb-2" : "text-[15px] font-semibold mt-4 mb-1";
      blocks.push(
        <div key={key++} role="heading" aria-level={level} className={cls}>
          {inline(h[2]!)}
        </div>,
      );
      i++;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^[-*]\s+/, ""));
      blocks.push(
        <ul key={key++} className="my-2 list-disc space-y-1 pl-5 text-text-secondary">
          {items.map((it, n) => (
            <li key={n}>{inline(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) quote.push(lines[i++]!.replace(/^>\s?/, ""));
      blocks.push(
        <div key={key++} className="my-3 rounded-2xl bg-warning-soft px-4 py-3 text-[14px] text-[#8a5a00]">
          {inline(quote.join(" "))}
        </div>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,3}\s|[-*]\s|>)/.test(lines[i]!)) para.push(lines[i++]!);
    blocks.push(
      <p key={key++} className="my-2 leading-relaxed text-text-secondary">
        {inline(para.join(" "))}
      </p>,
    );
  }
  return (
    <div className="text-[15px]" data-selectable>
      {blocks}
    </div>
  );
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-text">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}
