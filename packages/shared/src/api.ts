import { z } from "zod";
import { APP_IDS } from "./apps.js";
import { LEGAL_KEYS } from "./legal.js";
import { MAIL_BODY_MAX, MAIL_RECIPIENTS_MAX, MAIL_SUBJECT_MAX, MAIL_VIEWS } from "./mail.js";
import { LANGUAGE_CODES } from "./regions.js";
import { PASSWORD_MAX } from "./validation/password.js";
import { WorkspaceLayoutSchema } from "./workspace.js";

/**
 * Request schemas shared by the server (authoritative validation) and the web
 * client (typed calls). Semantic rules (real calendar date, phone validity,
 * password strength) are checked by the functions in ./validation on both ends.
 */

const id = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Existence of the region is checked by the server with isCountryCode (@voidex/shared/phone).
const country = z.string().regex(/^[A-Z]{2}$/);
const language = z.enum(LANGUAGE_CODES);
const password = z.string().min(1).max(PASSWORD_MAX);
const secret = z.string().min(20).max(200);
const code = z.string().regex(/^\d{6}$/);

export const PhoneStartSchema = z.object({
  phone: z.string().min(3).max(32),
  country: country.optional(),
});

export const PhoneVerifySchema = z.object({
  verificationId: id,
  code,
});

export const UsernameCheckSchema = z.object({
  username: z.string().max(64),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
});

export const RegisterSchema = z.object({
  firstName: z.string().max(100),
  lastName: z.string().max(100),
  birthDate: isoDate,
  country,
  language,
  phoneVerification: z.object({ id, proof: secret }),
  username: z.string().max(64),
  password,
  consents: z.array(z.object({ key: z.enum(LEGAL_KEYS), version: z.string().max(64) })).max(20),
  deviceName: z.string().max(80).optional(),
});

export const LoginSchema = z.object({
  identifier: z.string().min(1).max(254),
  password,
  deviceName: z.string().max(80).optional(),
  /**
   * Account switch (e.g. from Vibex): the caller's current session (Bearer
   * token) is signed out once the new one is issued. Same sessions, same
   * checks — a new device still needs the second factor.
   */
  replaceSession: z.boolean().optional(),
});

export const ChallengeSecretSchema = z.object({ secret });
export const ChallengeVerifySmsSchema = z.object({ secret, code });
export const RecoveryStartSchema = z.object({ identifier: z.string().min(1).max(254) });
export const RecoveryResetSchema = z.object({
  challengeId: id,
  secret,
  newPassword: password,
  deviceName: z.string().max(80).optional(),
});

export const ProfileUpdateSchema = z
  .object({
    firstName: z.string().max(100),
    lastName: z.string().max(100),
    birthDate: isoDate,
    country,
    language,
  })
  .partial();

export const PasswordChangeSchema = z.object({
  currentPassword: password,
  newPassword: password,
  signOutOtherDevices: z.boolean().default(true),
});

export const PhoneChangeStartSchema = z.object({
  password,
  phone: z.string().min(3).max(32),
  country: country.optional(),
});
export const PhoneChangeConfirmSchema = PhoneVerifySchema;

export const ApprovalDecisionSchema = z.object({ decision: z.enum(["approve", "deny"]) });

/**
 * Step 2.8: ViCloud choices. ViCloud is not running yet: these are kept with
 * the account and take effect when it starts; nothing is uploaded today.
 */
export const ViCloudPrefsSchema = z.object({
  syncFiles: z.boolean(),
  syncMedia: z.boolean(),
  backup: z.boolean(),
  backupMedia: z.boolean(),
  backupCellular: z.boolean(),
});
export type ViCloudPrefs = z.infer<typeof ViCloudPrefsSchema>;
/** Step 2.8: per-app settings (Settings → Apps): ask for the code-password / Face ID on open, banners and sound. */
export const AppPrefsSchema = z.object({ lock: z.boolean(), notifications: z.boolean() });
export type AppPrefs = z.infer<typeof AppPrefsSchema>;
export const DEFAULT_APP_PREFS: AppPrefs = { lock: false, notifications: true };

export const PreferencesSchema = z.object({
  notifications: z.object({
    newMailBanner: z.boolean(),
    showPreview: z.boolean(),
    sound: z.boolean(),
  }),
  vicloud: ViCloudPrefsSchema,
  apps: z.partialRecord(z.enum(APP_IDS as [string, ...string[]]), AppPrefsSchema.partial()),
  workspace: z.object({
    appOrder: z.array(z.enum(APP_IDS as [string, ...string[]])).max(100),
    /** Desktop arrangement, folders, wallpaper (see workspace.ts). Absent until first customised. */
    layout: WorkspaceLayoutSchema.optional(),
  }),
});
export type Preferences = z.infer<typeof PreferencesSchema>;
export const PreferencesPatchSchema = z.object({
  notifications: PreferencesSchema.shape.notifications.partial().optional(),
  workspace: PreferencesSchema.shape.workspace.partial().optional(),
  vicloud: ViCloudPrefsSchema.partial().optional(),
  /** One app's settings, merged into what is stored. */
  apps: PreferencesSchema.shape.apps.optional(),
});
export const DEFAULT_PREFERENCES: Preferences = {
  notifications: { newMailBanner: true, showPreview: true, sound: false },
  vicloud: { syncFiles: true, syncMedia: true, backup: true, backupMedia: true, backupCellular: false },
  apps: {},
  workspace: { appOrder: ["mail", "settings"] },
};

// ---- mail -----------------------------------------------------------------

export const MailListQuerySchema = z.object({
  view: z.enum(MAIL_VIEWS).default("inbox"),
  q: z.string().max(200).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const MailThreadQuerySchema = z.object({ view: z.enum(MAIL_VIEWS).default("inbox") });

export const MailThreadActionSchema = z.object({
  threadIds: z.array(id).min(1).max(200),
  action: z.enum(["archive", "trash", "restore", "delete_forever", "read", "unread", "star", "unstar", "inbox"]),
  view: z.enum(MAIL_VIEWS),
});

export const MailMessageFlagSchema = z.object({
  read: z.boolean().optional(),
  starred: z.boolean().optional(),
});

const addressList = z.array(z.string().min(1).max(254)).max(MAIL_RECIPIENTS_MAX);

export const DraftInputSchema = z.object({
  to: addressList.default([]),
  cc: addressList.default([]),
  bcc: addressList.default([]),
  subject: z.string().max(MAIL_SUBJECT_MAX).default(""),
  body: z.string().max(MAIL_BODY_MAX).default(""),
  /** Step 2.6: Voidex Notes share links attached as .txt / .prsn cards (omitted: unchanged). */
  notesTokens: z.array(z.string().regex(/^[A-Za-z0-9_-]{16,64}$/)).max(10).optional(),
});

export const DraftCreateSchema = DraftInputSchema.extend({
  /** Makes the draft a reply to this message (same thread). */
  replyToMessageId: id.optional(),
  /** Marks the draft as a forward of this message (new thread). */
  forwardOfMessageId: id.optional(),
});

export type DraftInput = z.infer<typeof DraftInputSchema>;
export type DraftCreateInput = z.infer<typeof DraftCreateSchema>;
