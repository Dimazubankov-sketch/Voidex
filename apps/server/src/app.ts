import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { ErrorCode, type ApiErrorBody } from "@voidex/shared";
import type { Config } from "./config.js";
import { createDb, type Db } from "./db/client.js";
import { assertSameOrigin } from "./http.js";
import { AppError, fail } from "./lib/errors.js";
import { AccountService } from "./services/accounts.js";
import { AppsService } from "./services/apps.js";
import { ChallengeService } from "./services/challenges.js";
import type { Ctx } from "./services/context.js";
import { EventHub } from "./services/events.js";
import { LegalService } from "./services/legal.js";
import { MailService } from "./services/mail.js";
import { SessionService, type AuthContext } from "./services/sessions.js";
import { OtpComSmsProvider, createSmsProvider, type SmsProvider } from "./services/sms/index.js";
import { PgBlobStorage } from "./services/blobs.js";
import { VerificationService } from "./services/verification.js";
import { VibexService } from "./services/vibex.js";
import { createTranslator, type Translator } from "./services/translate.js";
import { accountRoutes } from "./routes/account.js";
import { authRoutes } from "./routes/auth.js";
import { mailRoutes } from "./routes/mail.js";
import { systemRoutes } from "./routes/system.js";
import { vibexRoutes } from "./routes/vibex.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    services: Services;
    ctx: Ctx;
    /** preHandler: requires a valid access token bound to a live session. */
    authenticate: (req: FastifyRequest) => Promise<void>;
  }
}

export interface Services {
  sessions: SessionService;
  verification: VerificationService;
  accounts: AccountService;
  challenges: ChallengeService;
  apps: AppsService;
  legal: LegalService;
  mail: MailService;
  vibex: VibexService;
}

export interface BuildOptions {
  config: Config;
  sms?: SmsProvider;
  translator?: Translator;
  db?: Db;
  now?: () => Date;
}

export async function buildApp({ config, sms, translator, db: providedDb, now }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.env === "test"
        ? false
        : {
            level: config.logLevel,
            redact: ["req.headers.authorization", "req.headers.cookie", 'req.headers["x-voidex-refresh"]', 'req.headers["x-voidex-device"]'],
            ...(config.production ? {} : { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } }),
          },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    disableRequestLogging: config.env === "test",
  });

  const owned = providedDb ? null : createDb(config.databaseUrl);
  const db = providedDb ?? owned!.db;

  const ctx: Ctx = {
    db,
    config,
    sms: sms ?? createSmsProvider(config, app.log),
    events: new EventHub(),
    blobs: new PgBlobStorage(db),
    translator: translator ?? createTranslator(config.translate.provider, config.translate.email),
    now: now ?? (() => new Date()),
  };
  const sessions = new SessionService(ctx);
  const verification = new VerificationService(ctx);
  const accounts = new AccountService(ctx, sessions, verification);
  const services: Services = {
    sessions,
    verification,
    accounts,
    challenges: new ChallengeService(ctx, sessions, verification, accounts),
    apps: new AppsService(ctx),
    legal: new LegalService(),
    mail: new MailService(ctx),
    vibex: new VibexService(ctx),
  };
  app.decorate("services", services);
  app.decorate("ctx", ctx);
  app.decorateRequest("auth", null);

  if (ctx.sms instanceof OtpComSmsProvider) {
    // Free check (sends nothing): tells the operator right away if the key was rejected.
    const provider = ctx.sms;
    app.addHook("onReady", async () => {
      void provider.probe().then((r) => {
        if (r === "ok") app.log.info({ provider: "otpcom" }, "SMS provider: otp.com — API key accepted");
        else if (r === "unauthorized") app.log.error({ provider: "otpcom" }, "SMS provider: otp.com rejected the API key (401) — check OTP_API_KEY");
        else app.log.warn({ provider: "otpcom" }, "SMS provider: otp.com is not reachable right now");
      });
    });
  }
  if (config.sms.provider === "console") {
    app.log.warn("SMS provider: development console — codes are logged, NOT delivered. Not allowed in production.");
  }

  // Accept an empty JSON body as {} (e.g. POST /drafts/:id/send with no payload).
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    if (!text.trim()) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new AppError(ErrorCode.ValidationFailed, "Malformed JSON body.", { status: 400 }), undefined);
    }
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, {
    global: true,
    max: 600 * config.rateLimitScale,
    timeWindow: "1 minute",
    // Tests simulate many devices from one IP; each simulated device gets its own bucket.
    keyGenerator: (req) =>
      config.env === "test" && typeof req.headers["x-test-client"] === "string" ? req.headers["x-test-client"] : req.ip,
    errorResponseBuilder: (_req, ctx) =>
      new AppError(ErrorCode.RateLimited, "Too many requests. Please slow down.", {
        status: 429,
        details: { retryAfterSeconds: Math.ceil(ctx.ttl / 1000) },
      }),
  });

  // CORS for explicitly allowed native-shell origins only.
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Access-Control-Allow-Headers", "authorization,content-type,x-file-name,x-voidex-client,x-voidex-device,x-voidex-refresh");
      reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE");
      if (req.method === "OPTIONS") return reply.status(204).send();
    }
  });

  app.addHook("preHandler", async (req) => {
    if (req.url.startsWith("/api/")) assertSameOrigin(req, config);
  });

  app.decorate("authenticate", async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw fail(ErrorCode.Unauthenticated, "Please sign in.");
    req.auth = await sessions.authenticate(header.slice(7));
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      const body: ApiErrorBody = {
        error: { code: err.code, message: err.message, fields: err.options.fields, details: err.options.details },
      };
      if (err.status === 429 && typeof err.options.details?.retryAfterSeconds === "number") {
        reply.header("Retry-After", String(err.options.details.retryAfterSeconds));
      }
      return reply.status(err.status).send(body);
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 413 || e.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.status(413).send({ error: { code: ErrorCode.ValidationFailed, message: "Request is too large." } });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: ErrorCode.ValidationFailed, message: "Malformed request." } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: ErrorCode.Internal, message: "Something went wrong on our side." } });
  });

  await app.register(
    async (api) => {
      await api.register(systemRoutes);
      await api.register(authRoutes, { prefix: "/auth" });
      await api.register(accountRoutes);
      await api.register(mailRoutes, { prefix: "/mail" });
      await api.register(vibexRoutes, { prefix: "/vibex" });
    },
    { prefix: "/api" },
  );

  // Production: serve the built web client (single origin => simple cookies & CSP).
  const webDist = config.webDist ? resolve(config.webDist) : null;
  if (webDist && existsSync(resolve(webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, index: ["index.html"] });
    app.setNotFoundHandler((req, reply) => {
      if ((req.method === "GET" || req.method === "HEAD") && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.status(404).send({ error: { code: ErrorCode.NotFound, message: "Not found." } });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: ErrorCode.NotFound, message: "Not found." } }));
  }

  app.addHook("onClose", async () => {
    await owned?.pool.end();
  });

  return app;
}
