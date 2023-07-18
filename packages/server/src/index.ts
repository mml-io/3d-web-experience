
import url from "url";

import { CharacterNetworkServer } from "@mml-playground/character-network";
import cors from "cors";
import express from "express";

import WebSocket from "ws";

import { MMLDocumentsServer } from "./router/MMLDocumentsServer";
import { PlaygroundMMLDocumentServer } from "./router/PlaygroundMMLDocumentServer";
import { addWebAppRoutes } from "./router/web-app-routes";

const dirname = url.fileURLToPath(new URL(".", import.meta.url));

const PLAYGROUND_DOCUMENT_SOCKET_PATH = "/document";

const PLAYGROUND_DOCUMENT_PATH = path.resolve(dirname, "../playground.html");

const examplesWatchPath = path.resolve(path.join(dirname, "../examples"), "*.html");




const mmlDocumentsServer = new MMLDocumentsServer(examplesWatchPath);
const playgroundMMLDocumentServer = new PlaygroundMMLDocumentServer(PLAYGROUND_DOCUMENT_PATH);

app.use("/*", (req: express.Request, res, next) => {
  const examplesHostUrl = `${req.secure ? "wss" : "ws"}://${
    req.headers["x-forwarded-host"]
      ? `${req.headers["x-forwarded-host"]}:${req.headers["x-forwarded-port"]}`
      : req.headers.host
  }${EXAMPLE_DOCUMENTS_SOCKET_PATH}`;
  playgroundMMLDocumentServer.setHost(examplesHostUrl);
  next();



app.ws(PLAYGROUND_DOCUMENT_SOCKET_PATH, (ws) => {
  playgroundMMLDocumentServer.handle(ws);



app.ws(`${EXAMPLE_DOCUMENTS_SOCKET_PATH}/:filename`, (ws: WebSocket, req: express.Request) => {

  mmlDocumentsServer.handle(filename, ws);


// Serve assets with CORS allowing all origins
app.use("/assets/", cors(), express.static(path.resolve(dirname, "../assets/")));

const characterNetwork = new CharacterNetworkServer();
app.ws(CHARACTER_NETWORK_SOCKET_PATH, (ws) => {
  characterNetwork.connectClient(ws);


// Serve the app (including development mode)
addWebAppRoutes(app);




