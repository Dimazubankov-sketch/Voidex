import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { RiArrowDownSLine, RiArrowUpSLine, RiAttachment2, RiCloseLine, RiDeleteBinLine, RiLink, RiSendPlane2Fill } from "@remixicon/react";
import { MAIL_ATTACHMENTS_MAX, MAIL_SUBJECT_MAX, type MailAttachmentDto } from "@voidex/shared";
import { ApiError } from "@/lib/api";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { qk, queryClient } from "@/lib/query";
import { Button, IconButton, Notice, Spinner, TextField } from "@/ui/controls";
import { Sheet, toast } from "@/ui/overlays";
import { AttachSourceSheet } from "@/os/share/attach-source";
import { ATTACHMENT_ACCEPT, ComposerAttachments, attachmentsApi, checkFile, type PendingUpload } from "./attachments";
import { draftsApi } from "./data";
import { RecipientField } from "./recipients";
import { useMail, type ComposerState } from "./store";

const EASE = [0.22, 1, 0.36, 1] as const;
const AUTOSAVE_MS = 900;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * Message composer with draft autosave. The draft is created on the first
 * change and then saved (debounced) on every edit, so closing the window,
 * switching devices or losing the connection never loses what was typed.
 */
export function Composer() {
  const composer = useMail((s) => s.composer);
  if (!composer) return null;
  return <ComposerInner key={composer.key} initial={composer} />;
}

function ComposerInner({ initial }: { initial: ComposerState }) {
  const t = useT();
  const ff = useFormFactor();
  const close = useMail((s) => s.closeComposer);
  const openThread = useMail((s) => s.openThread);
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [bcc, setBcc] = useState(initial.bcc);
  const [showCc, setShowCc] = useState(initial.cc.length > 0 || initial.bcc.length > 0);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [collapsed, setCollapsed] = useState(false);
  const [save, setSave] = useState<SaveState>(initial.draftId ? "saved" : "idle");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string[]>([]);
  const draftId = useRef<string | null>(initial.draftId);
  const creating = useRef<Promise<string> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ to, cc, bcc, subject, body });
  latest.current = { to, cc, bcc, subject, body };
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Step 2.8: a link goes into the text as it is (plain text, no preview).
  const [linking, setLinking] = useState(false);
  const caret = useRef<number | null>(null);
  const insertLink = (url: string) => {
    const el = bodyRef.current;
    const at = caret.current ?? body.length;
    const before = body.slice(0, at);
    const after = body.slice(at);
    const piece = `${before && !/\s$/.test(before) ? " " : ""}${url}${after && !/^\s/.test(after) ? " " : ""}`;
    setBody(before + piece + after);
    const pos = before.length + piece.length;
    caret.current = pos;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const [chooser, setChooser] = useState(false);
  const [attachments, setAttachments] = useState<MailAttachmentDto[]>(initial.attachments ?? []);
  const [pending, setPending] = useState<PendingUpload[]>([]);

  const ensureDraft = useCallback(async () => {
    if (draftId.current) return draftId.current;
    creating.current ??= draftsApi
      .create({ ...latest.current, replyToMessageId: initial.replyToMessageId, forwardOfMessageId: initial.forwardOfMessageId })
      .then((d) => {
        draftId.current = d.id;
        // A forward starts with the original's files (copied by the server).
        if (d.attachments.length) setAttachments((cur) => [...d.attachments.filter((a) => !cur.some((c) => c.id === a.id)), ...cur]);
        return d.id;
      });
    return creating.current;
  }, [initial.replyToMessageId, initial.forwardOfMessageId]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    setSave("saving");
    try {
      const id = await ensureDraft();
      await draftsApi.update(id, latest.current);
      setSave("saved");
      void queryClient.invalidateQueries({ queryKey: ["mail", "list", "drafts"] });
      return id;
    } catch (err) {
      setSave("error");
      throw err;
    }
  }, [ensureDraft]);

  // Autosave on every change (debounced).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      // Reply/forward drafts are created right away so they link to the thread.
      if (!initial.draftId && (initial.replyToMessageId || initial.forwardOfMessageId)) void flush().catch(() => undefined);
      return;
    }
    setSave("dirty");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush().catch(() => undefined), AUTOSAVE_MS);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, cc, bcc, subject, body]);

  useEffect(() => {
    if (initial.replyToMessageId || initial.forwardOfMessageId) {
      bodyRef.current?.focus();
      bodyRef.current?.setSelectionRange(0, 0);
    }
  }, [initial.replyToMessageId, initial.forwardOfMessageId]);

  // Opening an existing draft: its files come from the server.
  useEffect(() => {
    if (!initial.draftId || initial.attachments) return;
    void draftsApi
      .get(initial.draftId)
      .then((d) => setAttachments(d.attachments))
      .catch(() => undefined);
  }, [initial.draftId, initial.attachments]);

  async function addFiles(files: FileList | File[] | null) {
    if (!files?.length) return;
    const list = [...files];
    for (const f of list) {
      const problem = checkFile(f);
      if (problem) {
        toast({ title: t(`error.${problem}`), body: f.name, tone: "danger" });
        continue;
      }
      const key = `${Date.now()}-${Math.random()}`;
      setPending((p) => [...p, { key, filename: f.name, size: f.size }]);
      try {
        const id = await ensureDraft();
        const a = await attachmentsApi.upload(id, f);
        setAttachments((cur) => [...cur, a]);
        setSave("saved");
        void queryClient.invalidateQueries({ queryKey: ["mail", "list", "drafts"] });
      } catch (err) {
        toast({ title: errorMessage(t, err), body: f.name, tone: "danger" });
      } finally {
        setPending((p) => p.filter((x) => x.key !== key));
      }
    }
  }

  async function removeAttachment(a: MailAttachmentDto) {
    const id = draftId.current;
    setAttachments((cur) => cur.filter((x) => x.id !== a.id));
    if (!id) return;
    try {
      await attachmentsApi.remove(id, a.id);
    } catch (err) {
      setAttachments((cur) => [...cur, a]);
      toast({ title: errorMessage(t, err), tone: "danger" });
    }
  }

  async function send() {
    setError(null);
    setInvalid([]);
    setSending(true);
    try {
      const id = await flush();
      const r = await draftsApi.send(id);
      toast({ title: t("mail.sent.toast"), tone: "success" });
      void queryClient.invalidateQueries({ queryKey: qk.mail });
      close();
      if (initial.replyToMessageId) openThread(r.threadId);
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details.addresses)) setInvalid(err.details.addresses as string[]);
      setError(errorMessage(t, err));
    } finally {
      setSending(false);
    }
  }

  async function discard() {
    window.clearTimeout(timer.current);
    const id = draftId.current ?? (creating.current ? await creating.current.catch(() => null) : null);
    close();
    if (id) {
      await draftsApi.remove(id).catch(() => undefined);
      toast({ title: t("mail.draftDeleted") });
      void queryClient.invalidateQueries({ queryKey: qk.mail });
    }
  }

  function minimizeOrClose() {
    // Closing keeps the draft (already autosaved) — like every mail app.
    if (save === "dirty") void flush().catch(() => undefined);
    close();
  }

  const hasRecipients = to.length + cc.length + bcc.length > 0;
  const uploading = pending.length > 0;
  const status =
    save === "saving" ? (
      <span className="flex items-center gap-1.5">
        <Spinner size={12} /> {t("mail.draftSaving")}
      </span>
    ) : save === "saved" ? (
      t("mail.draftSaved")
    ) : save === "error" ? (
      <span className="text-danger">{t("error.network")}</span>
    ) : null;

  const title = subject.trim() || t("mail.compose");
  const mobile = ff === "mobile";

  return (
    <motion.div
      className={cx(
        "z-40 flex flex-col overflow-hidden bg-surface",
        mobile ? "absolute inset-0" : "absolute bottom-0 right-6 w-[min(600px,calc(100%-48px))] rounded-t-[22px] border border-b-0 shadow-window",
      )}
      style={mobile ? undefined : { height: collapsed ? 52 : "min(640px, calc(100% - 24px))" }}
      initial={mobile ? { y: "100%" } : { y: 40, opacity: 0 }}
      animate={mobile ? { y: 0 } : { y: 0, opacity: 1 }}
      exit={mobile ? { y: "100%" } : { y: 40, opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      data-testid="composer"
    >
      <div className={cx("flex h-[52px] shrink-0 items-center gap-2 px-3", !mobile && "cursor-default bg-surface-secondary/70")} onDoubleClick={() => !mobile && setCollapsed((c) => !c)}>
        {mobile ? (
          <IconButton label={t("common.close")} onClick={minimizeOrClose}>
            <RiCloseLine className="size-6" />
          </IconButton>
        ) : null}
        <div className="min-w-0 flex-1 truncate pl-1 text-[15px] font-semibold">{title}</div>
        <div className="text-[12px] text-text-tertiary" data-testid="draft-status">
          {status}
        </div>
        {!mobile && (
          <>
            <IconButton label={collapsed ? t("os.restore") : t("os.minimize")} size="sm" onClick={() => setCollapsed((c) => !c)}>
              {collapsed ? <RiArrowUpSLine className="size-5" /> : <RiArrowDownSLine className="size-5" />}
            </IconButton>
            <IconButton label={t("common.close")} size="sm" onClick={minimizeOrClose}>
              <RiCloseLine className="size-5" />
            </IconButton>
          </>
        )}
        {mobile && (
          <Button size="sm" onClick={send} loading={sending} disabled={!hasRecipients || uploading} icon={<RiSendPlane2Fill className="size-4" />} data-testid="composer-send">
            {t("mail.send")}
          </Button>
        )}
      </div>
      {!collapsed && (
        <>
          <div className="px-4">
            <RecipientField
              label={t("mail.to")}
              value={to}
              onChange={setTo}
              invalid={invalid}
              autoFocus={!initial.replyToMessageId && !to.length}
              testId="composer-to"
              trailing={
                !showCc && (
                  <button type="button" className="whitespace-nowrap rounded-lg px-1.5 text-[13px] font-medium text-primary hover:bg-primary-soft" onClick={() => setShowCc(true)} data-testid="composer-show-cc">
                    {t("mail.addCcBcc")}
                  </button>
                )
              }
            />
            {showCc && (
              <>
                <RecipientField label={t("mail.cc")} value={cc} onChange={setCc} invalid={invalid} testId="composer-cc" />
                <RecipientField label={t("mail.bcc")} value={bcc} onChange={setBcc} invalid={invalid} testId="composer-bcc" />
              </>
            )}
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value.slice(0, MAIL_SUBJECT_MAX))}
              placeholder={t("mail.subject")}
              className="h-12 w-full border-b bg-transparent text-[15px] font-medium outline-none placeholder:font-normal placeholder:text-text-tertiary"
              data-testid="composer-subject"
            />
          </div>
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onSelect={(e) => (caret.current = e.currentTarget.selectionStart)}
            placeholder={t("mail.bodyPlaceholder")}
            className="scroll-area min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-[15px] leading-relaxed outline-none placeholder:text-text-tertiary"
            data-testid="composer-body"
          />
          <ComposerAttachments items={attachments} pending={pending} onRemove={(a) => void removeAttachment(a)} />
          {error && (
            <div className="px-4 pb-2">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}
          <div className="flex shrink-0 items-center gap-2 border-t px-4 py-3">
            {!mobile && (
              <Button onClick={send} loading={sending} disabled={!hasRecipients || uploading} icon={<RiSendPlane2Fill className="size-4" />} data-testid="composer-send">
                {sending ? t("mail.sending") : t("mail.send")}
              </Button>
            )}
            <IconButton label={t("mail.attach")} onClick={() => setChooser(true)} data-testid="composer-attach">
              <RiAttachment2 className="size-5" />
            </IconButton>
            <IconButton label={t("mail.link.insert")} onClick={() => setLinking(true)} data-testid="composer-link">
              <RiLink className="size-5" />
            </IconButton>
            <LinkSheet open={linking} onClose={() => setLinking(false)} onInsert={insertLink} />
            <AttachSourceSheet
              open={chooser}
              onClose={() => setChooser(false)}
              onDevice={() => fileInput.current?.click()}
              onPick={(picked) => void addFiles(picked)}
              max={Math.max(0, MAIL_ATTACHMENTS_MAX - attachments.length - pending.length)}
            />
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
              data-testid="composer-file-input"
            />
            <div className="flex-1" />
            <IconButton label={t("mail.discard")} onClick={discard} data-testid="composer-discard">
              <RiDeleteBinLine className="size-5" />
            </IconButton>
          </div>
        </>
      )}
    </motion.div>
  );
}

/** A web address with a scheme; "voidex.su/x" becomes "https://voidex.su/x". */
export function normalizeLink(raw: string): string | null {
  const v = raw.trim();
  if (!v || /\s/.test(v)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return withScheme;
  } catch {
    return null;
  }
}

/** "Insert link": one field; the address goes into the letter as plain text. */
function LinkSheet({ open, onClose, onInsert }: { open: boolean; onClose: () => void; onInsert: (url: string) => void }) {
  const t = useT();
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    if (open) {
      setValue("");
      setError(false);
    }
  }, [open]);
  const submit = () => {
    const url = normalizeLink(value);
    if (!url) return setError(true);
    onInsert(url);
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("mail.link.insert")}
      width={420}
      centered
      testId="composer-link-sheet"
      footer={
        <Button onClick={submit} disabled={!value.trim()} className="w-full" data-testid="composer-link-insert">
          {t("mail.link.add")}
        </Button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-2"
      >
        <TextField
          label={t("mail.link.address")}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          error={error ? t("mail.link.invalid") : undefined}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          data-testid="composer-link-input"
        />
        <p className="px-1 text-[13px] leading-snug text-text-tertiary">{t("mail.link.hint")}</p>
      </form>
    </Sheet>
  );
}
