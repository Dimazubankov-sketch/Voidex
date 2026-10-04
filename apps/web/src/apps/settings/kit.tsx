import type { ReactNode } from "react";
import { RiArrowRightSLine } from "@remixicon/react";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { VoidexMark } from "@/brand/brand";

/** Grouped card of rows (VOIDEX settings, Step 2.4): white card, violet icon tiles, a line of description. */
export function Group({ title, children, footer, className }: { title?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <section className={cx("mb-6", className)}>
      {title && <h3 className="mb-2 px-3 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{title}</h3>}
      <div className="overflow-hidden rounded-[22px] border border-border/70 bg-surface shadow-tile">{children}</div>
      {footer && <p className="mt-2 px-4 text-[13px] leading-snug text-text-secondary">{footer}</p>}
    </section>
  );
}

export function Row({
  label,
  value,
  icon,
  onClick,
  chevron,
  right,
  danger,
  hint,
  testId,
}: {
  label: ReactNode;
  value?: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  right?: ReactNode;
  danger?: boolean;
  hint?: ReactNode;
  testId?: string;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-testid={testId}
      className={cx(
        "flex min-h-[58px] w-full items-center gap-3 px-3.5 py-2.5 text-left [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border/70",
        onClick && "transition-colors hover:bg-surface-hover active:bg-surface-secondary",
      )}
    >
      {icon && <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-[12px]", danger ? "bg-danger-soft text-danger" : "bg-primary/10 text-primary")}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={cx("block text-[15px]", danger ? "font-medium text-danger" : "text-text")}>{label}</span>
        {hint && <span className="block text-[12.5px] leading-snug text-text-tertiary">{hint}</span>}
      </span>
      {value !== undefined && <span className="min-w-0 max-w-[55%] truncate text-right text-[15px] text-text-secondary" data-selectable>{value}</span>}
      {right}
      {chevron && <RiArrowRightSLine className="size-5 shrink-0 text-text-tertiary" />}
    </Comp>
  );
}

export function SectionTitle({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mb-5 px-1">
      <h2 className="text-[26px] font-bold tracking-tight">{children}</h2>
      {subtitle && <p className="mt-1 text-[14px] text-text-secondary">{subtitle}</p>}
    </div>
  );
}

export function Badge({ tone = "default", children }: { tone?: "default" | "success" | "primary" | "warning"; children: ReactNode }) {
  const tones = {
    default: "bg-surface-secondary text-text-secondary",
    success: "bg-success-soft text-success",
    primary: "bg-primary-soft text-primary-strong",
    warning: "bg-warning-soft text-[#8a5a00]",
  };
  return <span className={cx("inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold", tones[tone])}>{children}</span>;
}

/** The VOIDEX line at the bottom of the main pages. */
export function BrandFooter() {
  const t = useT();
  return (
    <div className="relative mt-6 flex items-center gap-3 overflow-hidden rounded-[22px] border border-white bg-[linear-gradient(110deg,#ffffff_0%,#f3f0fe_100%)] px-4 py-3.5 shadow-tile">
      <VoidexMark className="size-7" />
      <span className="text-[12px] font-semibold tracking-[0.22em] text-text">VOIDEX</span>
      <span className="h-6 w-px bg-border" />
      <span className="max-w-[160px] text-[11.5px] leading-tight text-text-tertiary">{t("settings.tagline")}</span>
      <svg className="pointer-events-none absolute -bottom-1 right-0 h-12 w-36 text-primary/15" viewBox="0 0 144 48" aria-hidden>
        <path d="M0 48 L28 26 L44 36 L70 12 L92 30 L108 20 L144 44 L144 48 Z" fill="currentColor" />
      </svg>
    </div>
  );
}

