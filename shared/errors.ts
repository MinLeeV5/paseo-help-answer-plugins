export const generationErrorCodes = [
  "timeout", "invalidModel", "noModel", "emptyResponse", "invalidResponse",
  "incomplete", "failed", "settings", "connection",
] as const;
export type GenerationErrorCode = typeof generationErrorCodes[number];

// Only errors created by this plugin carry a translation code.
// Original provider/daemon errors remain unchanged.
export class GenerationError extends Error {
  constructor(readonly code: GenerationErrorCode, message: string) {
    super(message);
    this.name = "GenerationError";
  }
}
