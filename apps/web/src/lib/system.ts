import { useQuery } from "@tanstack/react-query";
import { publicMailDomain, type LegalDocumentDto, type ServerInfoDto } from "@voidex/shared";
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

/** The canonical mail domain (parsing, what the server stores). */
export function useMailDomain() {
  return useSystemInfo().data?.mailDomain ?? "voidops.ru";
}

/** Step 2.9: what people see after the @: `username@voidops`. */
export function usePublicMailDomain() {
  const info = useSystemInfo().data;
  return info?.publicMailDomain ?? publicMailDomain(info?.mailDomain ?? "voidops.ru");
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
