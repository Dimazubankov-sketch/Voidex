import { useMemo, useState, type ReactNode } from "react";
import { RiCheckLine, RiSearchLine } from "@remixicon/react";
import { LANGUAGES, type LanguageCode } from "@voidex/shared";
import { COUNTRY_CODES, callingCode, formatPhoneInput, type CountryCode } from "@voidex/shared/phone";
import { cx } from "@/lib/cx";
import { countryName, flagEmoji, monthNames, useLanguage, useT } from "@/lib/i18n";
import { TextField } from "./controls";

/** Countries sorted by localised name, with the most relevant ones first. */
export function useCountries() {
  const lang = useLanguage();
  return useMemo(() => {
    const collator = new Intl.Collator(lang);
    return COUNTRY_CODES.map((code) => ({ code, name: countryName(code, lang) })).sort((a, b) => collator.compare(a.name, b.name));
  }, [lang]);
}

export function CountryList({ value, onChange, autoFocus }: { value: string | null; onChange: (c: CountryCode) => void; autoFocus?: boolean }) {
  const t = useT();
  const all = useCountries();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    const filtered = query
      ? all.filter((c) => c.name.toLowerCase().includes(query) || c.code.toLowerCase() === query || `+${callingCode(c.code)}`.startsWith(query))
      : all;
    // Selected country pinned on top when not searching.
    if (!query && value) {
      const sel = filtered.find((c) => c.code === value);
      return sel ? [sel, ...filtered.filter((c) => c.code !== value)] : filtered;
    }
    return filtered;
  }, [all, q, value]);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <TextField
        label={t("signup.country.search")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        left={<RiSearchLine className="size-5" />}
        compact
        autoFocus={autoFocus}
        data-testid="country-search"
      />
      <div className="flex flex-col" role="listbox" aria-label={t("settings.country")}>
        {list.slice(0, 250).map((c) => (
          <OptionRow
            key={c.code}
            selected={c.code === value}
            onClick={() => onChange(c.code)}
            leading={<span className="text-[22px] leading-none">{flagEmoji(c.code)}</span>}
            trailing={<span className="text-[13px] tabular-nums text-text-tertiary">+{callingCode(c.code)}</span>}
            testId={`country-${c.code}`}
          >
            {c.name}
          </OptionRow>
        ))}
      </div>
    </div>
  );
}

export function LanguageList({ value, onChange }: { value: LanguageCode | null; onChange: (l: LanguageCode) => void }) {
  return (
    <div className="flex flex-col gap-2" role="listbox">
      {LANGUAGES.map((l) => (
        <OptionRow key={l.code} selected={value === l.code} onClick={() => onChange(l.code)} large testId={`language-${l.code}`}>
          <span className="font-medium">{l.nativeName}</span>
        </OptionRow>
      ))}
    </div>
  );
}

export function OptionRow({
  selected,
  onClick,
  children,
  leading,
  trailing,
  large,
  testId,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  large?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      data-testid={testId}
      className={cx(
        "pressable flex w-full items-center gap-3 rounded-2xl px-4 text-left text-[16px]",
        large ? "h-16 border" : "h-[52px]",
        selected ? "bg-primary-soft text-primary-strong" : "hover:bg-surface-hover",
        large && (selected ? "border-primary/40" : "border-border"),
      )}
    >
      {leading}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
      <span className={cx("flex size-6 items-center justify-center rounded-full transition-all", selected ? "scale-100 bg-primary text-white" : "scale-0")}>
        <RiCheckLine className="size-4" />
      </span>
    </button>
  );
}

/** Phone input with the country calling code, formatted as the user types. */
export function PhoneField({
  value,
  onChange,
  country,
  error,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  country: CountryCode;
  error?: string;
  label: string;
  autoFocus?: boolean;
}) {
  const prefix = `+${callingCode(country)}`;
  const international = value.trim().startsWith("+");
  return (
    <TextField
      label={label}
      type="tel"
      inputMode="tel"
      autoComplete="tel-national"
      value={value}
      onChange={(e) => {
        const raw = e.target.value;
        // Keep formatting only when appending (deleting through separators must stay easy).
        const formatted = raw.length > value.length ? formatPhoneInput(raw, raw.trim().startsWith("+") ? undefined : country) : raw;
        onChange(formatted);
      }}
      error={error}
      autoFocus={autoFocus}
      data-testid="phone-input"
      left={
        !international ? (
          <span className="flex items-center gap-1.5 text-[16px] text-text">
            <span className="text-[20px] leading-none">{flagEmoji(country)}</span>
            <span className="tabular-nums text-text-secondary">{prefix}</span>
          </span>
        ) : undefined
      }
    />
  );
}

export interface DateParts {
  day: string;
  month: string;
  year: string;
}

export function BirthDateFields({ value, onChange, error }: { value: DateParts; onChange: (v: DateParts) => void; error?: string }) {
  const t = useT();
  const lang = useLanguage();
  const months = monthNames(lang);
  const digits = (s: string, n: number) => s.replace(/\D/g, "").slice(0, n);
  return (
    <div>
      <div className="grid grid-cols-[1fr_1.6fr_1.2fr] gap-2.5">
        <TextField
          label={t("signup.day")}
          inputMode="numeric"
          autoComplete="bday-day"
          value={value.day}
          onChange={(e) => onChange({ ...value, day: digits(e.target.value, 2) })}
          data-testid="birth-day"
        />
        <div className="relative">
          <select
            aria-label={t("signup.month")}
            value={value.month}
            onChange={(e) => onChange({ ...value, month: e.target.value })}
            autoComplete="bday-month"
            data-testid="birth-month"
            className={cx(
              "h-[58px] w-full appearance-none rounded-2xl border border-transparent bg-surface-secondary px-4 pt-4 text-[16px] outline-none",
              "focus:border-primary focus:bg-surface focus:shadow-[0_0_0_4px_rgba(108,92,255,0.12)]",
              !value.month && "text-transparent",
            )}
          >
            <option value="" disabled />
            {months.map((m, i) => (
              <option key={m} value={String(i + 1)} className="text-text">
                {m}
              </option>
            ))}
          </select>
          <span
            className={cx(
              "pointer-events-none absolute left-4 text-text-secondary transition-all",
              value.month ? "top-2 text-[12px]" : "top-1/2 -translate-y-1/2 text-[16px]",
            )}
          >
            {t("signup.month")}
          </span>
        </div>
        <TextField
          label={t("signup.year")}
          inputMode="numeric"
          autoComplete="bday-year"
          value={value.year}
          onChange={(e) => onChange({ ...value, year: digits(e.target.value, 4) })}
          data-testid="birth-year"
        />
      </div>
      {error && <div className="mt-1.5 px-1 text-[13px] text-danger animate-fade-up">{error}</div>}
    </div>
  );
}

export function datePartsToIso(p: DateParts): string | null {
  if (!p.day || !p.month || p.year.length !== 4) return null;
  return `${p.year}-${p.month.padStart(2, "0")}-${p.day.padStart(2, "0")}`;
}

export function isoToDateParts(iso: string): DateParts {
  const [y, m, d] = iso.split("-");
  return { year: y ?? "", month: String(Number(m ?? "")), day: String(Number(d ?? "")) };
}
