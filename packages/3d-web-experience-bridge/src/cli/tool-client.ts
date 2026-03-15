const FETCH_TIMEOUT_MS = 30_000;

type ConnectionOptions = {
  host: string;
  port: number;
  apiKey?: string;
};

function baseUrl(opts: ConnectionOptions): string {
  return `http://${opts.host}:${opts.port}`;
}

function authHeaders(opts: ConnectionOptions): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.apiKey) {
    headers["Authorization"] = `Bearer ${opts.apiKey}`;
  }
  return headers;
}

/**
 * Execute a tool subcommand by POSTing to the running bridge.
 * Returns the parsed result object, or null on error (errors are printed to stderr).
 */
export async function executeToolCommand(
  toolName: string,
  params: Record<string, unknown>,
  opts: ConnectionOptions,
): Promise<Record<string, unknown> | null> {
  const url = `${baseUrl(opts)}/tools/${toolName}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders(opts),
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err: any) {
    if (err.name === "TimeoutError") {
      console.error(
        `Error: Request to bridge at ${opts.host}:${opts.port} timed out after ${FETCH_TIMEOUT_MS / 1000}s.`,
      );
    } else if (err.cause?.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED")) {
      console.error(
        `Error: Could not connect to bridge at ${opts.host}:${opts.port}. Is the bridge running?`,
      );
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exitCode = 1;
    return null;
  }

  if (res.status === 401) {
    console.error("Error: Unauthorized. Check your --api-key value.");
    process.exitCode = 1;
    return null;
  }

  if (res.status === 404) {
    console.error(`Error: Unknown tool "${toolName}".`);
    process.exitCode = 1;
    return null;
  }

  let body: any;
  try {
    body = await res.json();
  } catch (err) {
    console.error(`Error: Failed to parse JSON response from bridge: ${err}`);
    process.exitCode = 1;
    return null;
  }

  if (!res.ok) {
    console.error(`Error (${res.status}): ${body.error ?? JSON.stringify(body)}`);
    process.exitCode = 1;
    return null;
  }

  // Unwrap MCP content format: { content: [{ type: "text", text: "..." }] }
  if (body.content && Array.isArray(body.content) && body.content.length > 0) {
    for (const item of body.content) {
      if (item.type === "text") {
        try {
          return JSON.parse(item.text);
        } catch {
          return { text: item.text ?? "" };
        }
      }
    }
  }

  return body;
}

/** Print a tool result object to stdout as JSON (compact by default). */
export function printToolResult(result: Record<string, unknown>, prettyPrint = false): void {
  console.log(JSON.stringify(result, null, prettyPrint ? 2 : undefined));
}

/**
 * Send a POST to /shutdown on the running bridge.
 */
export async function executeShutdownCommand(opts: ConnectionOptions): Promise<void> {
  const url = `${baseUrl(opts)}/shutdown`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders(opts),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err: any) {
    if (err.name === "TimeoutError") {
      console.error(
        `Error: Request to bridge at ${opts.host}:${opts.port} timed out after ${FETCH_TIMEOUT_MS / 1000}s.`,
      );
    } else if (err.cause?.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED")) {
      console.error(
        `Error: Could not connect to bridge at ${opts.host}:${opts.port}. Is the bridge running?`,
      );
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (res.status === 401) {
    console.error("Error: Unauthorized. Check your --api-key value.");
    process.exitCode = 1;
    return;
  }

  if (!res.ok) {
    const body: Record<string, unknown> = await res.json().catch(() => ({}));
    console.error(`Error (${res.status}): ${body.error ?? JSON.stringify(body)}`);
    process.exitCode = 1;
    return;
  }

  console.error(`[bridge] Shutdown signal sent to bridge at ${opts.host}:${opts.port}`);
}

/**
 * Execute a GET request (for health/status endpoints).
 */
export async function executeGetCommand(
  endpoint: string,
  opts: ConnectionOptions,
  prettyPrint = false,
): Promise<void> {
  const url = `${baseUrl(opts)}/${endpoint}`;
  const headers: Record<string, string> = {};
  if (opts.apiKey) {
    headers["Authorization"] = `Bearer ${opts.apiKey}`;
  }

  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err: any) {
    if (err.name === "TimeoutError") {
      console.error(
        `Error: Request to bridge at ${opts.host}:${opts.port} timed out after ${FETCH_TIMEOUT_MS / 1000}s.`,
      );
    } else if (err.cause?.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED")) {
      console.error(
        `Error: Could not connect to bridge at ${opts.host}:${opts.port}. Is the bridge running?`,
      );
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (res.status === 401) {
    console.error("Error: Unauthorized. Check your --api-key value.");
    process.exitCode = 1;
    return;
  }

  let body: any;
  try {
    body = await res.json();
  } catch (err) {
    console.error(`Error: Failed to parse JSON response from bridge: ${err}`);
    process.exitCode = 1;
    return;
  }

  if (!res.ok) {
    console.error(`Error (${res.status}): ${body.error ?? JSON.stringify(body)}`);
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(body, null, prettyPrint ? 2 : undefined));
}
