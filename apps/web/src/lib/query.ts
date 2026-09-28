import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

export const qk = {
  me: ["me"] as const,
  apps: ["apps"] as const,
  sessions: ["sessions"] as const,
  approvals: ["approvals"] as const,
  consents: ["consents"] as const,
  systemInfo: ["system-info"] as const,
  legal: (key: string, lang: string) => ["legal", key, lang] as const,
  mail: ["mail"] as const,
  mailSummary: ["mail", "summary"] as const,
  mailList: (view: string, q: string) => ["mail", "list", view, q] as const,
  mailThread: (id: string, view: string) => ["mail", "thread", id, view] as const,
  mailDraft: (id: string) => ["mail", "draft", id] as const,
};
