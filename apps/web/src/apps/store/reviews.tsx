import { useEffect, useState } from "react";
import { RiDeleteBinLine, RiEditLine, RiFlagLine, RiStarFill, RiStarLine, RiThumbDownFill, RiThumbDownLine, RiThumbUpFill, RiThumbUpLine } from "@remixicon/react";
import { STORE_REPORT_REASONS, STORE_REVIEW_SORTS, STORE_REVIEW_TEXT_MAX, STORE_REVIEW_TITLE_MAX, type StoreReportReason, type StoreReviewDto, type StoreReviewSort, type StoreReviewsDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { formatDate, useLanguage, useT, type MessageKey } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Button, EmptyState, Skeleton } from "@/ui/controls";
import { ConfirmDialog, Sheet, toast } from "@/ui/overlays";
import type { StoreAppId } from "./catalog";
import { reportReview, useDeleteReview, useReviews, useSaveReview, voteReview } from "./data";
import { RatingChart, Stars, StoreIcon, useAppName } from "./parts";

const SORT_LABEL: Record<StoreReviewSort, MessageKey> = { date: "store.sort.date", helpful: "store.sort.helpful", high: "store.sort.high", low: "store.sort.low" };
const REASON_LABEL: Record<StoreReportReason, MessageKey> = { spam: "store.report.spam", abuse: "store.report.abuse", offtopic: "store.report.offtopic", other: "store.report.other" };

/** The summary: the average, how many, the distribution. */
export function RatingSummary({ data }: { data: StoreReviewsDto | undefined }) {
  const t = useT();
  const stats = data?.stats;
  return (
    <div className="flex items-center gap-5 rounded-[22px] bg-surface p-4 shadow-tile" data-testid="store-rating-summary">
      <div className="flex shrink-0 flex-col items-center">
        <span className="text-[40px] font-bold leading-none tabular-nums text-text" data-testid="store-rating-average">
          {stats && stats.total ? stats.average.toFixed(1) : "–"}
        </span>
        <span className="mt-1 text-[12px] text-text-tertiary" data-testid="store-rating-total">
          {t("store.reviewsCount", { n: stats?.total ?? 0 })}
        </span>
      </div>
      <RatingChart counts={stats?.counts ?? [0, 0, 0, 0, 0]} />
    </div>
  );
}

/**
 * One review: the author (surname and name, @voidops address from the
 * account), the stars, when (and "edited"), its title and text; likes and
 * dislikes (one vote each, a second press takes it back) and «Пожаловаться».
 * Mine: edit and delete instead.
 */
export function ReviewCard({ appId, r, onEdit }: { appId: StoreAppId; r: StoreReviewDto; onEdit: () => void }) {
  const t = useT();
  const lang = useLanguage();
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const vote = async (v: 1 | -1) => {
    if (busy) return;
    setBusy(true);
    try {
      await voteReview(appId, r.id, r.myVote === v ? 0 : v);
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="rounded-[22px] bg-surface p-4 shadow-tile" data-testid="store-review" data-mine={r.mine || undefined} data-review-id={r.id}>
      <div className="flex items-center gap-3">
        <Avatar name={r.author.name} userId={r.author.id} version={0} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-semibold text-text">{r.author.name}</span>
          <span className="block truncate text-[12px] text-text-tertiary">{r.author.address}</span>
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[12px] text-text-tertiary">
        <Stars value={r.rating} size={13} />
        <time dateTime={r.createdAt}>{formatDate(new Date(r.createdAt), lang, { day: "numeric", month: "short", year: "numeric" })}</time>
        {r.editedAt && <span data-testid="store-review-edited">· {t("store.review.edited")}</span>}
      </div>
      {r.title && <h3 className="mt-2 text-[15px] font-semibold text-text">{r.title}</h3>}
      {r.text && <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-text-secondary">{r.text}</p>}
      <div className="mt-3 flex items-center gap-1">
        {r.mine ? (
          <button type="button" onClick={onEdit} className="flex h-8 items-center gap-1.5 rounded-full bg-surface-secondary px-3 text-[13px] font-medium text-text" data-testid="store-review-edit">
            <RiEditLine className="size-4" /> {t("store.review.edit")}
          </button>
        ) : (
          <>
            <VoteButton on={r.myVote === 1} count={r.likes} up label={t("store.review.like")} onClick={() => void vote(1)} disabled={busy} />
            <VoteButton on={r.myVote === -1} count={r.dislikes} label={t("store.review.dislike")} onClick={() => void vote(-1)} disabled={busy} />
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setReporting(true)}
              disabled={r.reported}
              className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] text-text-tertiary hover:bg-surface-hover disabled:opacity-60"
              data-testid="store-review-report"
              data-reported={r.reported || undefined}
            >
              <RiFlagLine className="size-4" /> {r.reported ? t("store.report.sent") : t("store.report.action")}
            </button>
          </>
        )}
      </div>
      <ReportSheet open={reporting} appId={appId} reviewId={r.id} onClose={() => setReporting(false)} />
    </article>
  );
}

function VoteButton({ on, count, up, label, onClick, disabled }: { on: boolean; count: number; up?: boolean; label: string; onClick: () => void; disabled: boolean }) {
  const Icon = up ? (on ? RiThumbUpFill : RiThumbUpLine) : on ? RiThumbDownFill : RiThumbDownLine;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      aria-label={label}
      className={cx("flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] tabular-nums transition-colors", on ? "bg-primary/12 text-primary" : "text-text-secondary hover:bg-surface-hover")}
      data-testid={up ? "store-review-like" : "store-review-dislike"}
    >
      <Icon className="size-4" /> {count}
    </button>
  );
}

/** «Пожаловаться»: a reason and a description (both required); sent to moderation. */
function ReportSheet({ open, appId, reviewId, onClose }: { open: boolean; appId: StoreAppId; reviewId: string; onClose: () => void }) {
  const t = useT();
  const [reason, setReason] = useState<StoreReportReason | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setReason(null);
      setText("");
    }
  }, [open]);
  const send = async () => {
    if (!reason || !text.trim()) return;
    setBusy(true);
    try {
      await reportReview(appId, reviewId, reason, text.trim());
      toast({ title: t("store.report.thanks"), tone: "success" });
      onClose();
    } catch (e) {
      // The form stays open with what was typed.
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t("store.report.title")} width={440} centered testId="store-report">
      <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("store.report.reason")}>
        {STORE_REPORT_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={reason === r}
            onClick={() => setReason(r)}
            className={cx("flex h-11 items-center gap-3 rounded-[14px] px-3 text-left text-[15px]", reason === r ? "bg-primary/10 font-medium text-primary" : "bg-surface-secondary text-text")}
            data-testid="store-report-reason"
            data-reason={r}
          >
            <span className={cx("flex size-5 items-center justify-center rounded-full border-2", reason === r ? "border-primary" : "border-border")}>{reason === r && <span className="size-2.5 rounded-full bg-primary" />}</span>
            {t(REASON_LABEL[r])}
          </button>
        ))}
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-[13px] text-text-secondary">{t("store.report.describe")}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          rows={3}
          className="w-full resize-none rounded-[14px] border bg-surface px-3 py-2 text-[16px] outline-none focus:border-primary"
          data-testid="store-report-text"
        />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => void send()} disabled={!reason || !text.trim()} loading={busy} data-testid="store-report-send">
          {t("store.report.send")}
        </Button>
      </div>
    </Sheet>
  );
}

/**
 * Writing (or editing) my review: the stars (required), a title and a text
 * (optional). The author is the account (shown, not editable); there is no
 * way to sign as someone else. Mine can be deleted from here.
 */
export function ReviewSheet({ open, appId, mine, onClose }: { open: boolean; appId: StoreAppId; mine: StoreReviewDto | null; onClose: () => void }) {
  const t = useT();
  const me = useSession((s) => s.user);
  const name = useAppName()(appId);
  const save = useSaveReview(appId);
  const del = useDeleteReview(appId);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!open) return;
    setRating(mine?.rating ?? 0);
    setTitle(mine?.title ?? "");
    setText(mine?.text ?? "");
  }, [open, mine]);
  const submit = async () => {
    if (!rating) return;
    try {
      await save.mutateAsync({ rating, title: title.trim(), text: text.trim() });
      toast({ title: t(mine ? "store.review.updated" : "store.review.posted"), tone: "success" });
      onClose();
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    }
  };
  return (
    <>
      <Sheet open={open} onClose={onClose} title={t(mine ? "store.review.editTitle" : "store.review.write")} width={480} centered testId="store-review-sheet">
        <div className="flex items-center gap-3">
          <StoreIcon id={appId} size={44} />
          <span className="text-[15px] font-semibold text-text">{name}</span>
        </div>
        <div className="mt-4 flex justify-center gap-1.5" role="radiogroup" aria-label={t("store.review.rating")}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={t("store.review.starsOf", { n })}
              onClick={() => setRating(n)}
              className="p-1 text-[#ffb020] transition-transform active:scale-90"
              data-testid="store-review-star"
              data-star={n}
            >
              {n <= rating ? <RiStarFill className="size-9" /> : <RiStarLine className="size-9 text-text-tertiary/60" />}
            </button>
          ))}
        </div>
        <label className="mt-4 block">
          <span className="mb-1 block text-[13px] text-text-secondary">{t("store.review.titleLabel")}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={STORE_REVIEW_TITLE_MAX} placeholder={t("store.review.titleHint")} className="h-11 w-full rounded-[14px] border bg-surface px-3 text-[16px] outline-none focus:border-primary" data-testid="store-review-title" />
        </label>
        <label className="mt-3 block">
          <span className="mb-1 block text-[13px] text-text-secondary">{t("store.review.textLabel")}</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={STORE_REVIEW_TEXT_MAX} rows={4} placeholder={t("store.review.textHint")} className="w-full resize-none rounded-[14px] border bg-surface px-3 py-2 text-[16px] outline-none focus:border-primary" data-testid="store-review-text" />
        </label>
        {me && (
          <p className="mt-2 text-[12.5px] text-text-tertiary" data-testid="store-review-author">
            {t("store.review.as", { name: `${me.lastName} ${me.firstName}`.trim() })}
          </p>
        )}
        <div className="mt-4 flex items-center gap-2">
          {mine && (
            <Button variant="secondary" onClick={() => setConfirm(true)} data-testid="store-review-delete">
              <RiDeleteBinLine className="size-4" /> {t("store.review.delete")}
            </Button>
          )}
          <span className="flex-1" />
          <Button onClick={() => void submit()} disabled={!rating} loading={save.isPending} data-testid="store-review-send">
            {t("store.review.send")}
          </Button>
        </div>
      </Sheet>
      <ConfirmDialog
        open={confirm}
        top
        centered
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          void del.mutateAsync().then(
            () => {
              toast({ title: t("store.review.deleted") });
              onClose();
            },
            (e) => toast({ title: errorMessage(t, e), tone: "danger" }),
          );
        }}
        title={t("store.review.deleteTitle")}
        confirmLabel={t("store.review.delete")}
        danger
      />
    </>
  );
}

/** «Оценки и отзывы»: the summary, sorting, every review, write / edit mine. */
export function ReviewsPage({ appId }: { appId: StoreAppId }) {
  const t = useT();
  const [sort, setSort] = useState<StoreReviewSort>("date");
  const q = useReviews(appId, sort);
  const [writing, setWriting] = useState(false);
  const items = q.data?.items ?? [];
  return (
    <div className="flex flex-col gap-4" data-testid="store-reviews-page">
      <h1 className="text-[26px] font-bold tracking-tight">{t("store.reviews")}</h1>
      <RatingSummary data={q.data} />
      <div className="flex items-center gap-2">
        <label htmlFor="store-sort" className="text-[13px] text-text-secondary">
          {t("store.sort.label")}
        </label>
        <select id="store-sort" value={sort} onChange={(e) => setSort(e.target.value as StoreReviewSort)} className="h-9 rounded-full border bg-surface px-3 text-[14px]" data-testid="store-reviews-sort">
          {STORE_REVIEW_SORTS.map((s) => (
            <option key={s} value={s}>
              {t(SORT_LABEL[s])}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <button type="button" onClick={() => setWriting(true)} className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[14px] font-semibold text-white" data-testid="store-write-review">
          <RiEditLine className="size-4" /> {t(q.data?.mine ? "store.review.edit" : "store.review.write")}
        </button>
      </div>
      {q.isPending ? (
        <Skeleton className="h-32 rounded-[22px]" />
      ) : items.length ? (
        <div className="flex flex-col gap-3" data-testid="store-reviews">
          {items.map((r) => (
            <ReviewCard key={r.id} appId={appId} r={r} onEdit={() => setWriting(true)} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<RiStarLine className="size-7" />} title={t("store.noReviews")} hint={t("store.noReviewsHint")} />
      )}
      <ReviewSheet open={writing} appId={appId} mine={q.data?.mine ?? null} onClose={() => setWriting(false)} />
    </div>
  );
}
