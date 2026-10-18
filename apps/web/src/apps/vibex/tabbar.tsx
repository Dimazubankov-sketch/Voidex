import type { ComponentType } from "react";
import { cx } from "@/lib/cx";
import { useT, type MessageKey } from "@/lib/i18n";
import { GlassTabBar } from "@/ui/glass-tab-bar";

export interface TabItem<K extends string> {
  key: K;
  label: MessageKey;
  line: ComponentType<{ className?: string }>;
  fill: ComponentType<{ className?: string }>;
  badge?: number;
  badgeTestId?: string;
}

/**
 * Step 2.13: the Vibex phone tab bar (the reference video): one capsule under
 * the active tab that glides from tab to tab; only the active icon turns
 * filled and violet. Step 2.15: it is the system GlassTabBar (the one glass
 * material) and can be swiped: the capsule follows the finger along the bar.
 */
export function VibexTabBar<K extends string>({ items, active, onSelect }: { items: TabItem<K>[]; active: K; onSelect: (key: K) => void }) {
  const t = useT();
  return (
    <GlassTabBar
      ariaLabel="Vibex"
      testId="vibex-tabbar"
      wrapTestId="vibex-tabbar-wrap"
      active={active}
      onSelect={onSelect}
      items={items.map((item) => ({
        key: item.key,
        label: t(item.label),
        badge: item.badge,
        badgeTestId: item.badgeTestId,
        testId: `vibex-tab-${item.key}`,
        icon: (on: boolean) => {
          const Icon = on ? item.fill : item.line;
          return <Icon className={cx("size-[25px]")} />;
        },
      }))}
    />
  );
}
