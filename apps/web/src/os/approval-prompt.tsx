import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RiShieldKeyholeLine } from "@remixicon/react";
import type { ApprovalRequestDto } from "@voidex/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatRelative, useLanguage, useT } from "@/lib/i18n";
import { qk, queryClient } from "@/lib/query";
import { Button, Notice } from "@/ui/controls";
import { Sheet } from "@/ui/overlays";

/**
 * System prompt on trusted devices: another device asks to sign in (or to
 * reset the password). Arrives in real time over the event stream.
 */
export function ApprovalPrompt() {
  const t = useT();
  const lang = useLanguage();
  const { data } = useQuery({
    queryKey: qk.approvals,
    queryFn: () => api.get<ApprovalRequestDto[]>("/api/security/approvals"),
    refetchInterval: 60_000,
  });
  const [dismissed, setDismissed] = useState<string[]>([]);
  const current = data?.find((a) => !dismissed.includes(a.id)) ?? null;
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: "approve" | "deny" }) => api.post(`/api/security/approvals/${v.id}`, { decision: v.decision }),
    onSuccess: (_, v) => {
      setDismissed((d) => [...d, v.id]);
      void queryClient.invalidateQueries({ queryKey: qk.approvals });
    },
  });

  return (
    <Sheet open={!!current} onClose={() => current && setDismissed((d) => [...d, current.id])} width={440} testId="approval-prompt">
      {current && (
        <div className="flex flex-col items-center pt-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-3xl bg-primary-soft text-primary">
            <RiShieldKeyholeLine className="size-8" />
          </div>
          <h2 className="mt-4 text-[20px] font-semibold">{current.kind === "recovery" ? t("approval.titleRecovery") : t("approval.title")}</h2>
          <p className="mt-2 text-[15px] text-text-secondary">
            {t(current.kind === "recovery" ? "approval.bodyRecovery" : "approval.body", { device: current.deviceName })}
          </p>
          <div className="mt-2 text-[13px] text-text-tertiary">
            {current.ipAddress ? `${t("approval.from", { ip: current.ipAddress })} · ` : ""}
            {formatRelative(current.createdAt, lang)}
          </div>
          <Notice tone="warning" className="mt-4 text-left">
            {t("approval.warning")}
          </Notice>
          {decide.error && <Notice tone="danger" className="mt-3">{errorMessage(t, decide.error)}</Notice>}
          <div className="mt-6 grid w-full grid-cols-2 gap-2">
            <Button variant="danger" size="lg" onClick={() => decide.mutate({ id: current.id, decision: "deny" })} disabled={decide.isPending} data-testid="approval-deny">
              {t("approval.deny")}
            </Button>
            <Button size="lg" onClick={() => decide.mutate({ id: current.id, decision: "approve" })} loading={decide.isPending} data-testid="approval-approve">
              {t("approval.approve")}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
