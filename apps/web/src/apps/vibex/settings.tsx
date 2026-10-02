import type { ReactNode } from "react";
import { RiChat3Line, RiImageLine, RiLockLine, RiNotification3Line, RiUserForbidLine } from "@remixicon/react";
import type { VibexAudience, VibexSettings } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { useT, type MessageKey } from "@/lib/i18n";
import { Skeleton, Switch } from "@/ui/controls";
import { useProfile, useUpdateSettings, useVibexMe } from "./data";

/**
 * Vibex Settings (Step 2.3) — Vibex's own screen, not VOIDEX Settings. Every
 * switch is a real, server-side setting that the Vibex service enforces:
 * who can write to me, who sees my profile and posts, read receipts, blocked
 * people; which Vibex notifications reach the Notification Center; media.
 */
export function VibexSettingsScreen() {
  const t = useT();
  const me = useVibexMe();
  const update = useUpdateSettings();
  const s = me.data?.settings;
  if (!s) return <Skeleton className="h-80 rounded-2xl" />;
  const privacy = (patch: Partial<VibexSettings["privacy"]>) => update.mutate({ privacy: patch });
  const notify = (patch: Partial<VibexSettings["notifications"]>) => update.mutate({ notifications: patch });
  const media = (patch: Partial<VibexSettings["media"]>) => update.mutate({ media: patch });

  return (
    <div className="flex flex-col gap-4" data-testid="vibex-settings">
      <Group icon={<RiLockLine />} title={t("vibex.settings.privacy")}>
        <Choice<VibexAudience>
          label={t("vibex.settings.whoMessages")}
          value={s.privacy.messages}
          options={[
            ["everyone", "vibex.settings.everyone"],
            ["followers", "vibex.settings.followers"],
            ["nobody", "vibex.settings.nobody"],
          ]}
          onChange={(messages) => privacy({ messages })}
          testId="vs-messages"
        />
        <Choice<"everyone" | "followers">
          label={t("vibex.settings.whoProfile")}
          value={s.privacy.profile}
          options={[
            ["everyone", "vibex.settings.everyone"],
            ["followers", "vibex.settings.followers"],
          ]}
          onChange={(profile) => privacy({ profile })}
          testId="vs-profile"
        />
        <Choice<"everyone" | "followers">
          label={t("vibex.settings.whoPosts")}
          value={s.privacy.posts}
          options={[
            ["everyone", "vibex.settings.everyone"],
            ["followers", "vibex.settings.followers"],
          ]}
          onChange={(posts) => privacy({ posts })}
          testId="vs-posts"
        />
        <Toggle label={t("vibex.settings.readReceipts")} hint={t("vibex.settings.readReceiptsHint")} checked={s.privacy.readReceipts} onChange={(readReceipts) => privacy({ readReceipts })} testId="vs-receipts" />
        <Blocked ids={s.privacy.blocked} onUnblock={(id) => privacy({ blocked: s.privacy.blocked.filter((x) => x !== id) })} />
      </Group>

      <Group icon={<RiNotification3Line />} title={t("vibex.settings.notifications")}>
        <Toggle label={t("vibex.settings.nMessages")} checked={s.notifications.messages} onChange={(messages) => notify({ messages })} testId="vs-n-messages" />
        <Toggle label={t("vibex.settings.nComments")} checked={s.notifications.comments} onChange={(comments) => notify({ comments })} testId="vs-n-comments" />
        <Toggle label={t("vibex.settings.nLikes")} checked={s.notifications.likes} onChange={(likes) => notify({ likes })} testId="vs-n-likes" />
        <Toggle label={t("vibex.settings.nFollows")} checked={s.notifications.follows} onChange={(follows) => notify({ follows })} testId="vs-n-follows" />
      </Group>

      <Group icon={<RiImageLine />} title={t("vibex.settings.media")}>
        <Toggle label={t("vibex.settings.autoplay")} checked={s.media.autoplay} onChange={(autoplay) => media({ autoplay })} testId="vs-autoplay" />
        <Choice<"auto" | "high" | "saver">
          label={t("vibex.settings.quality")}
          value={s.media.quality}
          options={[
            ["auto", "vibex.settings.qualityAuto"],
            ["high", "vibex.settings.qualityHigh"],
            ["saver", "vibex.settings.qualitySaver"],
          ]}
          onChange={(quality) => media({ quality })}
          testId="vs-quality"
        />
      </Group>
    </div>
  );
}

function Group({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-tile">
      <h2 className="flex items-center gap-2 px-4 pb-1 pt-3.5 text-[13px] font-semibold uppercase tracking-wide text-text-tertiary [&_svg]:size-4">
        {icon}
        {title}
      </h2>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function Toggle({ label, hint, checked, onChange, testId }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3" data-testid={testId} data-checked={checked || undefined}>
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] text-text">{label}</span>
        {hint && <span className="block text-[12.5px] text-text-tertiary">{hint}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function Choice<V extends string>({ label, value, options, onChange, testId }: { label: string; value: V; options: [V, MessageKey][]; onChange: (v: V) => void; testId: string }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center" data-testid={testId}>
      <span className="min-w-0 flex-1 text-[14.5px] text-text">{label}</span>
      <div className="flex rounded-xl bg-surface-secondary p-0.5" role="radiogroup" aria-label={label}>
        {options.map(([v, key]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cx("h-8 flex-1 whitespace-nowrap rounded-[10px] px-3 text-[13px] font-medium transition", value === v ? "bg-surface text-text shadow-sm" : "text-text-secondary hover:text-text")}
            data-testid={`${testId}-${v}`}
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}

function Blocked({ ids, onUnblock }: { ids: string[]; onUnblock: (id: string) => void }) {
  const t = useT();
  return (
    <div className="px-4 py-3" data-testid="vs-blocked">
      <div className="flex items-center gap-2 text-[14.5px] text-text">
        <RiUserForbidLine className="size-[18px] text-text-secondary" />
        <span className="flex-1">{t("vibex.settings.blocked")}</span>
        <span className="text-[13px] text-text-tertiary">{ids.length}</span>
      </div>
      {ids.length ? (
        <div className="mt-2 flex flex-col gap-1">
          {ids.map((id) => (
            <BlockedRow key={id} id={id} onUnblock={() => onUnblock(id)} />
          ))}
        </div>
      ) : (
        <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-text-tertiary">
          <RiChat3Line className="size-3.5" /> {t("vibex.settings.blockedHint")}
        </p>
      )}
    </div>
  );
}

function BlockedRow({ id, onUnblock }: { id: string; onUnblock: () => void }) {
  const t = useT();
  const p = useProfile(id);
  const person = p.data?.person;
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-1 py-1.5">
      {person ? <Avatar name={person.name} userId={person.id} version={person.avatarVersion} size={30} /> : <span className="size-[30px] rounded-full skeleton" />}
      <span className="min-w-0 flex-1 truncate text-[14px]">{person?.name ?? ""}</span>
      <button type="button" onClick={onUnblock} className="rounded-full px-3 py-1 text-[13px] font-medium text-primary hover:bg-primary/10" data-testid="vs-unblock">
        {t("vibex.settings.unblock")}
      </button>
    </div>
  );
}
