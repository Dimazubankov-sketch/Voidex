/**
 * The tiny engine of the Calculator widget: + − × ÷ with the usual precedence,
 * decimals, percent of the last number, sign change. Deliberately small — the
 * full Calculator app (fractions, equations, OCR…) is loaded only when opened.
 */

export interface MiniCalcState {
  /** Tokens: numbers as strings, operators as "+", "−", "×", "÷". */
  tokens: string[];
  /** The answer shown after "=" (null while typing). */
  result: string | null;
  error: boolean;
}

export const MINI_OPS = ["+", "−", "×", "÷"] as const;
export type MiniOp = (typeof MINI_OPS)[number];
const isOp = (t: string | undefined): t is MiniOp => !!t && (MINI_OPS as readonly string[]).includes(t);

export const emptyCalc = (): MiniCalcState => ({ tokens: [], result: null, error: false });

/** Formats a number for the display (no float noise, at most 12 significant digits). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const s = Number(n.toPrecision(12)).toString();
  return s.includes("e") ? n.toExponential(6) : s;
}

/** Evaluates number/operator tokens with × ÷ before + −. Null on division by zero / bad input. */
export function evaluate(tokens: string[]): number | null {
  const list = isOp(tokens.at(-1)) ? tokens.slice(0, -1) : tokens;
  if (!list.length) return 0;
  const nums: number[] = [];
  const ops: MiniOp[] = [];
  for (const t of list) {
    if (isOp(t)) ops.push(t);
    else {
      const v = Number(t === "." ? "0" : t);
      if (!Number.isFinite(v)) return null;
      nums.push(v);
    }
  }
  if (nums.length !== ops.length + 1) return null;
  // × and ÷ first.
  const n2 = [nums[0]!];
  const o2: MiniOp[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    const b = nums[i + 1]!;
    if (op === "×" || op === "÷") {
      if (op === "÷" && b === 0) return null;
      const a = n2.pop()!;
      n2.push(op === "×" ? a * b : a / b);
    } else {
      o2.push(op);
      n2.push(b);
    }
  }
  let acc = n2[0]!;
  for (let i = 0; i < o2.length; i++) acc = o2[i] === "+" ? acc + n2[i + 1]! : acc - n2[i + 1]!;
  return acc;
}

export function press(s: MiniCalcState, key: string): MiniCalcState {
  if (key === "C") return emptyCalc();
  // After "=": a digit starts over, an operator continues from the answer.
  let tokens = s.error ? [] : [...s.tokens];
  if (s.result !== null) tokens = /[0-9.]/.test(key) ? [] : [s.result];
  const last = tokens.at(-1);
  if (/^[0-9]$/.test(key)) {
    if (last === undefined || isOp(last)) tokens.push(key);
    else if (last.replace("-", "").replace(".", "").length < 15) tokens[tokens.length - 1] = last === "0" ? key : last === "-0" ? `-${key}` : last + key;
    return { tokens, result: null, error: false };
  }
  if (key === ".") {
    if (last === undefined || isOp(last)) tokens.push("0.");
    else if (!last.includes(".")) tokens[tokens.length - 1] = `${last}.`;
    return { tokens, result: null, error: false };
  }
  if (isOp(key)) {
    if (last === undefined) tokens.push("0", key);
    else if (isOp(last)) tokens[tokens.length - 1] = key;
    else tokens.push(key);
    return { tokens, result: null, error: false };
  }
  if (key === "±") {
    if (last !== undefined && !isOp(last)) tokens[tokens.length - 1] = last.startsWith("-") ? last.slice(1) : `-${last}`;
    return { tokens, result: null, error: false };
  }
  if (key === "%") {
    if (last !== undefined && !isOp(last)) tokens[tokens.length - 1] = formatNumber(Number(last) / 100);
    return { tokens, result: null, error: false };
  }
  if (key === "⌫") {
    if (last === undefined) return s;
    if (isOp(last) || last.length <= 1 || (last.length === 2 && last.startsWith("-"))) tokens.pop();
    else tokens[tokens.length - 1] = last.slice(0, -1);
    return { tokens, result: null, error: false };
  }
  if (key === "=") {
    if (!tokens.length) return s;
    const v = evaluate(tokens);
    if (v === null) return { tokens, result: null, error: true };
    return { tokens, result: formatNumber(v), error: false };
  }
  return s;
}

/** What the display shows: the expression while typing, the answer after "=". */
export function display(s: MiniCalcState): { expression: string; value: string } {
  const expression = s.tokens.join(" ");
  if (s.error) return { expression, value: "" };
  if (s.result !== null) return { expression: `${expression} =`, value: s.result };
  const last = s.tokens.at(-1);
  return { expression: s.tokens.length > 1 ? expression : "", value: last && !isOp(last) ? last : (s.tokens.at(-2) ?? "0") };
}
