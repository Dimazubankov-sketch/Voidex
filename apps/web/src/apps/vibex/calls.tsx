import { RiInformationLine, RiPhoneLine, RiVidiconLine } from "@remixicon/react";
import type { VibexPersonDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { useT } from "@/lib/i18n";
import { Button } from "@/ui/controls";
import { Sheet } from "@/ui/overlays";

/**
 * Calls — foundation only (Step 2.3).
 *
 * The chat header has audio / video call buttons and this is where a call
 * would start. Real calls need signalling (offer / answer / ICE exchange over
 * the event stream) and TURN servers for most networks; that infrastructure
 * is not in place yet, so a call is never faked: the sheet says plainly that
 * calls are not available and offers voice messages / video circles instead.
 *
 * When signalling ships: `callsAvailable()` reads it from the server, and
 * `CallSheet` turns into the ringing / in-call screen (RTCPeerConnection).
 */
export type CallKind = "audio" | "video";

export function callsAvailable(): boolean {
  return false;
}

export function CallSheet({ kind, peer, onClose }: { kind: CallKind | null; peer: VibexPersonDto; onClose: () => void }) {
  const t = useT();
  return (
    <Sheet open={!!kind} onClose={onClose} title={kind === "video" ? t("vibex.call.video") : t("vibex.call.audio")} width={420} testId="call-sheet">
      <div className="flex flex-col items-center gap-3 pb-1 text-center">
        <div className="relative">
          <Avatar name={peer.name} userId={peer.id} version={peer.avatarVersion} size={84} />
          <span className="absolute -bottom-1 -right-1 flex size-8 items-center justify-center rounded-full border-2 border-surface bg-surface-secondary text-text-secondary">
            {kind === "video" ? <RiVidiconLine className="size-4" /> : <RiPhoneLine className="size-4" />}
          </span>
        </div>
        <p className="text-[16px] font-semibold">{peer.name}</p>
        <p className="flex items-start gap-2 rounded-2xl bg-surface-secondary px-4 py-3 text-left text-[13.5px] text-text-secondary" data-testid="call-unavailable">
          <RiInformationLine className="mt-0.5 size-4 shrink-0" />
          {t("vibex.call.unavailable")}
        </p>
        <Button variant="secondary" className="w-full" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </Sheet>
  );
}
