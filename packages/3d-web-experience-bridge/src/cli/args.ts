import type { z } from "zod";

import { coerceValue } from "../zod-utils";

import type { ParsedArgs } from "./shared";

/**
 * Parse process.argv into a subcommand + key/value flags.
 *
 * Supports:
 *   --key value
 *   --key=value
 *   --flag  (boolean, no value)
 */
export function parseArgs(argv: string[]): ParsedArgs {
  // Skip node and script path
  const args = argv.slice(2);
  const flags: Record<string, string> = {};
  let subcommand: string | null = null;
  let help = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      help = true;
      i++;
      continue;
    }

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        // --key=value
        const key = arg.slice(2, eqIdx);
        flags[key] = arg.slice(eqIdx + 1);
      } else {
        // --key value  or  --flag (boolean)
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = "true";
        }
      }
      i++;
      continue;
    }

    // First non-flag argument is the subcommand
    if (subcommand === null) {
      subcommand = arg;
    }
    i++;
  }

  return { subcommand, flags, help };
}

/** Convert kebab-case to snake_case. */
function kebabToSnake(key: string): string {
  return key.replace(/-/g, "_");
}

/**
 * Coerce string flags to the types expected by a Zod object schema,
 * then validate with schema.parse().
 *
 * Converts --kebab-case keys to snake_case before matching.
 * Skips global options (port, host, api-key) so they don't leak into tool params.
 */
export function coerceParams(
  flags: Record<string, string>,
  schema: z.ZodObject<any>,
): Record<string, unknown> {
  const GLOBAL_KEYS = new Set([
    "port",
    "host",
    "api-key",
    "wait",
    "pretty-print",
    "timeout-seconds",
  ]);
  const shape = schema.shape as Record<string, any>;
  const params: Record<string, unknown> = {};

  for (const [rawKey, rawValue] of Object.entries(flags)) {
    const snakeKey = kebabToSnake(rawKey);
    if (GLOBAL_KEYS.has(rawKey) || GLOBAL_KEYS.has(snakeKey)) continue;

    const zodType = shape[snakeKey];
    if (!zodType) continue;

    params[snakeKey] = coerceValue(rawValue, zodType);
  }

  return schema.parse(params);
}
