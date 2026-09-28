import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { RiCheckLine, RiCloseLine, RiShieldCheckLine } from "@remixicon/react";
import {
  LEGAL_DOCUMENTS,
  checkPassword,
  isPasswordAcceptable,
  normalizeUsername,
  passwordScore,
  regionPolicy,
  validateBirthDate,
  validateName,
  validateUsername,
  type LanguageCode,
  type LegalDocumentKey,
  type SessionResponse,
  type UsernameCheckDto,
  type VerificationStartedDto,
} from "@voidex/shared";
import { parsePhone, type CountryCode } from "@voidex/shared/phone";
import { ApiError, api, qs } from "@/lib/api";
import { cx } from "@/lib/cx";
import { errorMessage, fieldMessage } from "@/lib/errors";
import { useI18n, useT, type MessageKey } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useMailDomain } from "@/lib/system";
import { VoidexMark } from "@/brand/brand";
import { Button, Checkbox, Notice, OtpInput, PasswordField, RoundNavButton, Spinner, TextField } from "@/ui/controls";
import { BirthDateFields, CountryList, LanguageList, PhoneField, datePartsToIso, type DateParts } from "@/ui/pickers";
import { FlowFooter, FlowShell, Progress, StepBody, StepStage } from "./flow-shell";
import { LegalSheet } from "./legal-sheet";

const STEPS = ["name", "birth", "country", "language", "phone", "otp", "mail", "password", "documents", "creating"] as const;
type Step = (typeof STEPS)[number];
const COUNTED = STEPS.length - 1;

interface SignupData {
  firstName: string;
  lastName: string;
  birth: DateParts;
  country: CountryCode | null;
  language: LanguageCode | null;
  phone: string;
  verification: (VerificationStartedDto & { phoneE164: string; sentAt: number }) | null;
  proof: string | null;
  username: string;
  password: string;
  confirm: string;
  consents: Partial<Record<LegalDocumentKey, boolean>>;
}

function guessCountry(): CountryCode | null {
  const region = (navigator.language.split("-")[1] ?? "").toUpperCase();
  return /^[A-Z]{2}$/.test(region) ? (region as CountryCode) : null;
}

export function SignupFlow({ onExit }: { onExit: () => void }) {
  const t = useT();
  const setLanguage = useI18n((s) => s.setLanguage);
  const [step, setStep] = useState<Step>("name");
  const [dir, setDir] = useState<1 | -1>(1);
  const [data, setData] = useState<SignupData>({
    firstName: "",
    lastName: "",
    birth: { day: "", month: "", year: "" },
    country: guessCountry(),
    language: useI18n.getState().language,
    phone: "",
    verification: null,
    proof: null,
    username: "",
    password: "",
    confirm: "",
    consents: {},
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const update = (patch: Partial<SignupData>) => setData((d) => ({ ...d, ...patch }));

  const index = STEPS.indexOf(step);
  const go = (to: Step) => {
    setDir(STEPS.indexOf(to) > index ? 1 : -1);
    setError(null);
    setFieldErrors({});
    setTouched(false);
    setStep(to);
  };
  const back = () => {
    if (index === 0) return onExit();
    // Going back from the code screen means changing the number.
    go(STEPS[index - 1]!);
  };

  // ---- per-step validation (same rules as the server, from @voidex/shared)
  const nameErrors = { firstName: validateName(data.firstName), lastName: validateName(data.lastName) };
  const birthIso = datePartsToIso(data.birth);
  const birthError = validateBirthDate(
    { day: Number(data.birth.day) || undefined, month: Number(data.birth.month) || undefined, year: data.birth.year.length === 4 ? Number(data.birth.year) : undefined },
    data.country,
  );
  const phoneParsed = data.country ? parsePhone(data.phone, data.country) : null;
  const pwCtx = { username: data.username, firstName: data.firstName, lastName: data.lastName, phone: data.verification?.phoneE164 };
  const passwordOk = isPasswordAcceptable(data.password, pwCtx) && data.password === data.confirm;
  const consentsOk = LEGAL_DOCUMENTS.every((d) => !d.required || data.consents[d.key]);

  const [usernameCheck, setUsernameCheck] = useState<UsernameCheckDto | null>(null);
  const canContinue: Record<Step, boolean> = {
    name: !nameErrors.firstName && !nameErrors.lastName,
    birth: !birthError,
    country: !!data.country,
    language: !!data.language,
    phone: !!phoneParsed,
    otp: !!data.proof,
    mail: !!usernameCheck?.available && usernameCheck.username === normalizeUsername(data.username),
    password: passwordOk,
    documents: consentsOk,
    creating: false,
  };

  async function next() {
    setTouched(true);
    if (!canContinue[step] && step !== "otp") return;
    setError(null);
    switch (step) {
      case "country":
        // Region can set the default language for the next step.
        if (data.country && !data.language) update({ language: regionPolicy(data.country).defaultLanguage });
        return go("language");
      case "language":
        if (data.language) setLanguage(data.language);
        return go("phone");
      case "phone":
        return sendCode();
      case "otp":
        return data.proof ? go("mail") : undefined;
      case "documents":
        go("creating");
        return register();
      default:
        return go(STEPS[index + 1]!);
    }
  }

  async function sendCode() {
    if (!phoneParsed) return;
    // Same number already verified: don't text again.
    if (data.proof && data.verification?.phoneE164 === phoneParsed.e164) return go("mail");
    setBusy(true);
    try {
      const v = await api.post<VerificationStartedDto>("/api/auth/phone/start", { phone: phoneParsed.e164 }, { anonymous: true, headers: { "Accept-Language": data.language ?? "en" } });
      update({ verification: { ...v, phoneE164: phoneParsed.e164, sentAt: Date.now() }, proof: null });
      go("otp");
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    try {
      const res = await api.post<SessionResponse>(
        "/api/auth/register",
        {
          firstName: data.firstName,
          lastName: data.lastName,
          birthDate: birthIso,
          country: data.country,
          language: data.language,
          phoneVerification: { id: data.verification!.verificationId, proof: data.proof },
          username: normalizeUsername(data.username),
          password: data.password,
          consents: LEGAL_DOCUMENTS.filter((d) => data.consents[d.key]).map((d) => ({ key: d.key, version: d.version })),
        },
        { anonymous: true },
      );
      setCreated(res);
    } catch (err) {
      // Send the person back to the step that needs attention.
      const code = err instanceof ApiError ? err.code : "";
      const target: Step =
        code === "username_taken" || code === "username_reserved"
          ? "mail"
          : code === "phone_taken" || code === "phone_not_verified" || code === "phone_invalid"
            ? "phone"
            : code === "password_weak"
              ? "password"
              : code === "too_young" || (err instanceof ApiError && err.fields.birthDate)
                ? "birth"
                : err instanceof ApiError && (err.fields.firstName || err.fields.lastName)
                  ? "name"
                  : "documents";
      if (target === "phone") update({ proof: null, verification: null });
      go(target);
      setError(errorMessage(t, err));
      if (err instanceof ApiError) setFieldErrors(err.fields);
    }
  }

  const [created, setCreated] = useState<SessionResponse | null>(null);
  const enter = () => created && useSession.getState().setSession(created);

  const stepLabel = step === "creating" ? undefined : t("signup.step", { n: index + 1, total: COUNTED });

  return (
    <FlowShell
      header={step !== "creating" ? <Progress value={(index + 1) / COUNTED} label={stepLabel} /> : null}
      footer={
        step === "creating" ? null : (
          <FlowFooter
            left={<RoundNavButton direction="back" label={t("common.back")} onClick={back} />}
            center={error ? null : undefined}
            right={
              <RoundNavButton
                label={step === "documents" ? t("signup.docs.create") : t("common.next")}
                onClick={next}
                disabled={!canContinue[step] && (touched || step === "otp" || step === "mail" || step === "documents")}
                loading={busy}
              />
            }
          />
        )
      }
    >
      <StepStage stepKey={step} direction={dir}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void next();
          }}
          noValidate
        >
          {step === "name" && (
            <StepBody title={t("signup.name.title")} subtitle={t("signup.name.subtitle")}>
              <div className="space-y-3">
                <TextField
                  label={t("signup.firstName")}
                  value={data.firstName}
                  onChange={(e) => update({ firstName: e.target.value })}
                  autoComplete="given-name"
                  autoFocus
                  error={touched ? fieldMessage(t, nameErrors.firstName ?? fieldErrors.firstName, "firstName") : undefined}
                  data-testid="first-name"
                />
                <TextField
                  label={t("signup.lastName")}
                  value={data.lastName}
                  onChange={(e) => update({ lastName: e.target.value })}
                  autoComplete="family-name"
                  error={touched ? fieldMessage(t, nameErrors.lastName ?? fieldErrors.lastName, "lastName") : undefined}
                  data-testid="last-name"
                />
              </div>
              {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
            </StepBody>
          )}

          {step === "birth" && (
            <StepBody title={t("signup.birth.title")} subtitle={t("signup.birth.subtitle")}>
              <BirthDateFields
                value={data.birth}
                onChange={(birth) => update({ birth })}
                error={touched || (data.birth.year.length === 4 && data.birth.day && data.birth.month) ? fieldMessage(t, birthError ?? undefined) : undefined}
              />
              {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
            </StepBody>
          )}

          {step === "country" && (
            <StepBody title={t("signup.country.title")} subtitle={t("signup.country.subtitle")}>
              <CountryList value={data.country} onChange={(country) => update({ country })} />
            </StepBody>
          )}

          {step === "language" && (
            <StepBody title={t("signup.language.title")} subtitle={t("signup.language.subtitle")}>
              <LanguageList
                value={data.language}
                onChange={(language) => {
                  update({ language });
                  setLanguage(language);
                }}
              />
            </StepBody>
          )}

          {step === "phone" && data.country && (
            <StepBody title={t("signup.phone.title")} subtitle={t("signup.phone.subtitle")}>
              <PhoneField
                label={t("signup.phone.label")}
                value={data.phone}
                onChange={(phone) => update({ phone })}
                country={data.country}
                autoFocus
                error={touched && !phoneParsed ? t("error.phone_invalid") : undefined}
              />
              {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
            </StepBody>
          )}

          {step === "otp" && data.verification && (
            <OtpStep
              data={data}
              onVerified={(proof) => {
                update({ proof });
                window.setTimeout(() => go("mail"), 450);
              }}
              onResent={(v) => update({ verification: { ...v, phoneE164: data.verification!.phoneE164, sentAt: Date.now() } })}
              onChangeNumber={() => go("phone")}
            />
          )}

          {step === "mail" && <MailStep data={data} update={update} check={usernameCheck} setCheck={setUsernameCheck} error={error} />}

          {step === "password" && (
            <StepBody title={t("signup.password.title")} subtitle={t("signup.password.subtitle")}>
              <PasswordStep data={data} update={update} touched={touched} ctx={pwCtx} error={error} />
            </StepBody>
          )}

          {step === "documents" && <DocumentsStep data={data} update={update} error={error} />}

          {step === "creating" && <CreatingStep created={created} name={data.firstName} onEnter={enter} />}
          <button type="submit" hidden />
        </form>
      </StepStage>
    </FlowShell>
  );
}

// ---------------------------------------------------------------------------

function OtpStep({
  data,
  onVerified,
  onResent,
  onChangeNumber,
}: {
  data: SignupData;
  onVerified: (proof: string) => void;
  onResent: (v: VerificationStartedDto) => void;
  onChangeNumber: () => void;
}) {
  const t = useT();
  const v = data.verification!;
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "ok" | "error">(data.proof ? "ok" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const wait = Math.max(0, Math.ceil((v.sentAt + v.resendAfterSeconds * 1000 - now) / 1000));

  async function verify(value: string) {
    setState("checking");
    setError(null);
    try {
      const r = await api.post<{ proof: string }>("/api/auth/phone/verify", { verificationId: v.verificationId, code: value }, { anonymous: true });
      setState("ok");
      onVerified(r.proof);
    } catch (err) {
      setState("error");
      setError(errorMessage(t, err));
      setCode("");
    }
  }

  async function resend() {
    setError(null);
    try {
      const r = await api.post<VerificationStartedDto>("/api/auth/phone/start", { phone: v.phoneE164 }, { anonymous: true });
      onResent(r);
      setState("idle");
    } catch (err) {
      setError(errorMessage(t, err));
    }
  }

  return (
    <StepBody title={t("signup.otp.title")} subtitle={t("signup.otp.subtitle", { phone: parsePhone(v.phoneE164)?.international ?? v.phoneE164 })}>
      {v.devCode && (
        <Notice tone="warning" className="mb-4">
          <span data-testid="dev-code" data-code={v.devCode}>
            {t("signup.otp.devNotice", { code: v.devCode })}
          </span>
        </Notice>
      )}
      <OtpInput value={code} onChange={setCode} onComplete={verify} error={state === "error"} disabled={state === "checking" || state === "ok"} autoFocus />
      <div className="mt-4 flex min-h-6 items-center gap-2 text-[14px]">
        {state === "checking" && <Spinner className="text-primary" />}
        {state === "ok" && (
          <span className="flex items-center gap-1.5 font-medium text-success animate-fade-up">
            <RiCheckLine className="size-5" /> {t("signup.otp.verified")}
          </span>
        )}
        {error && <span className="text-danger animate-fade-up">{error}</span>}
      </div>
      {state !== "ok" && (
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={wait > 0} onClick={resend}>
            {wait > 0 ? t("signup.otp.resendIn", { s: wait }) : t("signup.otp.resend")}
          </Button>
          <Button variant="ghost" size="sm" onClick={onChangeNumber}>
            {t("signup.otp.changeNumber")}
          </Button>
        </div>
      )}
    </StepBody>
  );
}

function MailStep({
  data,
  update,
  check,
  setCheck,
  error,
}: {
  data: SignupData;
  update: (p: Partial<SignupData>) => void;
  check: UsernameCheckDto | null;
  setCheck: (c: UsernameCheckDto | null) => void;
  error: string | null;
}) {
  const t = useT();
  const domain = useMailDomain();
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);
  const username = normalizeUsername(data.username);
  const localError = data.username ? validateUsername(username) : null;

  useEffect(() => {
    const id = ++seq.current;
    if (localError && localError !== "reserved") {
      setChecking(false);
      return;
    }
    setChecking(true);
    const timer = window.setTimeout(async () => {
      try {
        const r = await api.get<UsernameCheckDto>(
          `/api/auth/username/check${qs({ username, firstName: data.firstName, lastName: data.lastName })}`,
          { anonymous: true },
        );
        if (id === seq.current) setCheck(r);
      } catch {
        if (id === seq.current) setCheck(null);
      } finally {
        if (id === seq.current) setChecking(false);
      }
    }, username ? 350 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  const current = check && check.username === username ? check : null;
  const status: "idle" | "checking" | "ok" | "bad" = !username ? "idle" : checking ? "checking" : localError ? "bad" : current?.available ? "ok" : current ? "bad" : "idle";
  const reason = localError ?? current?.reason;
  const reasonText =
    reason === "taken" ? t("error.username_taken") : reason === "reserved" ? t("error.username_reserved") : reason ? fieldMessage(t, reason) : undefined;

  return (
    <StepBody title={t("signup.mail.title")} subtitle={t("signup.mail.subtitle")}>
      <TextField
        label={t("signup.mail.username")}
        value={data.username}
        onChange={(e) => update({ username: e.target.value.toLowerCase().replace(/\s/g, "") })}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="username"
        autoFocus
        data-testid="username"
        error={status === "bad" ? reasonText : undefined}
        right={
          <span className="flex items-center gap-2 pr-2 text-[15px] text-text-secondary">
            @{domain}
            {status === "checking" && <Spinner size={16} className="text-primary" />}
            {status === "ok" && <RiCheckLine className="size-5 text-success" />}
            {status === "bad" && <RiCloseLine className="size-5 text-danger" />}
          </span>
        }
        hint={status === "ok" ? <span className="font-medium text-success">{t("signup.mail.available", { address: `${username}@${domain}` })}</span> : t("signup.mail.rules")}
      />
      {current && !current.available && current.suggestions.length > 0 && (
        <div className="mt-5 animate-fade-up">
          <div className="mb-2 text-[13px] text-text-secondary">{t("signup.mail.try")}</div>
          <div className="flex flex-wrap gap-2">
            {current.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => update({ username: s })}
                className="pressable rounded-full bg-primary-soft px-3.5 py-2 text-[14px] font-medium text-primary-strong hover:bg-[#e5e1ff]"
                data-testid="username-suggestion"
              >
                {s}@{domain}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
    </StepBody>
  );
}

function PasswordStep({
  data,
  update,
  touched,
  ctx,
  error,
}: {
  data: SignupData;
  update: (p: Partial<SignupData>) => void;
  touched: boolean;
  ctx: Parameters<typeof checkPassword>[1];
  error: string | null;
}) {
  const t = useT();
  return (
    <>
      <div className="space-y-3">
        <PasswordField
          label={t("signup.password.label")}
          value={data.password}
          onChange={(e) => update({ password: e.target.value })}
          autoComplete="new-password"
          autoFocus
          showLabel={t("common.show")}
          hideLabel={t("common.hide")}
          data-testid="password"
        />
        <PasswordField
          label={t("signup.password.confirm")}
          value={data.confirm}
          onChange={(e) => update({ confirm: e.target.value })}
          autoComplete="new-password"
          showLabel={t("common.show")}
          hideLabel={t("common.hide")}
          error={(touched || data.confirm.length >= data.password.length) && data.confirm && data.confirm !== data.password ? t("signup.password.mismatch") : undefined}
          data-testid="password-confirm"
        />
      </div>
      <PasswordStrength password={data.password} ctx={ctx} />
      {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
    </>
  );
}

export function PasswordStrength({ password, ctx }: { password: string; ctx?: Parameters<typeof checkPassword>[1] }) {
  const t = useT();
  const checks = checkPassword(password, ctx);
  const score = passwordScore(password, ctx);
  const colors = ["bg-danger", "bg-danger", "bg-warning", "bg-success", "bg-success"];
  const rules: [keyof typeof checks, MessageKey][] = [
    ["length", "signup.password.rule.length"],
    ["letter", "signup.password.rule.letter"],
    ["digitOrSymbol", "signup.password.rule.digitOrSymbol"],
    ["notCommon", "signup.password.rule.notCommon"],
    ["notPersonal", "signup.password.rule.notPersonal"],
  ];
  return (
    <div className="mt-5">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={cx("h-1.5 flex-1 rounded-full transition-colors duration-300", password && i < Math.max(1, score) ? colors[score] : "bg-surface-secondary")} />
          ))}
        </div>
        <div className="w-28 text-right text-[12px] font-medium text-text-secondary">{password ? t(`signup.password.strength.${score}` as MessageKey) : ""}</div>
      </div>
      <ul className="mt-4 space-y-2">
        {rules.map(([k, label]) => (
          <li key={k} className={cx("flex items-center gap-2 text-[14px] transition-colors", checks[k] && password ? "text-success" : "text-text-secondary")}>
            <span className={cx("flex size-5 items-center justify-center rounded-full transition-all", checks[k] && password ? "bg-success text-white" : "bg-surface-secondary")}>
              {checks[k] && password && <RiCheckLine className="size-3.5" />}
            </span>
            {t(label)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DocumentsStep({ data, update, error }: { data: SignupData; update: (p: Partial<SignupData>) => void; error: string | null }) {
  const t = useT();
  const [open, setOpen] = useState<LegalDocumentKey | null>(null);
  return (
    <StepBody title={t("signup.docs.title")} subtitle={t("signup.docs.subtitle")}>
      <div className="space-y-2.5">
        {LEGAL_DOCUMENTS.map((doc) => (
          <div key={doc.key} className="flex items-start gap-3 rounded-2xl bg-surface-secondary px-4 py-3">
            <div className="flex-1">
              <Checkbox
                checked={!!data.consents[doc.key]}
                onChange={(v) => update({ consents: { ...data.consents, [doc.key]: v } })}
                testId={`consent-${doc.key}`}
              >
                {t(`signup.docs.${doc.key}` as MessageKey)}
                {doc.required && <span className="ml-1.5 text-[12px] text-text-tertiary">· {t("signup.docs.required")}</span>}
              </Checkbox>
            </div>
            <button type="button" onClick={() => setOpen(doc.key)} className="pressable mt-0.5 shrink-0 rounded-xl px-2.5 py-1.5 text-[14px] font-semibold text-primary hover:bg-primary-soft">
              {t("common.read")}
            </button>
          </div>
        ))}
      </div>
      {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
      <LegalSheet docKey={open} onClose={() => setOpen(null)} />
    </StepBody>
  );
}

function CreatingStep({ created, name, onEnter }: { created: SessionResponse | null; name: string; onEnter: () => void }) {
  const t = useT();
  const minDelay = useMemo(() => Date.now() + 1400, []);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!created) return;
    const id = window.setTimeout(() => setReady(true), Math.max(0, minDelay - Date.now()));
    return () => window.clearTimeout(id);
  }, [created, minDelay]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <div className="relative mb-8">
        <motion.div
          className="absolute inset-0 rounded-full bg-primary/25 blur-2xl"
          animate={{ scale: ready ? 1.4 : [1, 1.25, 1], opacity: ready ? 0.9 : [0.5, 0.9, 0.5] }}
          transition={ready ? { duration: 0.6 } : { duration: 1.8, repeat: Infinity }}
        />
        <motion.div animate={ready ? { scale: [1, 1.08, 1] } : { rotate: [0, 0] }} transition={{ duration: 0.6 }}>
          <VoidexMark className="relative size-28" />
        </motion.div>
        {ready && (
          <div className="absolute -bottom-1 -right-1 flex size-9 items-center justify-center rounded-full bg-success text-white shadow-lg animate-pop">
            <RiShieldCheckLine className="size-5" />
          </div>
        )}
      </div>
      {!ready ? (
        <div className="animate-fade-up">
          <h1 className="text-[24px] font-bold tracking-tight">{t("signup.creating.title")}</h1>
          <p className="mt-2 text-text-secondary">{t("signup.creating.subtitle")}</p>
          <Spinner className="mx-auto mt-6 text-primary" size={24} />
        </div>
      ) : (
        <div className="animate-fade-up">
          <h1 className="text-[28px] font-bold tracking-tight" data-testid="welcome-done">
            {t("signup.done.title")}
          </h1>
          <p className="mt-2 text-text-secondary">{t("signup.done.subtitle", { name })}</p>
          <Button size="lg" className="mt-8 min-w-60" onClick={onEnter} data-testid="enter-workspace">
            {t("signup.done.enter")}
          </Button>
        </div>
      )}
    </div>
  );
}
