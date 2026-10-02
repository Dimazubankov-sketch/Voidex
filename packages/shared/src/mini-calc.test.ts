import { describe, expect, it } from "vitest";
import { display, emptyCalc, evaluate, press } from "./mini-calc.js";

const run = (keys: string[]) => keys.reduce(press, emptyCalc());

describe("calculator widget engine", () => {
  it("1250 × 4 = 5000", () => {
    expect(display(run([..."1250", "×", "4", "="])).value).toBe("5000");
  });
  it("× and ÷ before + and −", () => {
    expect(evaluate(["2", "+", "3", "×", "4"])).toBe(14);
    expect(evaluate(["10", "−", "6", "÷", "3"])).toBe(8);
  });
  it("division by zero is an error, not Infinity", () => {
    const s = run(["7", "÷", "0", "="]);
    expect(s.error).toBe(true);
    expect(display(s).value).toBe("");
    // C clears it; a digit after an error starts over.
    expect(display(press(s, "5")).value).toBe("5");
  });
  it("decimals without float noise, sign, percent, backspace", () => {
    expect(display(run(["0", ".", "1", "+", "0", ".", "2", "="])).value).toBe("0.3");
    expect(display(run(["5", "±"])).value).toBe("-5");
    expect(display(run(["5", "0", "%"])).value).toBe("0.5");
    expect(display(run(["1", "2", "3", "⌫"])).value).toBe("12");
  });
  it("an operator after = continues from the answer; a digit starts over", () => {
    expect(display(run(["2", "+", "2", "=", "×", "3", "="])).value).toBe("12");
    expect(display(run(["2", "+", "2", "=", "9"])).value).toBe("9");
  });
  it("a second operator replaces the first", () => {
    expect(display(run(["8", "+", "×", "2", "="])).value).toBe("16");
  });
});
