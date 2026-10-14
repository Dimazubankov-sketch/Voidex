import { z } from "zod";
import type { AppId } from "./apps.js";

/**
 * Step 2.11: Appex Store. The catalog is the App Registry itself (every
 * registered app except the Store and Settings); reviews are real, one per
 * person and app, with likes / dislikes and reports. Names and addresses come
 * from the account on the server, never from the form.
 */

export const STORE_REPORT_REASONS = ["spam", "abuse", "offtopic", "other"] as const;
export type StoreReportReason = (typeof STORE_REPORT_REASONS)[number];
export const STORE_REVIEW_SORTS = ["date", "helpful", "high", "low"] as const;
export type StoreReviewSort = (typeof STORE_REVIEW_SORTS)[number];

export const STORE_REVIEW_TITLE_MAX = 120;
export const STORE_REVIEW_TEXT_MAX = 2000;

export interface StoreReviewDto {
  id: string;
  appId: AppId;
  author: { id: string; name: string; address: string };
  rating: number;
  title: string;
  text: string;
  createdAt: string;
  editedAt: string | null;
  likes: number;
  dislikes: number;
  /** My vote on it: 1, -1 or 0. */
  myVote: number;
  mine: boolean;
  /** I already reported it. */
  reported: boolean;
}

export interface StoreReviewStatsDto {
  /** Reviews with 1, 2, 3, 4, 5 stars. */
  counts: [number, number, number, number, number];
  total: number;
  /** Average rating (0 without reviews). */
  average: number;
}

export interface StoreReviewsDto {
  items: StoreReviewDto[];
  stats: StoreReviewStatsDto;
  mine: StoreReviewDto | null;
}

export const StoreReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(STORE_REVIEW_TITLE_MAX).default(""),
  text: z.string().trim().max(STORE_REVIEW_TEXT_MAX).default(""),
});
export const StoreVoteSchema = z.object({ vote: z.union([z.literal(1), z.literal(-1), z.literal(0)]) });
export const StoreReportSchema = z.object({ reason: z.enum(STORE_REPORT_REASONS), description: z.string().trim().min(1).max(1000) });
/** Step 2.12: one app's auto-update choice (null: the Store's global choice applies). */
export const StoreAutoUpdateSchema = z.object({ autoUpdate: z.boolean().nullable() });
