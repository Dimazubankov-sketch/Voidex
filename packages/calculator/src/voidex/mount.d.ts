export interface CalculatorController {
  openHistory(): void;
  openHelp(): void;
  /** Narrow windows / phones: show or hide the step-by-step panel over the keypad. */
  toggleSolution(): void;
  focus(): void;
  destroy(): void;
}

export interface MountOptions {
  /** Where the local OCR runtime (worker, wasm core, eng model) is served from. */
  ocrBase?: string;
  onSolutionToggle?: (open: boolean) => void;
}

export function mountCalculator(root: HTMLElement, options?: MountOptions): CalculatorController;
