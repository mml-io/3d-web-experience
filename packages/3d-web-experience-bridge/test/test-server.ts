/**
 * Standalone test server that serves MML documents over WebSocket.
 *
 * Spawned as a child process by the integration tests (via tsx) so that
 * @mml-io/networked-dom-server and its jsdom dependency chain load through
 * Node.js native module resolution rather than Jest's.
 *
 * Outputs a JSON-encoded ready message to stdout:
 *   { "ready": true, "port": <number>, "token": "<string>" }
 */
import path from "path";
import { fileURLToPath } from "url";

import {
  AnonymousAuthenticator,
  Networked3dWebExperienceServer,
} from "@mml-io/3d-web-experience-server";
import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "fixtures");
const PORT = parseInt(process.env.TEST_SERVER_PORT || "0");

async function main() {
  const authenticator = new AnonymousAuthenticator();

  const server = new Networked3dWebExperienceServer({
    networkPath: "/network",
    userAuthenticator: authenticator,
    webClientServing: {
      indexUrl: "/",
      indexContent: "<html></html>",
      clientBuildDir: __dirname,
      clientUrl: "/client",
    },
    mmlServing: {
      documentsWatchPath: `${FIXTURES_DIR}/**/*.html`,
      documentsDirectoryRoot: FIXTURES_DIR,
      documentsUrl: "/mml-documents/",
    },
    worldConfig: {
      spawnConfiguration: {
        spawnPosition: { x: 0, y: 0, z: 0 },
      },
      mmlDocuments: {
        "scene.html": {
          url: "ws:///mml-documents/scene.html",
          position: { x: 0, y: 0, z: 0 },
        },
      },
    },
  });

  const app = express();
  server.registerExpressRoutes(app as any);

  const httpServer = app.listen(PORT, "127.0.0.1", async () => {
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr ? addr.port : PORT;
    const token = await authenticator.generateAuthorizedSessionToken();
    // Machine-readable ready signal for the parent test process
    process.stdout.write(JSON.stringify({ ready: true, port, token }) + "\n");
  });

  process.on("SIGTERM", () => {
    server.dispose();
    httpServer.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[test-server]", err);
  process.exit(1);
});
