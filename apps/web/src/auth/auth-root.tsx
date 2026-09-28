import { useState } from "react";
import { motion } from "motion/react";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useSystemInfo } from "@/lib/system";
import { VoidexMark } from "@/brand/brand";
import { Button } from "@/ui/controls";
import { FlowShell, StepStage } from "./flow-shell";
import { LoginFlow } from "./login";
import { RecoveryFlow } from "./recovery";
import { SignupFlow } from "./signup";

type Screen = "welcome" | "signup" | "login" | "recovery";
const DEPTH: Record<Screen, number> = { welcome: 0, signup: 1, login: 1, recovery: 2 };

/** Everything a signed-out device sees. */
export function AuthRoot() {
  const reason = useSession((s) => s.signedOutReason);
  const [screen, setScreen] = useState<Screen>(reason === "expired" || reason === "revoked" ? "login" : "welcome");
  const [dir, setDir] = useState<1 | -1>(1);
  const go = (s: Screen) => {
    setDir(DEPTH[s] >= DEPTH[screen] ? 1 : -1);
    setScreen(s);
  };

  // Each flow owns its own shell; the outer stage slides between flows.
  return (
    <div className="relative h-dvh overflow-hidden bg-background">
      <StepStage stepKey={screen} direction={dir}>
        {screen === "welcome" && <Welcome onCreate={() => go("signup")} onSignIn={() => go("login")} />}
        {screen === "signup" && <SignupFlow onExit={() => go("welcome")} />}
        {screen === "login" && <LoginFlow reason={reason} onExit={() => go("welcome")} onForgot={() => go("recovery")} onCreate={() => go("signup")} />}
        {screen === "recovery" && <RecoveryFlow onExit={() => go("login")} />}
      </StepStage>
    </div>
  );
}

function Welcome({ onCreate, onSignIn }: { onCreate: () => void; onSignIn: () => void }) {
  const t = useT();
  const info = useSystemInfo();
  return (
    <FlowShell>
      <div className="flex h-full flex-col items-center px-8 pb-8 pt-10 text-center sm:px-12">
        <div className="flex flex-1 flex-col items-center justify-center">
          <motion.div
            className="relative"
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="absolute inset-4 rounded-full bg-primary/35 blur-3xl animate-glow" />
            <VoidexMark className="relative size-36 sm:size-40" />
          </motion.div>
          <motion.h1
            className="mt-8 text-[30px] font-bold leading-tight tracking-tight sm:text-[34px]"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.5 }}
          >
            {t("welcome.title")}
          </motion.h1>
          <motion.p className="mt-2 text-[17px] text-text-secondary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25, duration: 0.5 }}>
            {t("welcome.subtitle")}
          </motion.p>
        </div>
        <motion.div className="w-full max-w-sm space-y-3" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.5 }}>
          <Button size="lg" block onClick={onCreate} data-testid="welcome-create">
            {t("welcome.create")}
          </Button>
          <Button size="lg" variant="secondary" block onClick={onSignIn} data-testid="welcome-signin">
            {t("welcome.signin")}
          </Button>
          <p className="pt-3 text-[12px] text-text-tertiary">
            {t("brand.tagline")}
            {info.data?.smsDevMode && <span className="ml-1 text-warning">· {t("welcome.devBuild")}</span>}
          </p>
        </motion.div>
      </div>
    </FlowShell>
  );
}
