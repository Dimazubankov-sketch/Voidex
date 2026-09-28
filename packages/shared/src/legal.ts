/**
 * Legal documents a user accepts when creating a VOIDEX account.
 *
 * The texts live on the server (apps/server/legal/<key>/<version>.<lang>.md)
 * so that a legally reviewed version can replace a draft without a client
 * release. Bumping `version` here makes the server require fresh consent.
 */
export const LEGAL_DOCUMENTS = [
  { key: "terms", version: "2026-09-draft.1", required: true },
  { key: "offer", version: "2026-09-draft.1", required: true },
  { key: "privacy", version: "2026-09-draft.1", required: true },
  { key: "data_processing", version: "2026-09-draft.1", required: true },
] as const;

export type LegalDocumentKey = (typeof LEGAL_DOCUMENTS)[number]["key"];
export const LEGAL_KEYS = LEGAL_DOCUMENTS.map((d) => d.key) as [LegalDocumentKey, ...LegalDocumentKey[]];

export function legalDocument(key: LegalDocumentKey) {
  return LEGAL_DOCUMENTS.find((d) => d.key === key)!;
}
