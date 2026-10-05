import { z } from "zod";

/**
 * The web client runs under a strict Content-Security-Policy (no eval). zod
 * otherwise probes `new Function` once — caught, but reported by the browser
 * as a CSP violation. Jitless validation is the same validation without it.
 * Runs when this module loads (it is the first module of the package), so
 * before any schema anywhere is used.
 */
z.config({ jitless: true });

export const STRICT_CSP_VALIDATION = true;
