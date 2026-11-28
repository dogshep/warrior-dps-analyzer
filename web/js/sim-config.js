// Sim iteration limits shared by the page. sim-worker.js is a classic worker and can't import this file, so it
// repeats MAX_ITERATIONS and DEFAULT_ITERATIONS; keep them in step.
export const DEFAULT_ITERATIONS = 300;
export const MIN_ITERATIONS = 50;
export const MAX_ITERATIONS = 5000;
