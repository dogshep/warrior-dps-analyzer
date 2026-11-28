// Sim iteration limits shared by the page.
export const DEFAULT_ITERATIONS = 300;
export const MIN_ITERATIONS = 50;
export const MAX_ITERATIONS = 5000;

// A fight count as a whole number from `min` to MAX_ITERATIONS, DEFAULT_ITERATIONS when it isn't a number.
export const clampIterations = (n, min = 1) => Math.min(MAX_ITERATIONS, Math.max(min, Math.round(Number(n)) || DEFAULT_ITERATIONS));
