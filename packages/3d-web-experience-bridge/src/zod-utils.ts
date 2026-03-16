/**
 * Shared Zod introspection helpers.
 *
 * Used by both the interactive TUI and the CLI argument parser to inspect
 * Zod schemas at runtime (type names, optional checks, descriptions, value coercion).
 */

/** Resolve the underlying primitive type name through ZodOptional/ZodDefault wrappers. */
export function getZodTypeName(zodType: any): string {
  if (!zodType?._def) return "unknown";
  const typeName: string = zodType._def.typeName;
  if (typeName === "ZodOptional" || typeName === "ZodDefault") {
    return getZodTypeName(zodType._def.innerType);
  }
  switch (typeName) {
    case "ZodNumber":
      return "number";
    case "ZodString":
      return "string";
    case "ZodBoolean":
      return "boolean";
    default:
      return typeName.replace("Zod", "").toLowerCase();
  }
}

/** Extract the default value from a ZodDefault wrapper, if present. */
export function getDefaultValue(zodType: any): unknown | undefined {
  if (!zodType?._def) return undefined;
  const typeName: string = zodType._def.typeName;
  if (typeName === "ZodDefault") {
    return zodType._def.defaultValue();
  }
  if (typeName === "ZodOptional" && zodType._def.innerType?._def?.typeName === "ZodDefault") {
    return zodType._def.innerType._def.defaultValue();
  }
  return undefined;
}

/** Coerce a raw string value to the type expected by a Zod schema field. */
export function coerceValue(raw: string, zodType: any): any {
  const typeName = getZodTypeName(zodType);
  switch (typeName) {
    case "number": {
      const n = parseFloat(raw);
      if (isNaN(n)) throw new Error(`Invalid number: "${raw}"`);
      return n;
    }
    case "boolean": {
      const lower = raw.toLowerCase();
      if (lower === "true" || lower === "yes" || lower === "1") return true;
      if (lower === "false" || lower === "no" || lower === "0") return false;
      throw new Error(`Invalid boolean: "${raw}" (use true/false/yes/no)`);
    }
    case "string":
      return raw;
    case "union": {
      const n = parseFloat(raw);
      if (!isNaN(n)) return n;
      return raw;
    }
    default:
      return raw;
  }
}

/** Check whether a Zod type is optional. */
export function isOptional(zodType: any): boolean {
  return zodType?.isOptional?.() ?? false;
}

/** Get the description from a Zod type. */
export function getDescription(zodType: any): string {
  return zodType?.description ?? zodType?._def?.description ?? "";
}
