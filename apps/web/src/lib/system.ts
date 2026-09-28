import { useQuery } from "@tanstack/react-query";
import type { LegalDocumentDto, ServerInfoDto } from "@voidex/shared";
import { api } from "./api";
import { useLanguage } from "./i18n";
import { qk } from "./query";

export function useSystemInfo() {
  return useQuery({
    queryKey: qk.systemInfo,
    queryFn: () => api.get<ServerInfoDto>("/api/system/info", { anonymous: true }),
    staleTime: Infinity,
  });
}

export function useMailDomain() {
  return useSystemInfo().data?.mailDomain ?? "voidops.ru";
}

export function useLegalDocument(key: string | null) {
  const lang = useLanguage();
  return useQuery({
    queryKey: qk.legal(key ?? "", lang),
    enabled: !!key,
    staleTime: Infinity,
    queryFn: () => api.get<LegalDocumentDto>(`/api/legal/${key}?lang=${lang}`, { anonymous: true }),
  });
}
