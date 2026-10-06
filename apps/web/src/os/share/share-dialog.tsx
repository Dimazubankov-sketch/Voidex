import { useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RiArrowLeftSLine, RiCloseLine, RiSendPlaneFill } from "@remixicon/react";
import { MailGlyph, VibexGlyph } from "@/brand/brand";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { Sheet, toast } from "@/ui/overlays";
import { VoidexSearchField } from "@/ui/search-field";
import { MailRecipients, VibexRecipients, type ShareDest, type SharePick } from "./recipients";

export type { ShareDest, SharePick };

export interface ShareSubject {
  /** Stable key: a new subject starts a fresh dialog. */
  key: string;
  icon: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
}

export interface ShareSendInput {
  dest: ShareDest;
  picked: SharePick[];
  text: string;
}

/**
 * VoidexShareDialog (Step 2.7): the one share flow of Notes, Files and Media.
 * Choose the app (Vibex or VoidOps Mail), search (the real people / address
 * search), pick recipients, add a comment, send. App-specific options
 * (Notes: "Разрешить редактирование", link, Users) come in `extras`; Files
 * and Media have none. A centred dialog on phones too, above the keyboard.
 */
export function VoidexShareDialog({
  subject,
  onClose,
  onSend,
  extras,
  testId = "share",
  sentTitle,
}: {
  subject: ShareSubject | null;
  onClose: () => void;
  onSend: (input: ShareSendInput) => Promise<void>;
  extras?: ReactNode;
  testId?: string;
  sentTitle?: string;
}) {
  const last = useRef<ShareSubject | null>(null);
  if (subject) last.current = subject;
  return (
    <Sheet open={!!subject} onClose={onClose} width={520} testId={`${testId}-sheet`} centered>
      {last.current && <ShareBody key={last.current.key} subject={last.current} onClose={onClose} onSend={onSend} extras={extras} testId={testId} sentTitle={sentTitle} />}
    </Sheet>
  );
}

function ShareBody({
  subject,
  onClose,
  onSend,
  extras,
  testId,
  sentTitle,
}: {
  subject: ShareSubject;
  onClose: () => void;
  onSend: (input: ShareSendInput) => Promise<void>;
  extras?: ReactNode;
  testId: string;
  sentTitle?: string;
}) {
  const t = useT();
  const [dest, setDest] = useState<ShareDest | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<SharePick[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!dest || !picked.length || sending) return;
    setSending(true);
    try {
      await onSend({ dest, picked, text: text.trim() });
      toast({ title: sentTitle ?? t("share.sent"), body: picked.map((p) => p.name).join(", "), tone: "success" });
      onClose();
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid={testId} data-dest={dest ?? ""}>
      <div className="flex items-center gap-3">
        {subject.icon}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[16px] font-semibold text-text" data-testid={`${testId}-file`}>
            {subject.title}
          </span>
          {subject.hint && <span className="text-[13px] text-text-tertiary">{subject.hint}</span>}
        </div>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-secondary text-text-secondary">
          <RiCloseLine className="size-5" />
        </button>
      </div>

      <VoidexSearchField
        value={q}
        onChange={(v) => {
          setQ(v);
          if (!dest && v) setDest("vibex");
        }}
        placeholder={dest === "mail" ? t("share.searchMail") : t("share.search")}
        testId={`${testId}-search`}
      />

      {!dest ? (
        <div className="grid grid-cols-2 gap-3" data-testid={`${testId}-apps`}>
          {(
            [
              ["vibex", t("vibex.title"), <VibexGlyph key="v" className="size-9" />],
              ["mail", t("mail.title"), <MailGlyph key="m" className="size-9" />],
            ] as const
          ).map(([id, label, glyph]) => (
            <button
              key={id}
              type="button"
              onClick={() => setDest(id)}
              className="pressable flex flex-col items-center gap-2 rounded-[22px] border border-border bg-surface px-2 py-4 hover:bg-surface-hover"
              data-testid={`${testId}-app-${id}`}
            >
              <span className="grid size-14 place-items-center rounded-[16px] bg-surface-secondary">{glyph}</span>
              <span className="text-[14px] font-medium text-text">{label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => {
              setDest(null);
              setPicked([]);
              setQ("");
            }}
            className="flex w-fit items-center gap-1 rounded-full bg-surface-secondary py-1 pl-1.5 pr-3 text-[13.5px] font-medium text-text-secondary"
            data-testid={`${testId}-back`}
          >
            <RiArrowLeftSLine className="size-[18px]" />
            {dest === "vibex" ? t("vibex.title") : t("mail.title")}
          </button>
          {dest === "vibex" ? (
            <VibexRecipients q={q} picked={picked} setPicked={setPicked} t={t} testId={testId} />
          ) : (
            <MailRecipients q={q} picked={picked} setPicked={setPicked} t={t} testId={testId} />
          )}
        </div>
      )}

      <AnimatePresence initial={false}>
        {picked.length > 0 && (
          <motion.div className="flex items-center gap-2" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("share.comment")}
              className="h-11 min-w-0 flex-1 rounded-full border border-border bg-surface-secondary px-4 text-[16px] outline-none placeholder:text-text-tertiary focus:border-primary/40"
              onKeyDown={(e) => e.key === "Enter" && void send()}
              data-testid={`${testId}-comment`}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending}
              className="pressable flex h-11 shrink-0 items-center gap-2 rounded-full bg-primary px-4 text-[15px] font-semibold text-white shadow-glow disabled:opacity-60"
              data-testid={`${testId}-send`}
            >
              {sending ? <Spinner size={16} /> : <RiSendPlaneFill className="size-[18px]" />}
              {t("share.send")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {extras}
    </div>
  );
}
