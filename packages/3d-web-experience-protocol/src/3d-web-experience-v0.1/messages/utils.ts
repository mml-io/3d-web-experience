/** Type guard: checks whether a value is a plain object (non-null, non-array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
