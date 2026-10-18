import { z } from "zod";

/**
 * VOIDEX Notification Center — one model for every app.
 *
 * A notification belongs to one account and comes from an app (or the
 * system). Each source registers its notification types here; the client
 * registers how to draw them and what a tap opens. Adding a source = an entry
 * in NOTIFICATION_SOURCES + a renderer in the web client.
 *
 *   title   who / what it is about (a sender name, "VOIDEX")
 *   body    preview text (a subject, a message snippet) — may be hidden by the
 *           user's "show preview" preference
 *   target  what a tap opens, e.g. { threadId } for Mail, { chatId } /
 *           { postId } / { userId } for Vibex
 */
export const NOTIFICATION_SOURCES = {
  mail: ["mail.new"],
  vibex: ["vibex.message", "vibex.group", "vibex.comment", "vibex.reply", "vibex.like", "vibex.follow"],
  system: ["system.update"],
  /** Step 2.12: Appex Store: an update is available (target.kind "available") or was installed by itself ("updated"). */
  store: ["store.update"],
  /**
   * Step 2.14: Clock: an alarm or a timer rang on one of the person's devices
   * (target: kind "alarm" | "timer", id, device). Posted by that device itself:
   * alarms and timers live on the device, the ring becomes an entry of the
   * Notification Center like any other.
   */
  clock: ["clock.alarm", "clock.timer"],
} as const;

export type NotificationApp = keyof typeof NOTIFICATION_SOURCES;
export type NotificationType = (typeof NOTIFICATION_SOURCES)[NotificationApp][number];
export const NOTIFICATION_APPS = Object.keys(NOTIFICATION_SOURCES) as NotificationApp[];

export function isNotificationType(app: string, type: string): type is NotificationType {
  return app in NOTIFICATION_SOURCES && (NOTIFICATION_SOURCES[app as NotificationApp] as readonly string[]).includes(type);
}

/** Kept per account; older ones drop off. */
export const NOTIFICATIONS_KEEP = 200;
export const NOTIFICATIONS_PAGE = 50;

export interface NotificationActorDto {
  id: string;
  name: string;
  avatarVersion: number;
}

export interface NotificationDto {
  id: string;
  app: NotificationApp;
  type: NotificationType;
  title: string;
  body: string;
  actor: NotificationActorDto | null;
  target: Record<string, string>;
  read: boolean;
  createdAt: string;
}

export interface NotificationListDto {
  items: NotificationDto[];
  unread: number;
  next: string | null;
}

export const NotificationListQuerySchema = z.object({
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(NOTIFICATIONS_PAGE),
});

/** System "VOIDEX update" notification (created by operators, never by users). */
export const SystemNotificationSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(500).default(""),
  /** Optional version label shown with the update. */
  version: z.string().trim().max(40).optional(),
});

/** Step 2.14: what a device posts when one of its alarms or timers rings. */
export const ClockNotificationSchema = z.object({
  type: z.enum(["clock.alarm", "clock.timer"]),
  /** The alarm's or timer's name (the app's default name when it has none). */
  title: z.string().trim().min(1).max(80),
  /** The time it rang at, e.g. "07:00". */
  body: z.string().trim().max(120).default(""),
  /** The alarm / timer id on that device (a tap opens it). */
  id: z.string().trim().min(1).max(80),
  /** The device that rang (only that device shows the pop-up). */
  device: z.string().trim().min(1).max(80),
});
export type ClockNotificationInput = z.infer<typeof ClockNotificationSchema>;
