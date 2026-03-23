import http from "http";

import {
  experienceProtocolToDeltaNetSubProtocol,
  FROM_CLIENT_CHAT_MESSAGE_TYPE,
  FROM_SERVER_CHAT_MESSAGE_TYPE,
  FROM_SERVER_SESSION_CONFIG_MESSAGE_TYPE,
  handleExperienceWebsocketSubprotocol,
  MAX_CHAT_MESSAGE_LENGTH,
  parseClientChatMessage,
  FROM_SERVER_WORLD_CONFIG_MESSAGE_TYPE,
  type ServerChatMessage,
  type SessionConfigPayload,
  type WorldConfigPayload,
} from "@mml-io/3d-web-experience-protocol";
import {
  UserData,
  UserIdentityUpdate,
  UserNetworkingServer,
  UserNetworkingServerError,
} from "@mml-io/3d-web-user-networking";
import { NetworkedDOM } from "@mml-io/networked-dom-server";
import cors from "cors";
import express from "express";
import enableWs from "express-ws";
import ws from "ws";

import { MMLDocumentsServer } from "./MMLDocumentsServer";
import { websocketDirectoryChangeListener } from "./websocketDirectoryChangeListener";

export type UserAuthenticator = {
  generateAuthorizedSessionToken(
    req: express.Request,
  ): Promise<string | { redirect: string } | null>;
  getClientIdForSessionToken: (sessionToken: string) => {
    id: number;
  } | null;
  getSessionAuthToken?(sessionToken: string): string | null | Promise<string | null>;
  onClientConnect(
    connectionId: number,
    sessionToken: string,
    userIdentityPresentedOnConnection?: UserData,
  ): Promise<UserData | true | Error> | UserData | true | Error;
  onClientUserIdentityUpdate(
    connectionId: number,
    userIdentity: UserIdentityUpdate,
  ):
    | Promise<UserIdentityUpdate | null | false | true | Error>
    | UserIdentityUpdate
    | null
    | false
    | true
    | Error;
  onClientDisconnect(connectionId: number): void;
  dispose?(): void;
};

export const defaultSessionTokenPlaceholder = "SESSION.TOKEN.PLACEHOLDER";

export type Networked3dWebExperienceServerConfig = {
  networkPath: string;
  webClientServing?: {
    indexUrl: string;
    indexContent: string;
    sessionTokenPlaceholder?: string;

    clientBuildDir: string;
    clientUrl: string;
    clientWatchWebsocketPath?: string;
  };
  assetServing?: {
    assetsDir: string;
    assetsUrl: string;
  };
  mmlServing?: {
    documentsWatchPath: string;
    documentsDirectoryRoot: string;
    documentsUrl: string;
  };
  userAuthenticator: UserAuthenticator;
  /**
   * Whether to relay chat messages between clients. Defaults to true.
   */
  enableChat?: boolean;
  /**
   * Initial world config sent to each client after authentication.
   * See `UpdatableConfig` from `@mml-io/3d-web-experience-client` for the
   * full typed version consumed by the client.
   */
  worldConfig?: WorldConfigPayload;
};

/**
 * Escape a string for safe injection into a JavaScript string literal
 * inside a `<script>` block. All `<` characters are escaped to prevent
 * `</script>` and `<!--` sequences from interfering with HTML parsing.
 * U+2028 and U+2029 are escaped because they are valid in JSON but act
 * as line terminators in JavaScript string literals.
 */
function escapeForJsString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export class Networked3dWebExperienceServer {
  public userNetworkingServer: UserNetworkingServer;

  public mmlDocumentsServer?: MMLDocumentsServer;

  private worldConfig: WorldConfigPayload | undefined;
  private connectionSessionTokens = new Map<number, string>();

  constructor(private config: Networked3dWebExperienceServerConfig) {
    if (this.config.mmlServing) {
      const { documentsWatchPath, documentsDirectoryRoot } = this.config.mmlServing;
      this.mmlDocumentsServer = new MMLDocumentsServer(documentsDirectoryRoot, documentsWatchPath);
    }

    this.worldConfig = this.config.worldConfig;

    this.userNetworkingServer = new UserNetworkingServer({
      onClientConnect: (
        connectionId: number,
        sessionToken: string,
        userIdentityPresentedOnConnection?: UserData,
      ): Promise<UserData | true | Error> | UserData | true | Error => {
        const result = this.config.userAuthenticator.onClientConnect(
          connectionId,
          sessionToken,
          userIdentityPresentedOnConnection,
        );
        if (result !== null && typeof result === "object" && "then" in result) {
          return (result as Promise<UserData | true | Error>).then((resolved) => {
            if (!(resolved instanceof Error)) {
              this.connectionSessionTokens.set(connectionId, sessionToken);
            }
            return resolved;
          });
        }
        if (!(result instanceof Error)) {
          this.connectionSessionTokens.set(connectionId, sessionToken);
        }
        return result;
      },
      onClientUserIdentityUpdate: (connectionId: number, userIdentity: UserIdentityUpdate) => {
        return this.config.userAuthenticator.onClientUserIdentityUpdate(connectionId, userIdentity);
      },
      onClientDisconnect: (connectionId: number): void => {
        this.connectionSessionTokens.delete(connectionId);
        this.config.userAuthenticator.onClientDisconnect(connectionId);
      },
      onClientAuthenticated: (connectionId: number): void => {
        // Send world config immediately — it does not depend on the session auth token
        if (this.worldConfig) {
          this.userNetworkingServer.sendCustomMessageToClient(
            connectionId,
            FROM_SERVER_WORLD_CONFIG_MESSAGE_TYPE,
            JSON.stringify(this.worldConfig),
          );
        }

        // Send session config when the auth token resolves
        const sessionToken = this.connectionSessionTokens.get(connectionId);
        if (sessionToken && this.config.userAuthenticator.getSessionAuthToken) {
          const result = this.config.userAuthenticator.getSessionAuthToken(sessionToken);
          if (result !== null && typeof result === "object" && "then" in result) {
            const expectedToken = sessionToken;
            (result as Promise<string | null>).then(
              (token) => {
                if (
                  token !== null &&
                  this.connectionSessionTokens.get(connectionId) === expectedToken
                ) {
                  const sessionConfig: SessionConfigPayload = { authToken: token };
                  this.userNetworkingServer.sendCustomMessageToClient(
                    connectionId,
                    FROM_SERVER_SESSION_CONFIG_MESSAGE_TYPE,
                    JSON.stringify(sessionConfig),
                  );
                }
              },
              () => {
                // Auth token fetch failed — session config is optional
              },
            );
          } else {
            const token = result as string | null;
            if (token !== null) {
              const sessionConfig: SessionConfigPayload = { authToken: token };
              this.userNetworkingServer.sendCustomMessageToClient(
                connectionId,
                FROM_SERVER_SESSION_CONFIG_MESSAGE_TYPE,
                JSON.stringify(sessionConfig),
              );
            }
          }
        }
      },
      onCustomMessage: (connectionId: number, customType: number, contents: string): void => {
        if (customType === FROM_CLIENT_CHAT_MESSAGE_TYPE) {
          // When enableChat is explicitly set use that, otherwise fall back to
          // the value from worldConfig so that server relay and client UI agree.
          const chatEnabled = this.config.enableChat ?? this.worldConfig?.enableChat ?? true;
          if (!chatEnabled) {
            return;
          }
          const chatMessage = parseClientChatMessage(contents);
          if (chatMessage instanceof Error) {
            console.error(`Invalid chat message from connection ${connectionId}:`, chatMessage);
            // Notify the client that their message was rejected
            const errorPayload: ServerChatMessage = {
              fromConnectionId: 0,
              userId: "",
              message: "[Server] Your message could not be delivered (invalid format).",
            };
            this.userNetworkingServer.sendCustomMessageToClient(
              connectionId,
              FROM_SERVER_CHAT_MESSAGE_TYPE,
              JSON.stringify(errorPayload),
            );
          } else {
            const senderUser = this.userNetworkingServer.getAuthenticatedUser(connectionId);
            const serverChatMessage: ServerChatMessage = {
              fromConnectionId: connectionId,
              userId: senderUser?.userId ?? "",
              message: chatMessage.message.substring(0, MAX_CHAT_MESSAGE_LENGTH),
            };
            this.userNetworkingServer.broadcastMessage(
              FROM_SERVER_CHAT_MESSAGE_TYPE,
              JSON.stringify(serverChatMessage),
            );
          }
        }
      },
      resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
    });
  }

  /**
   * Replace the index HTML content served to new web clients.
   */
  public setIndexContent(indexContent: string) {
    if (this.config.webClientServing) {
      this.config.webClientServing.indexContent = indexContent;
    }
  }

  /**
   * Update whether chat is enabled at runtime.
   */
  public setEnableChat(enabled: boolean) {
    this.config.enableChat = enabled;
  }

  /**
   * Update the world config and optionally broadcast it to all connected clients.
   * Newly connecting clients will receive the updated config after authentication.
   *
   * By default the update is broadcast to all clients. Pass `{ broadcast: false }`
   * to update the stored config without notifying existing clients.
   */
  public setWorldConfig(config: WorldConfigPayload, options?: { broadcast?: boolean }) {
    this.worldConfig = config;
    if (options?.broadcast !== false) {
      this.userNetworkingServer.broadcastMessage(
        FROM_SERVER_WORLD_CONFIG_MESSAGE_TYPE,
        JSON.stringify(this.worldConfig),
      );
    }
  }

  public updateUserCharacter(connectionId: number, userData: UserData) {
    console.log(`Initiate server-side update of connection ${connectionId}`);
    this.userNetworkingServer.updateUserCharacter(connectionId, userData);
  }

  public dispose(error?: UserNetworkingServerError) {
    this.userNetworkingServer.dispose(error);
    if (this.mmlDocumentsServer) {
      this.mmlDocumentsServer.dispose();
    }
    this.connectionSessionTokens.clear();
    this.config.userAuthenticator.dispose?.();
  }

  /**
   * Register all HTTP and WebSocket routes on the given Express application.
   *
   * Accepts either a plain `express.Application` or one that already has
   * `express-ws` applied. If WebSocket support has not been applied yet, this
   * method calls `enableWs()` internally with the required sub-protocol
   * handling. If the application already has a `.ws()` method (i.e. the caller
   * applied `express-ws` themselves), the existing setup is reused.
   */
  registerExpressRoutes(expressApp: express.Application | enableWs.Application) {
    const mmlDocumentsUrl = this.config.mmlServing?.documentsUrl;

    // If the caller already applied express-ws, reuse it; otherwise apply it
    // ourselves with the required handleProtocols configuration.
    let app: enableWs.Application;
    if (typeof (expressApp as enableWs.Application).ws === "function") {
      app = expressApp as enableWs.Application;
    } else {
      ({ app } = enableWs(expressApp, undefined, {
        wsOptions: {
          handleProtocols: (protocols: Set<string>, request: http.IncomingMessage) => {
            if (mmlDocumentsUrl && request.url?.startsWith(mmlDocumentsUrl)) {
              return NetworkedDOM.handleWebsocketSubprotocol(protocols);
            }
            return handleExperienceWebsocketSubprotocol(protocols);
          },
        },
      }));
    }

    app.ws(this.config.networkPath, (ws) => {
      this.userNetworkingServer.connectClient(ws as unknown as WebSocket);
    });

    const webClientServing = this.config.webClientServing;
    if (webClientServing) {
      app.get(webClientServing.indexUrl, async (req: express.Request, res: express.Response) => {
        const result = await this.config.userAuthenticator.generateAuthorizedSessionToken(req);
        if (result === null) {
          res.status(403).send("Access denied: authentication required");
          return;
        }
        if (typeof result === "object" && "redirect" in result) {
          try {
            const redirectUrl = new URL(result.redirect);
            if (redirectUrl.protocol !== "http:" && redirectUrl.protocol !== "https:") {
              console.error("Redirect URL has disallowed scheme:", result.redirect);
              res.send("Error: Invalid redirect URL");
              return;
            }
          } catch {
            console.error("Invalid redirect URL from authenticator:", result.redirect);
            res.send("Error: Invalid redirect URL");
            return;
          }
          res.redirect(result.redirect);
          return;
        }
        // Content negotiation: return JSON for programmatic clients (bridges, bots),
        // HTML for browsers. Same auth path either way.
        if (req.accepts("json") && !req.accepts("html")) {
          res.json({ sessionToken: result });
          return;
        }
        const authorizedDemoIndexContent = webClientServing.indexContent.replace(
          webClientServing.sessionTokenPlaceholder || defaultSessionTokenPlaceholder,
          escapeForJsString(result),
        );
        res.send(authorizedDemoIndexContent);
      });

      app.use(webClientServing.clientUrl, express.static(webClientServing.clientBuildDir));
      if (webClientServing.clientWatchWebsocketPath) {
        websocketDirectoryChangeListener(app, {
          directory: webClientServing.clientBuildDir,
          websocketPath: webClientServing.clientWatchWebsocketPath,
        });
      }
    }

    const mmlDocumentsServer = this.mmlDocumentsServer;
    const mmlServing = this.config.mmlServing;
    // Handle example document sockets
    if (mmlServing && mmlDocumentsServer) {
      app.ws(`${mmlServing.documentsUrl}*`, (ws: ws.WebSocket, req: express.Request) => {
        const path = req.params[0];
        console.log("document requested", { path });
        mmlDocumentsServer.handle(path, ws);
      });
    }

    if (this.config.assetServing) {
      // Serve assets with CORS allowing all origins
      app.use(
        this.config.assetServing.assetsUrl,
        cors(),
        express.static(this.config.assetServing.assetsDir),
      );
    }
  }
}
