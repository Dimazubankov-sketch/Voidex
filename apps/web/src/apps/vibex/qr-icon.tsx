import { cx } from "@/lib/cx";

/**
 * Update 4 · E1: the one QR icon of Vibex (chat info, my profile, anywhere a QR code opens): three
 * rounded finder squares and a few modules, drawn with the same stroke as the action icons. Only the
 * icon; the QR code itself (its generation and content) is unchanged.
 */
export function QrIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cx("shrink-0", className)} aria-hidden data-testid="qr-icon">
      <rect x="3.2" y="3.2" width="7.1" height="7.1" rx="2.1" stroke="currentColor" strokeWidth="1.9" />
      <rect x="13.7" y="3.2" width="7.1" height="7.1" rx="2.1" stroke="currentColor" strokeWidth="1.9" />
      <rect x="3.2" y="13.7" width="7.1" height="7.1" rx="2.1" stroke="currentColor" strokeWidth="1.9" />
      <rect x="13.4" y="13.4" width="2.8" height="2.8" rx="0.9" fill="currentColor" />
      <rect x="18.2" y="13.4" width="2.8" height="2.8" rx="0.9" fill="currentColor" />
      <rect x="15.8" y="15.8" width="2.8" height="2.8" rx="0.9" fill="currentColor" />
      <rect x="13.4" y="18.2" width="2.8" height="2.8" rx="0.9" fill="currentColor" />
      <rect x="18.2" y="18.2" width="2.8" height="2.8" rx="0.9" fill="currentColor" />
    </svg>
  );
}
