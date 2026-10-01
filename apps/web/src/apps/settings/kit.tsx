import type { ReactNode } from "react";
import { RiArrowRightSLine } from "@remixicon/react";
import { cx } from "@/lib/cx";

/** Grouped list container (iOS/macOS settings style): white rows on a soft inset. */
export function Group({ title, children, footer, className }: { title?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <section className={cx("mb-6", className)}>
      {title && <h3 className="mb-2 px-4 text-[13px] font-medium uppercase tracking-wide text-text-tertiary">{title}</h3>}
      <div className="overflow-hidden rounded-[20px] border border-border bg-surface">{children}</div>
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
        "flex min-h-[54px] w-full items-center gap-3 px-4 py-2.5 text-left [&:not(:last-child)]:border-b",
        onClick && "transition-colors hover:bg-surface-hover active:bg-surface-secondary",
      )}
    >
      {icon && <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-[10px]", danger ? "bg-danger-soft text-danger" : "bg-surface-secondary text-text-secondary")}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={cx("block text-[15px]", danger ? "font-medium text-danger" : "text-text")}>{label}</span>
        {hint && <span className="block text-[13px] leading-snug text-text-secondary">{hint}</span>}
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
