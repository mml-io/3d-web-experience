import * as net from "net";

/** Default port for the bridge HTTP server. */
export const DEFAULT_PORT = 3101;

/** Default host for tool subcommand HTTP requests. */
export const DEFAULT_HOST = "localhost";

export type ParsedArgs = {
  subcommand: string | null;
  flags: Record<string, string>;
  help: boolean;
};

/** Try to bind a TCP server to the given port. Resolves true if available. */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Find an available port starting from `startPort`, trying up to `maxAttempts`
 * consecutive ports.
 */
export async function findAvailablePort(
  startPort: number,
  maxAttempts: number = 100,
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (port > 65535) break;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(
    `No available port found in range ${startPort}–${Math.min(startPort + maxAttempts - 1, 65535)}`,
  );
}
