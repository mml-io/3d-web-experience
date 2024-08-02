import {
  CHAT_NETWORKING_SERVER_ERROR_MESSAGE_TYPE,
  CHAT_NETWORKING_SERVER_SHUTDOWN_ERROR_TYPE,
  ChatNetworkingServer,
} from "@mml-io/3d-web-text-chat";
import {
  USER_NETWORKING_SERVER_ERROR_MESSAGE_TYPE,
  USER_NETWORKING_SERVER_SHUTDOWN_ERROR_TYPE,
  UserData,
  UserIdentity,
  UserNetworkingServer,
} from "@mml-io/3d-web-user-networking";
import cors from "cors";
import express from "express";
import enableWs from "express-ws";
import WebSocket from "ws";

import { MMLDocumentsServer } from "./MMLDocumentsServer";
import { websocketDirectoryChangeListener } from "./websocketDirectoryChangeListener";

type UserAuthenticator = {
  generateAuthorizedSessionToken(req: express.Request): Promise<string | null>;
  getClientIdForSessionToken: (sessionToken: string) => {
    id: number;
  } | null;
  onClientConnect(
    clientId: number,
    sessionToken: string,
    userIdentityPresentedOnConnection?: UserIdentity,
  ): Promise<UserData | null> | UserData | null;
  onClientUserIdentityUpdate(clientId: number, userIdentity: UserIdentity): UserData | null;
  onClientDisconnect(clientId: number): void;
};

export const defaultSessionTokenPlaceholder = "SESSION.TOKEN.PLACEHOLDER";

export type Networked3dWebExperienceServerConfig = {
  connectionLimit?: number;
  networkPath: string;
  webClientServing: {
    indexUrl: string;
    indexContent: string;
    sessionTokenPlaceholder?: string;

    clientBuildDir: string;
    clientUrl: string;
    clientWatchWebsocketPath?: string;
  };
  chatNetworkPath?: string;
  assetServing?: {
    assetsDir: string;
    assetsUrl: string;
  };
  mmlServing?: {
    documentsWatchPath: string;
    documentsUrl: string;
  };
  userAuthenticator: UserAuthenticator;
};

export class Networked3dWebExperienceServer {
  private userNetworkingServer: UserNetworkingServer;

  private chatNetworkingServer?: ChatNetworkingServer;

  private mmlDocumentsServer?: MMLDocumentsServer;

  constructor(private config: Networked3dWebExperienceServerConfig) {
    if (this.config.mmlServing) {
      this.mmlDocumentsServer = new MMLDocumentsServer(this.config.mmlServing.documentsWatchPath);
    }

    setInterval(() => {
      // TODO - remove before PR
      if (this.userNetworkingServer) {
        this.userNetworkingServer.broadcastMessage("useful_info", {
          avatarConfiguration: {
            allowCustomAvatars: Math.random() > 0.5,
            availableAvatars:
              Math.random() > 0.5
                ? []
                : [
                    {
                      name: "Test Avatar",
                      mmlCharacterUrl: "https://mmlstorage.com/CObH6F/1715268905445.html",
                    },
                  ],
          },
          enableTweakPane: Math.random() > 0.5,
          chatNetworkAddress: Math.random() > 0.5 ? "ws://localhost:8080/chat-network" : null,
          environmentConfiguration: {
            ambientLight: {
              intensity: Math.random(),
            },
            sun: {
              intensity: Math.random(),
              polarAngle: Math.random() * 360,
              azimuthAngle: Math.random() * 360,
            },
            envMap: { intensity: Math.random() },
            postProcessing: {
              bloomIntensity: Math.random() > 0.5,
            },
            skybox:
              Math.random() > 0.5
                ? {
                    hdrJpgUrl: "http://localhost:8080/assets/hdr/puresky_2k.jpg",
                  }
                : {
                    hdrUrl: "http://localhost:8080/assets/hdr/puresky_2k.hdr",
                  },
            groundPlane: Math.random() > 0.2,
          },
          mmlDocuments: {
            "0": {
              name: "Test Document",
              url: "ws://localhost:8080/mml-documents/example-mml.html",
              position: {
                x: Math.random() * 10,
                y: 0,
                z: 5,
              },
            },
            ...(Math.random() > 0.5
              ? {
                  "1": {
                    name: "Test Document 2",
                    url: "ws://localhost:8080/mml-documents/example-mml.html",
                    position: {
                      x: Math.random() * 10,
                      y: 0,
                      z: 5,
                    },
                    rotation: {
                      x: 0,
                      y: Math.random() * 360,
                      z: 0,
                    },
                  },
                }
              : {}),
          },
        });
      }
    }, 3000);

    if (this.config.chatNetworkPath) {
      this.chatNetworkingServer = new ChatNetworkingServer({
        getChatUserIdentity: (sessionToken: string) => {
          return this.config.userAuthenticator.getClientIdForSessionToken(sessionToken);
        },
      });
    }

    this.userNetworkingServer = new UserNetworkingServer({
      connectionLimit: config.connectionLimit,
      onClientConnect: (
        clientId: number,
        sessionToken: string,
        userIdentityPresentedOnConnection?: UserIdentity,
      ): Promise<UserData | null> | UserData | null => {
        return this.config.userAuthenticator.onClientConnect(
          clientId,
          sessionToken,
          userIdentityPresentedOnConnection,
        );
      },
      onClientUserIdentityUpdate: (
        clientId: number,
        userIdentity: UserIdentity,
      ): UserData | null => {
        // Called whenever a user connects or updates their character/identity
        return this.config.userAuthenticator.onClientUserIdentityUpdate(clientId, userIdentity);
      },
      onClientDisconnect: (clientId: number): void => {
        this.config.userAuthenticator.onClientDisconnect(clientId);
        // Disconnect the corresponding chat client to avoid later conflicts of client ids
        if (this.chatNetworkingServer) {
          this.chatNetworkingServer.disconnectClientId(clientId);
        }
      },
    });
  }

  public updateUserCharacter(clientId: number, userData: UserData) {
    console.log(`Initiate server-side update of client ${clientId}`);
    this.userNetworkingServer.updateUserCharacter(clientId, userData);
  }

  public dispose(errorMessage?: string) {
    this.userNetworkingServer.dispose(
      errorMessage
        ? {
            type: USER_NETWORKING_SERVER_ERROR_MESSAGE_TYPE,
            errorType: USER_NETWORKING_SERVER_SHUTDOWN_ERROR_TYPE,
            message: errorMessage,
          }
        : undefined,
    );
    if (this.chatNetworkingServer) {
      this.chatNetworkingServer.dispose(
        errorMessage
          ? {
              type: CHAT_NETWORKING_SERVER_ERROR_MESSAGE_TYPE,
              errorType: CHAT_NETWORKING_SERVER_SHUTDOWN_ERROR_TYPE,
              message: errorMessage,
            }
          : undefined,
      );
    }
    if (this.mmlDocumentsServer) {
      this.mmlDocumentsServer.dispose();
    }
  }

  registerExpressRoutes(app: enableWs.Application) {
    app.ws(this.config.networkPath, (ws) => {
      this.userNetworkingServer.connectClient(ws);
    });

    if (this.config.chatNetworkPath && this.chatNetworkingServer) {
      const chatServer = this.chatNetworkingServer;
      app.ws(this.config.chatNetworkPath, (ws) => {
        chatServer.connectClient(ws);
      });
    }

    const webClientServing = this.config.webClientServing;
    if (webClientServing) {
      app.get(webClientServing.indexUrl, async (req: express.Request, res: express.Response) => {
        const token = await this.config.userAuthenticator.generateAuthorizedSessionToken(req);
        if (!token) {
          res.send("Error: Could not generate token");
          return;
        }
        const authorizedDemoIndexContent = webClientServing.indexContent.replace(
          webClientServing.sessionTokenPlaceholder || defaultSessionTokenPlaceholder,
          token,
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
      app.ws(`${mmlServing.documentsUrl}:filename`, (ws: WebSocket, req: express.Request) => {
        const { filename } = req.params;
        mmlDocumentsServer.handle(filename, ws);
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
