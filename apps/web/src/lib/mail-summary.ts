import { useQuery } from "@tanstack/react-query";
import type { MailSummaryDto } from "@voidex/shared";
import { api } from "./api";
import { qk } from "./query";

/** Unread counters — used by the Mail app and by the workspace icon badge. */
export function useMailSummary(enabled = true) {
  return useQuery({ queryKey: qk.mailSummary, queryFn: () => api.get<MailSummaryDto>("/api/mail/summary"), enabled });
}
