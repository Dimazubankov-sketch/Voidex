import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RiBookmarkFill, RiBookmarkLine, RiCheckLine, RiLinkM, RiRepeat2Line, RiSendPlaneFill } from "@remixicon/react";
import type { VibexPersonDto, VibexPostDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { queryClient } from "@/lib/query";
import { Spinner } from "@/ui/controls";
import { Sheet, toast } from "@/ui/overlays";
import { postLink, sharePost, useChats, usePeople, usePostAction, useRepost, vk } from "./data";
import { useVibex } from "./store";
import { VoidexSearchField } from "@/ui/search-field";

/**
 * Share a post, VK-style: pick people (your chats first, or search) and send it
 * in a message, or put it on your page, copy the link, bookmark it.
 */
export function ShareSheet() {
  const t = useT();
  const post = useVibex((s) => s.sharing);
  const close = useVibex((s) => s.share);
  // Keep the content while the sheet animates out.
  const last = useRef<VibexPostDto | null>(null);
  if (post) last.current = post;
  return (
    <Sheet open={!!post} onClose={() => close(null)} title={t("vibex.share.title")} width={520} testId="share-sheet">
      {last.current && <ShareBody key={last.current.id} wrapper={last.current} />}
    </Sheet>
  );
}

function ShareBody({ wrapper }: { wrapper: VibexPostDto }) {
  const t = useT();
  const close = useVibex((s) => s.share);
  // Always share the original (a repost card shares what it reposted).
  const post = wrapper.kind === "repost" && wrapper.repostOf ? wrapper.repostOf : wrapper;
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<VibexPersonDto[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const chats = useChats();
  const people = usePeople(q.trim());
  const repost = useRepost();
  const action = usePostAction();
  const [bookmarked, setBookmarked] = useState(post.bookmarked);
  const [reposted, setReposted] = useState(post.reposted);

  /** Contacts: people from my chats first, then everyone else the search finds. */
  const contacts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const fromChats = (chats.data ?? [])
      .flatMap((c) => (c.peer ? [c.peer] : []))
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.handle.includes(needle) || p.address.includes(needle));
    const seen = new Set(fromChats.map((p) => p.id));
    const others = (people.data ?? []).filter((p) => !seen.has(p.id));
    return [...fromChats, ...others].slice(0, 24);
  }, [chats.data, people.data, q]);

  const toggle = (p: VibexPersonDto) => setPicked((x) => (x.some((y) => y.id === p.id) ? x.filter((y) => y.id !== p.id) : [...x, p]));

  const send = async () => {
    setSending(true);
    try {
      await sharePost(post.id, picked.map((p) => p.id), text);
      void queryClient.invalidateQueries({ queryKey: vk.chats });
      toast({ title: t("vibex.share.sent"), body: picked.map((p) => p.name).join(", "), tone: "success" });
      close(null);
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setSending(false);
    }
  };

  const actions = [
    {
      id: "repost",
      label: reposted ? t("vibex.post.undoRepost") : t("vibex.share.myPage"),
      icon: <RiRepeat2Line className="size-6" />,
      active: reposted,
      run: async () => {
        await repost.mutateAsync({ id: post.id, on: !reposted });
        setReposted(!reposted);
        toast({ title: reposted ? t("vibex.share.repostRemoved") : t("vibex.share.reposted"), tone: "success" });
        if (!reposted) close(null);
      },
    },
    {
      id: "copy",
      label: t("vibex.share.copyLink"),
      icon: <RiLinkM className="size-6" />,
      active: false,
      run: async () => {
        await navigator.clipboard?.writeText(postLink(post.id)).catch(() => undefined);
        toast({ title: t("vibex.share.copied"), tone: "success" });
      },
    },
    {
      id: "bookmark",
      label: bookmarked ? t("vibex.share.bookmarked") : t("vibex.share.bookmark"),
      icon: bookmarked ? <RiBookmarkFill className="size-6" /> : <RiBookmarkLine className="size-6" />,
      active: bookmarked,
      run: async () => {
        await action.mutateAsync({ post, action: bookmarked ? "unbookmark" : "bookmark" });
        setBookmarked(!bookmarked);
        if (!bookmarked) toast({ title: t("vibex.share.bookmarkAdded"), tone: "success" });
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <VoidexSearchField
        value={q}
        onChange={setQ}
        placeholder={t("vibex.share.search")}
        testId="share-search"
        trailing={people.isFetching ? <Spinner size={14} /> : undefined}
      />

      <div className="grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-5" data-testid="share-contacts">
        {contacts.map((p) => {
          const on = picked.some((x) => x.id === p.id);
          return (
            <button key={p.id} type="button" onClick={() => toggle(p)} className="pressable flex min-w-0 flex-col items-center gap-1.5" data-testid="share-contact" aria-pressed={on}>
              <span className="relative">
                <Avatar name={p.name} userId={p.id} version={p.avatarVersion} size={56} className={cx("transition", on && "ring-[3px] ring-primary ring-offset-2 ring-offset-surface")} />
                <AnimatePresence>
                  {on && (
                    <motion.span
                      className="absolute -bottom-0.5 -right-0.5 flex size-[22px] items-center justify-center rounded-full border-2 border-surface bg-primary text-white"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                    >
                      <RiCheckLine className="size-3.5" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              <span className="w-full truncate text-center text-[12px] leading-tight text-text">{p.firstName || p.name}</span>
            </button>
          );
        })}
        {!contacts.length && !people.isPending && (
          <div className="col-span-full py-4 text-center text-[14px] text-text-tertiary">{q.trim() ? t("vibex.share.noPeople") : t("vibex.people.hint")}</div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {picked.length > 0 && (
          <motion.div className="flex items-center gap-2" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("vibex.share.comment")}
              className="h-11 min-w-0 flex-1 rounded-2xl bg-surface-secondary px-3.5 text-[15px] outline-none placeholder:text-text-tertiary"
              onKeyDown={(e) => e.key === "Enter" && !sending && void send()}
              data-testid="share-comment"
            />
            <button
              type="button"
              onClick={send}
              disabled={sending}
              className="pressable flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-primary px-4 text-[15px] font-semibold text-white shadow-glow disabled:opacity-60"
              data-testid="share-send"
            >
              {sending ? <Spinner size={16} /> : <RiSendPlaneFill className="size-[18px]" />}
              {picked.length > 1 ? t("vibex.share.sendTo", { count: picked.length }) : t("vibex.share.send")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-3 gap-2 border-t pt-4">
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => void a.run().catch((e) => toast({ title: errorMessage(t, e), tone: "danger" }))}
            className="pressable flex flex-col items-center gap-2 rounded-2xl px-1 py-2 hover:bg-surface-hover"
            data-testid={`share-${a.id}`}
          >
            <span className={cx("flex size-14 items-center justify-center rounded-full", a.active ? "bg-primary-soft text-primary" : "bg-surface-secondary text-text-secondary")}>{a.icon}</span>
            <span className="text-center text-[12px] leading-tight text-text">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
