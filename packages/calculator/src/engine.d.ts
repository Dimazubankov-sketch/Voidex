export interface SolveStep {
  title: string;
  tex: string;
}
export interface SolveResult {
  kind: "expression" | "equation";
  value?: number;
  answer: string;
  roots?: number[];
  steps: SolveStep[];
  resultTex?: string;
  detail: string;
  input: string;
}
export function solve(expression: string, angle?: "RAD" | "DEG"): SolveResult;
export function toTex(expression: string): string;
export function normalize(expression: string): string;
