import {
  experienceProtocolToDeltaNetSubProtocol,
  FROM_CLIENT_CHAT_MESSAGE_TYPE,
  FROM_SERVER_CHAT_MESSAGE_TYPE,
  FROM_SERVER_BROADCAST_MESSAGE_TYPE,
  FROM_SERVER_SESSION_CONFIG_MESSAGE_TYPE,
  FROM_SERVER_WORLD_CONFIG_MESSAGE_TYPE,
  parseServerBroadcastMessage,
  parseServerChatMessage,
  parseSessionConfigPayload,
  parseWorldConfigPayload,
  type SessionConfigPayload,
  type WorldConfigPayload,
} from "@mml-io/3d-web-experience-protocol";
import {
  UserNetworkingClient,
  type UserNetworkingClientUpdate,
  type CharacterDescription,
  type UserData,
  type NetworkUpdate,
  WebsocketStatus,
  DeltaNetServerErrors,
} from "@mml-io/3d-web-user-networking";

export type { SessionConfigPayload, WorldConfigPayload } from "@mml-io/3d-web-experience-protocol";

export type OtherUser = {
  userId: string;
  username: string | null;
  characterDescription: CharacterDescription | null;
  colors: Array<[number, number, number]> | null;
  position: { x: number; y: number; z: number };
};

export type ChatMessage = {
  fromConnectionId: number;
  userId: string;
  username: string;
  message: string;
  timestamp: number;
};

export type WorldEvent =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "reconnecting" }
  | { type: "identity_assigned"; connectionId: number }
  | { type: "server_error"; errorType: string; message: string }
  | { type: "chat"; message: ChatMessage }
  | {
      type: "user_joined";
      connectionId: number;
      userId: string;
      username: string | null;
      position: { x: number; y: number; z: number };
    }
  | { type: "user_left"; connectionId: number; userId: string; username: string | null }
  | { type: "session_config"; config: SessionConfigPayload }
  | { type: "world_config"; config: WorldConfigPayload }
  | { type: "server_broadcast"; broadcastType: string; payload: Record<string, unknown> }
  | { type: "network_update"; update: NetworkUpdate };

export type WorldConnectionConfig = {
  url: string;
  sessionToken: string;
  websocketFactory: (url: string) => WebSocket;
  initialUserState?: UserData;
  initialPosition?: { x: number; y: number; z: number };
  initialRotation?: { eulerY: number };
};

const MAX_CHAT_HISTORY = 100;

export class WorldConnection {
  private client: UserNetworkingClient;
  private otherUsers = new Map<number, OtherUser>();
  private chatHistory: ChatMessage[] = [];
  private eventListeners: Array<(event: WorldEvent) => void> = [];
  private myConnectionId: number | null = null;
  private connected = false;
  private username: string | null;

  private connectPromise: Promise<void>;
  private resolveConnect!: () => void;
  private rejectConnect!: (err: Error) => void;
  private connectSettled = false;

  private worldConfigResolve: ((config: WorldConfigPayload) => void) | null = null;
  private worldConfigPromise: Promise<WorldConfigPayload> | null = null;
  private latestWorldConfig: WorldConfigPayload | null = null;

  constructor(config: WorldConnectionConfig) {
    this.connectPromise = new Promise((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });
    // Prevent unhandled rejection if stop() is called before waitForConnection()
    this.connectPromise.catch(() => {});

    const initialUserState: UserData = config.initialUserState ?? {
      userId: "",
      username: null,
      characterDescription: null,
      colors: null,
    };
    this.username = initialUserState.username;

    const initialPosition = config.initialPosition ?? { x: 0, y: 0, z: 0 };
    const initialRotation = config.initialRotation ?? { eulerY: 0 };

    this.client = new UserNetworkingClient(
      {
        url: config.url,
        sessionToken: config.sessionToken,
        websocketFactory: config.websocketFactory,
        statusUpdateCallback: (status: WebsocketStatus) => {
          if (status === WebsocketStatus.Connected) {
            this.connected = true;
            console.log("[world] Connected to server");
            if (!this.connectSettled) {
              this.connectSettled = true;
              this.resolveConnect();
            }
            this.emitEvent({ type: "connected" });
          } else if (
            status === WebsocketStatus.Disconnected ||
            status === WebsocketStatus.Reconnecting
          ) {
            this.connected = false;
            this.otherUsers.clear();
            this.myConnectionId = null;
            // Reset world config state so that a fresh config is required
            // after reconnection. Without this, waitForWorldConfig() would
            // immediately return the stale config from the previous session.
            this.latestWorldConfig = null;
            this.worldConfigPromise = null;
            this.worldConfigResolve = null;
            console.log(
              `[world] ${status === WebsocketStatus.Disconnected ? "Disconnected from" : "Reconnecting to"} server`,
            );
            if (status === WebsocketStatus.Disconnected && !this.connectSettled) {
              this.connectSettled = true;
              this.client.stop();
              this.rejectConnect(
                new Error("WebSocket disconnected before connection was established"),
              );
            }
            if (status === WebsocketStatus.Reconnecting) {
              this.emitEvent({ type: "reconnecting" });
            }
            this.emitEvent({ type: "disconnected" });
          }
        },
        assignedIdentity: (connectionId: number) => {
          this.myConnectionId = connectionId;
          console.log(`[world] Assigned connection ID: ${connectionId}`);
          this.emitEvent({ type: "identity_assigned", connectionId });
        },
        onServerError: (error: { message: string; errorType: string }) => {
          console.error(`[world] Server error (${error.errorType}): ${error.message}`);
          this.emitEvent({
            type: "server_error",
            errorType: error.errorType,
            message: error.message,
          });
          if (!this.connectSettled) {
            this.connectSettled = true;
            switch (error.errorType) {
              case DeltaNetServerErrors.USER_AUTHENTICATION_FAILED_ERROR_TYPE:
                this.rejectConnect(new Error(`Authentication failed: ${error.message}`));
                break;
              case DeltaNetServerErrors.USER_NETWORKING_CONNECTION_LIMIT_REACHED_ERROR_TYPE:
                this.rejectConnect(new Error(`Connection limit reached: ${error.message}`));
                break;
              case DeltaNetServerErrors.USER_NETWORKING_SERVER_SHUTDOWN_ERROR_TYPE:
                console.error("[world] Server shutting down");
                this.rejectConnect(new Error(`Server shutting down: ${error.message}`));
                break;
              default:
                this.rejectConnect(new Error(error.message));
            }
          } else {
            if (
              error.errorType === DeltaNetServerErrors.USER_NETWORKING_SERVER_SHUTDOWN_ERROR_TYPE
            ) {
              console.error("[world] Server shutting down");
            }
          }
        },
        onCustomMessage: (customType: number, contents: string) => {
          if (customType === FROM_SERVER_CHAT_MESSAGE_TYPE) {
            const parsed = parseServerChatMessage(contents);
            if (parsed instanceof Error) {
              console.error("[world] Invalid chat message:", parsed.message);
              return;
            }
            let username: string;
            if (parsed.fromConnectionId === this.myConnectionId) {
              username = this.username ?? `User ${parsed.fromConnectionId}`;
            } else {
              const user = this.otherUsers.get(parsed.fromConnectionId);
              username = user?.username ?? `User ${parsed.fromConnectionId}`;
            }
            const chatMsg: ChatMessage = {
              fromConnectionId: parsed.fromConnectionId,
              userId: parsed.userId,
              username,
              message: parsed.message,
              timestamp: Date.now(),
            };
            this.chatHistory.push(chatMsg);
            if (this.chatHistory.length > MAX_CHAT_HISTORY) {
              this.chatHistory.shift();
            }
            console.log(`[chat] ${username}: ${parsed.message}`);

            this.emitEvent({ type: "chat", message: chatMsg });
          } else if (customType === FROM_SERVER_SESSION_CONFIG_MESSAGE_TYPE) {
            const parsedConfig = parseSessionConfigPayload(contents);
            if (parsedConfig instanceof Error) {
              console.error("[world] Invalid session config message:", parsedConfig.message);
            } else {
              console.log("[world] Received session config from server");
              this.emitEvent({ type: "session_config", config: parsedConfig });
            }
          } else if (customType === FROM_SERVER_WORLD_CONFIG_MESSAGE_TYPE) {
            const parsedConfig = parseWorldConfigPayload(contents);
            if (parsedConfig instanceof Error) {
              console.error("[world] Invalid world config message:", parsedConfig.message);
            } else {
              console.log("[world] Received world config from server");
              this.latestWorldConfig = parsedConfig;
              if (this.worldConfigResolve) {
                this.worldConfigResolve(parsedConfig);
                this.worldConfigResolve = null;
              }
              this.emitEvent({ type: "world_config", config: parsedConfig });
            }
          } else if (customType === FROM_SERVER_BROADCAST_MESSAGE_TYPE) {
            const broadcastMessage = parseServerBroadcastMessage(contents);
            if (broadcastMessage instanceof Error) {
              console.error(`[world] Invalid server broadcast message: ${contents}`);
            } else {
              console.log(
                `[world] Server broadcast (${broadcastMessage.broadcastType}):`,
                broadcastMessage.payload,
              );
              this.emitEvent({
                type: "server_broadcast",
                broadcastType: broadcastMessage.broadcastType,
                payload: broadcastMessage.payload,
              });
            }
          } else {
            console.warn(`[world] Unrecognised custom message type ${customType}`);
          }
        },
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
        onUpdate: (update: NetworkUpdate) => {
          for (const id of update.removedConnectionIds) {
            const leaving = this.otherUsers.get(id);
            this.otherUsers.delete(id);
            if (id !== this.myConnectionId) {
              this.emitEvent({
                type: "user_left",
                connectionId: id,
                userId: leaving?.userId ?? "",
                username: leaving?.username ?? null,
              });
            }
          }

          for (const [id, added] of update.addedConnectionIds) {
            if (id === this.myConnectionId) continue;
            const position = {
              x: added.components.position.x,
              y: added.components.position.y,
              z: added.components.position.z,
            };
            const userState = added.userState;
            this.otherUsers.set(id, {
              userId: userState?.userId ?? "",
              username: userState?.username ?? null,
              characterDescription: userState?.characterDescription ?? null,
              colors: userState?.colors ?? null,
              position,
            });
            this.emitEvent({
              type: "user_joined",
              connectionId: id,
              userId: userState?.userId ?? "",
              username: userState?.username ?? null,
              position,
            });
          }

          for (const [id, updated] of update.updatedUsers) {
            if (id === this.myConnectionId) continue;
            const existing = this.otherUsers.get(id);
            if (existing) {
              if (updated.userState?.userId !== undefined) {
                existing.userId = updated.userState.userId;
              }
              if (updated.userState?.username !== undefined) {
                existing.username = updated.userState.username;
              }
              if (updated.userState?.characterDescription !== undefined) {
                existing.characterDescription = updated.userState.characterDescription;
              }
              if (updated.userState?.colors !== undefined) {
                existing.colors = updated.userState.colors;
              }
              existing.position = {
                x: updated.components.position.x,
                y: updated.components.position.y,
                z: updated.components.position.z,
              };
            } else {
              this.otherUsers.set(id, {
                userId: updated.userState?.userId ?? "",
                username: updated.userState?.username ?? null,
                characterDescription: updated.userState?.characterDescription ?? null,
                colors: updated.userState?.colors ?? null,
                position: {
                  x: updated.components.position.x,
                  y: updated.components.position.y,
                  z: updated.components.position.z,
                },
              });
            }
          }

          this.emitEvent({ type: "network_update", update });
        },
      },
      initialUserState,
      {
        position: initialPosition,
        rotation: initialRotation,
        state: 0,
      },
    );
  }

  stop(): void {
    this.client.stop();
    this.eventListeners = [];

    // Settle any pending promises so callers are not left hanging.
    if (!this.connectSettled) {
      this.connectSettled = true;
      this.rejectConnect(new Error("WorldConnection stopped"));
    }
    this.worldConfigResolve = null;
    this.worldConfigPromise = null;
  }

  /**
   * Returns a promise that settles once for the **initial** connection attempt.
   * It resolves when the first `Connected` status is received, or rejects if
   * the connection fails before being established.
   *
   * This promise does **not** re-settle on reconnection. To react to
   * subsequent connection/disconnection events, use {@link addEventListener}
   * and listen for `"connected"` / `"disconnected"` / `"reconnecting"` events.
   */
  waitForConnection(): Promise<void> {
    return this.connectPromise;
  }

  /**
   * Wait for the server to send a world config message.
   *
   * The server pushes this over WebSocket after authentication. If the config
   * has already been received, the returned promise resolves immediately with
   * the cached value (so callers never miss a config that arrived before they
   * called this method).
   *
   * Multiple concurrent callers share a single internal promise that resolves
   * when the config arrives. Each caller gets an independent timeout --- if the
   * timeout fires, that caller receives `null` but other callers with longer
   * timeouts (or the shared promise itself) are unaffected.
   *
   * @returns The world config, or `null` if the timeout expires first.
   */
  waitForWorldConfig(timeoutMs: number = 10000): Promise<WorldConfigPayload | null> {
    if (this.latestWorldConfig) {
      return Promise.resolve(this.latestWorldConfig);
    }

    if (!this.worldConfigPromise) {
      this.worldConfigPromise = new Promise<WorldConfigPayload>((resolve) => {
        this.worldConfigResolve = resolve;
      });
    }

    return new Promise<WorldConfigPayload | null>((resolve) => {
      const timer = setTimeout(() => {
        resolve(null);
      }, timeoutMs);

      this.worldConfigPromise!.then((config) => {
        clearTimeout(timer);
        resolve(config);
      });
    });
  }

  getWorldConfig(): WorldConfigPayload | null {
    return this.latestWorldConfig;
  }

  sendUpdate(update: UserNetworkingClientUpdate): void {
    if (this.connected) {
      this.client.sendUpdate(update);
    }
  }

  getOtherUsers(): Array<{ connectionId: number } & OtherUser> {
    const result: Array<{ connectionId: number } & OtherUser> = [];
    for (const [connectionId, user] of this.otherUsers) {
      result.push({ connectionId, ...user });
    }
    return result;
  }

  getConnectionId(): number | null {
    return this.myConnectionId;
  }

  getUsername(): string | null {
    return this.username;
  }

  isConnected(): boolean {
    return this.connected;
  }

  sendChatMessage(message: string): void {
    if (!this.connected) return;
    this.client.sendCustomMessage(FROM_CLIENT_CHAT_MESSAGE_TYPE, JSON.stringify({ message }));
  }

  sendCustomMessage(customType: number, contents: string): void {
    if (!this.connected) return;
    this.client.sendCustomMessage(customType, contents);
  }

  updateUsername(username: string): void {
    this.username = username;
    this.client.updateUsername(username);
  }

  updateCharacterDescription(characterDescription: CharacterDescription): void {
    this.client.updateCharacterDescription(characterDescription);
  }

  updateColors(colors: Array<[number, number, number]>): void {
    this.client.updateColors(colors);
  }

  getChatHistory(since?: number): ChatMessage[] {
    if (since !== undefined) {
      return this.chatHistory.filter((m) => m.timestamp >= since);
    }
    return [...this.chatHistory];
  }

  addEventListener(listener: (event: WorldEvent) => void): void {
    this.eventListeners.push(listener);
  }

  removeEventListener(listener: (event: WorldEvent) => void): void {
    const idx = this.eventListeners.indexOf(listener);
    if (idx !== -1) this.eventListeners.splice(idx, 1);
  }

  private emitEvent(event: WorldEvent): void {
    for (const listener of [...this.eventListeners]) {
      listener(event);
    }
  }
}
