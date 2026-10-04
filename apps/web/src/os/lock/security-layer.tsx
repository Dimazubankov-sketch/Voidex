import { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { useSecurityStatus } from "@/lib/security";
import { qk, queryClient } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useAutoLock } from "./auto-lock";
import { LockScreen } from "./lock-screen";
import { SecuritySetup } from "./security-setup";
import { StepUpSheet } from "./step-up";

/**
 * Everything security that sits above the signed-in workspace: the lock
 * screen (mid-session lock), the first code-password setup after
 * registration, the "confirm it's you" sheet and the auto-lock timer.
 */
export function SecurityLayer() {
  const locked = useSession((s) => s.locked);
  const status = useSecurityStatus().data;
  useAutoLock();
  // Stays up through the (optional) Face ID step, after the code-password already exists.
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    if (status?.passcodeSetupRequired) setSetup(true);
  }, [status?.passcodeSetupRequired]);
  return (
    <>
      <AnimatePresence>
        {!locked && setup && (
          <SecuritySetup
            key="setup"
            onDone={() => {
              setSetup(false);
              void queryClient.invalidateQueries({ queryKey: qk.security });
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>{locked && <LockScreen key="lock" />}</AnimatePresence>
      <StepUpSheet />
    </>
  );
}
