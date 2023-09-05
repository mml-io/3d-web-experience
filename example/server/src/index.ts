import path from "path";
import url from "url";

import dolbyio from "@dolbyio/dolbyio-rest-apis-client";
import JwtToken from "@dolbyio/dolbyio-rest-apis-client/dist/types/jwtToken";
import { ChatNetworkingServer } from "@mml-io/3d-web-text-chat";
import { UserNetworkingServer } from "@mml-io/3d-web-user-networking";
import cors from "cors";
import express from "express";
import enableWs from "express-ws";
import WebSocket from "ws";

import { authMiddleware } from "./auth";
import { MMLDocumentsServer } from "./router/MMLDocumentsServer";
import { addWebAppRoutes } from "./router/web-app-routes";

const dirname = url.fileURLToPath(new URL(".", import.meta.url));
const PORT = process.env.PORT || 8080;
const documentsWatchPath = path.resolve(path.join(dirname, "../mml-documents"), "*.html");

const { app } = enableWs(express());
app.enable("trust proxy");

if (process.env.PASSWORD) {
  app.use(authMiddleware(process.env.PASSWORD ?? ""));
}

const APP_KEY = process.env.APP_KEY ?? "";
const APP_SECRET = process.env.APP_SECRET ?? "";

let apiTokenPromise: Promise<JwtToken> | null = null;
if (APP_KEY && APP_SECRET) {
  apiTokenPromise = dolbyio.authentication.getApiAccessToken(APP_KEY, APP_SECRET, 600, [
    "comms:client_access_token:create",
  ]);
}

const mmlDocumentsServer = new MMLDocumentsServer(documentsWatchPath);

app.get("/voice-token/:id", async (req, res) => {
  if (!apiTokenPromise) {
    res.status(501).json({ error: "Audio service not configured" });
    return;
  }
  // This endpoint is used by the web client to get a token for audio service
  // TODO - this endpoint should be authenticated to limit access to tokens
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  const apiToken = await apiTokenPromise;
  const accessToken = await dolbyio.communications.authentication.getClientAccessTokenV2({
    accessToken: apiToken,
    externalId: id,
    sessionScope: ["conf:create", "notifications:set"],
  });
  res.json({ accessToken: accessToken.access_token });
});

// Handle example document sockets
app.ws(`/mml-documents/:filename`, (ws: WebSocket, req: express.Request) => {
  const { filename } = req.params;
  mmlDocumentsServer.handle(filename, ws);
});

// Serve assets with CORS allowing all origins
app.use("/assets/", cors(), express.static(path.resolve(dirname, "../assets/")));

const userNetworkingServer = new UserNetworkingServer();
app.ws("/network", (ws) => {
  userNetworkingServer.connectClient(ws);
});

const chatNetworkingServer = new ChatNetworkingServer();
app.ws("/chat-network", (ws, req) => {
  chatNetworkingServer.connectClient(ws, parseInt(req.query.id as string, 10));
});

// Serve the app (including development mode)
addWebAppRoutes(app);

// Start listening
console.log("Listening on port", PORT);
app.listen(PORT);
