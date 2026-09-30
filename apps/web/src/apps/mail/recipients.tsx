import { useEffect, useRef, useState, type ReactNode } from "react";
import { RiCloseLine } from "@remixicon/react";
import { parseAddress } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { useMailDomain } from "@/lib/system";
import { resolveAddress, useContacts } from "./data";

type Status = { state: "checking" } | { state: "ok"; name: string | null } | { state: "unknown" } | { state: "external" };
const cache = new Map<string, Status>();

function useAddressStatus(address: string) {
  const [status, setStatus] = useState<Status>(cache.get(address) ?? { state: "checking" });
  useEffect(() => {
    if (cache.has(address)) return setStatus(cache.get(address)!);
    let alive = true;
    resolveAddress(address)
      .then((r) => {
        const s: Status = !r.internal ? { state: "external" } : r.exists ? { state: "ok", name: r.name } : { state: "unknown" };
        cache.set(address, s);
        if (alive) setStatus(s);
      })
      .catch(() => alive && setStatus({ state: "unknown" }));
    return () => {
      alive = false;
    };
  }, [address]);
  return status;
}

function Chip({ address, onRemove, flagged }: { address: string; onRemove: () => void; flagged?: boolean }) {
  const t = useT();
  const status = useAddressStatus(address);
  const bad = flagged || status.state === "unknown" || status.state === "external";
  return (
    <span
      className={cx(
        "inline-flex h-8 max-w-full items-center gap-1 rounded-full pl-3 pr-1 text-[14px] animate-pop",
        bad ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary-strong",
      )}
      title={status.state === "unknown" ? t("mail.recipientUnknown") : status.state === "external" ? t("mail.recipientExternal") : address}
      data-testid="recipient-chip"
      data-status={status.state}
    >
      <span className="truncate">{status.state === "ok" && status.name ? status.name : address}</span>
      <button type="button" onClick={onRemove} className="flex size-6 items-center justify-center rounded-full hover:bg-black/5" aria-label={t("common.remove")}>
        <RiCloseLine className="size-4" />
      </button>
    </span>
  );
}

/** Address chips with autocomplete from your own correspondence and live VOIDEX lookups. */
export function RecipientField({
  label,
  value,
  onChange,
  invalid,
  autoFocus,
  testId,
  trailing,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  invalid?: string[];
  autoFocus?: boolean;
  testId?: string;
  /** Control at the end of the row (e.g. "Cc / Bcc"): laid out beside the input, never on top of it. */
  trailing?: ReactNode;
}) {
  const t = useT();
  const domain = useMailDomain();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const contacts = useContacts(text);
  const suggestions = (contacts.data ?? []).filter((c) => !value.includes(c.address)).slice(0, 5);

  const commit = (raw: string) => {
    const parts = raw
      .split(/[\s,;]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const next = [...value];
    for (const p of parts) {
      const parsed = parseAddress(p, domain);
      const addr = parsed ? `${parsed.local}@${parsed.domain}` : p.toLowerCase();
      if (!next.includes(addr)) next.push(addr);
    }
    onChange(next);
    setText("");
  };

  return (
    <div className="relative flex min-h-12 items-start gap-2 border-b py-2" onClick={() => input.current?.focus()}>
      <span className="w-14 shrink-0 pt-1.5 text-[14px] text-text-secondary">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {value.map((a) => (
          <Chip key={a} address={a} flagged={invalid?.includes(a)} onRemove={() => onChange(value.filter((x) => x !== a))} />
        ))}
        <input
          ref={input}
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;\s]$/.test(v) && v.trim()) commit(v);
            else setText(v);
          }}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === "Tab") && text.trim()) {
              e.preventDefault();
              commit(text);
            } else if (e.key === "Backspace" && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (text.trim()) commit(text);
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            if (/[,;\s]/.test(pasted.trim())) {
              e.preventDefault();
              commit(pasted);
            }
          }}
          placeholder={value.length ? "" : t("mail.recipientHint", { domain })}
          className="h-8 min-w-[120px] flex-1 truncate bg-transparent text-[15px] outline-none placeholder:text-text-tertiary"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          data-testid={testId}
        />
      </div>
      {trailing && (
        <div className="flex h-8 shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
          {trailing}
        </div>
      )}
      {focused && suggestions.length > 0 && (
        <div className="absolute left-16 top-full z-30 mt-1 w-[min(360px,calc(100%-64px))] overflow-hidden rounded-2xl border bg-surface p-1 shadow-float">
          {suggestions.map((s) => (
            <button
              key={s.address}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                commit(s.address);
              }}
              className="flex w-full flex-col items-start rounded-xl px-3 py-2 text-left hover:bg-surface-hover"
            >
              <span className="text-[14px] font-medium">{s.name ?? s.address}</span>
              {s.name && <span className="text-[12px] text-text-secondary">{s.address}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
