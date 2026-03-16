export type Position = { x: number; y: number; z: number };

/** Maximum distance at which label content can be read. */
export const LABEL_READ_DISTANCE = 15;

/** Euclidean distance between two 3D points. */
export function distance(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Euclidean distance on the XZ plane (ignoring Y). */
export function distance2D(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Round each coordinate to two decimal places. */
export function roundPos(p: Position): Position {
  return {
    x: Math.round(p.x * 100) / 100,
    y: Math.round(p.y * 100) / 100,
    z: Math.round(p.z * 100) / 100,
  };
}

/** Round a scalar to two decimal places. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Create a standard tool result containing a single JSON text block. */
export function textResult(data: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}
