import { useMemo } from "react";
import { RiCheckLine } from "@remixicon/react";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import type { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useContacts } from "@/apps/mail/data";
import { useChats, usePeople } from "@/apps/vibex/data";

export type ShareDest = "vibex" | "mail";

/** A recipient picked in the share dialog. */
export interface SharePick {
  key: string;
  name: string;
  /** Vibex: a chat (group) or a person (direct chat opened on send). */
  chatId?: string;
  userId?: string;
  avatar?: { userId?: string; version: number };
  /** Mail: the address. */
  address?: string;
}

type T = ReturnType<typeof useT>;
type SetPicked = (f: (p: SharePick[]) => SharePick[]) => void;

function ContactGrid({ items, picked, setPicked, empty, testId }: { items: SharePick[]; picked: SharePick[]; setPicked: SetPicked; empty: string; testId: string }) {
  const toggle = (p: SharePick) => setPicked((x) => (x.some((y) => y.key === p.key) ? x.filter((y) => y.key !== p.key) : [...x, p]));
  return (
    <div className="grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-5" data-testid={`${testId}-contacts`}>
      {items.map((p) => {
        const on = picked.some((x) => x.key === p.key);
        return (
          <button key={p.key} type="button" onClick={() => toggle(p)} className="pressable flex min-w-0 flex-col items-center gap-1.5" data-testid={`${testId}-contact`} aria-pressed={on} title={p.address ?? p.name}>
            <span className="relative">
              <Avatar name={p.name} userId={p.avatar?.userId} version={p.avatar?.version ?? 0} size={56} className={cx("transition", on && "ring-[3px] ring-primary ring-offset-2 ring-offset-surface")} />
              {on && (
                <span className="absolute -bottom-0.5 -right-0.5 flex size-[22px] items-center justify-center rounded-full border-2 border-surface bg-primary text-white">
                  <RiCheckLine className="size-3.5" />
                </span>
              )}
            </span>
            <span className="w-full truncate text-center text-[12px] leading-tight text-text">{p.name}</span>
          </button>
        );
      })}
      {!items.length && <div className="col-span-full py-4 text-center text-[14px] text-text-tertiary">{empty}</div>}
    </div>
  );
}

/** Vibex: the person's chats first, then people found by the search (real server search). */
export function VibexRecipients({ q, picked, setPicked, t, testId }: { q: string; picked: SharePick[]; setPicked: SetPicked; t: T; testId: string }) {
  const me = useSession((s) => s.user?.id);
  const chats = useChats();
  const people = usePeople(q.trim());
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out: SharePick[] = [];
    const seen = new Set<string>();
    for (const c of chats.data ?? []) {
      if (c.peer) {
        const p = c.peer;
        if (needle && !(p.name.toLowerCase().includes(needle) || p.handle.includes(needle) || p.address.includes(needle))) continue;
        seen.add(p.id);
        out.push({ key: `u:${p.id}`, name: p.firstName || p.name, userId: p.id, chatId: c.id, avatar: { userId: p.id, version: p.avatarVersion } });
      } else if (c.group) {
        if (needle && !c.group.title.toLowerCase().includes(needle)) continue;
        out.push({ key: `c:${c.id}`, name: c.group.title, chatId: c.id, avatar: { version: 0 } });
      }
    }
    for (const p of people.data ?? []) {
      if (seen.has(p.id) || p.id === me) continue;
      out.push({ key: `u:${p.id}`, name: p.firstName || p.name, userId: p.id, avatar: { userId: p.id, version: p.avatarVersion } });
    }
    return out.slice(0, 30);
  }, [chats.data, people.data, q, me]);
  return <ContactGrid items={items} picked={picked} setPicked={setPicked} empty={q.trim() ? t("share.noPeople") : t("vibex.people.hint")} testId={testId} />;
}

/** VoidOps Mail: address book, Vibex people, or a full address typed in. */
export function MailRecipients({ q, picked, setPicked, t, testId }: { q: string; picked: SharePick[]; setPicked: SetPicked; t: T; testId: string }) {
  const chats = useChats();
  const contacts = useContacts(q.trim());
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out: SharePick[] = [];
    const seen = new Set<string>();
    const add = (address: string, name: string | null, userId?: string, version = 0) => {
      const a = address.toLowerCase();
      if (seen.has(a)) return;
      seen.add(a);
      out.push({ key: `m:${a}`, name: name || a.split("@")[0]!, address: a, avatar: { userId, version } });
    };
    for (const c of contacts.data ?? []) add(c.address, c.name);
    for (const c of chats.data ?? []) {
      const p = c.peer;
      if (p && (!needle || p.name.toLowerCase().includes(needle) || p.address.includes(needle))) add(p.address, p.name, p.id, p.avatarVersion);
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(needle)) add(needle, null);
    return out.slice(0, 30);
  }, [contacts.data, chats.data, q]);
  return <ContactGrid items={items} picked={picked} setPicked={setPicked} empty={q.trim() ? t("share.noPeople") : t("share.mailHint")} testId={testId} />;
}
