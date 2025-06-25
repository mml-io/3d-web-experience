import {
  DeltaNetClientState,
  DeltaNetClientWebsocket,
  DeltaNetClientWebsocketInitialCheckout,
  DeltaNetClientWebsocketStatus,
  DeltaNetClientWebsocketTick,
  DeltaNetClientWebsocketUserIndex,
} from "@deltanet/delta-net-web";

import { DeltaNetComponentMapping } from "./DeltaNetComponentMapping";
import { UserNetworkingClientUpdate, WebsocketFactory, WebsocketStatus } from "./types";
import { CharacterDescription } from "./UserNetworkingMessages";

export type UserNetworkingClientConfig = {
  url: string;
  sessionToken: string;
  websocketFactory: WebsocketFactory;
  statusUpdateCallback: (status: WebsocketStatus) => void;
  assignedIdentity: (clientId: number) => void;
  clientUpdate: (userId: number, update: null | UserNetworkingClientUpdate) => void;
  clientProfileUpdated: (
    id: number,
    username: string,
    characterDescription: CharacterDescription,
    colors: Array<[number, number, number]>,
  ) => void;
  onServerError: (error: { message: string; errorType: string }) => void;
  onServerBroadcast?: (broadcast: { broadcastType: string; payload: any }) => void;
  onCustomMessage?: (customType: number, contents: string) => void;
};

export class UserNetworkingClient {
  private deltaNetClient: DeltaNetClientWebsocket;
  private deltaNetState: DeltaNetClientState;
  private myUserId: number | null = null;
  private myUserIndex: number | null = null;
  private stableIdToUserId: Map<number, number> = new Map();
  private userProfiles: Map<
    number,
    {
      username: string;
      characterDescription: CharacterDescription;
      colors: Array<[number, number, number]>;
    }
  > = new Map();
  private isAuthenticated = false;
  private hasReceivedInitialCheckout = false;
  private pendingUpdate: UserNetworkingClientUpdate | null = null;

  constructor(private config: UserNetworkingClientConfig) {
    this.deltaNetState = new DeltaNetClientState();

    // Create deltanet client
    this.deltaNetClient = new DeltaNetClientWebsocket(
      config.url,
      (url: string) => {
        const ws = config.websocketFactory(url);
        return ws;
      },
      config.sessionToken,
      {
        ignoreData: false,
        onInitialCheckout: (initialCheckout: DeltaNetClientWebsocketInitialCheckout) => {
          const { stateUpdates, removedStableIds } =
            this.deltaNetState.handleInitialCheckout(initialCheckout);

          // Process initial profiles for all users
          this.processInitialProfiles();

          // Process any state updates (though these should just be setting up the initial profiles)
          this.processStateUpdates(stateUpdates);

          // Handle removed users (shouldn't happen during initial checkout, but for consistency)
          this.processRemovedUsers(removedStableIds);

          // Mark that we've received the initial world state
          this.hasReceivedInitialCheckout = true;

          // Now that we have the user IDs, resolve our stable user ID from the userIndex
          if (this.myUserIndex !== null) {
            const userIds = this.deltaNetState.getStableIds();
            if (this.myUserIndex < userIds.length) {
              const stableId = userIds[this.myUserIndex];
              const userId = this.stableIdToUserId.get(stableId);
              if (!userId) {
                throw new Error(`No userId found for stableId ${stableId}`);
              }
              this.myUserId = userId;
              console.log(
                `Resolved userIndex ${this.myUserIndex} to stable userId: ${this.myUserId}`,
              );
            } else {
              console.error(
                `Invalid userIndex ${this.myUserIndex}, userIds length: ${userIds.length}`,
              );
            }
          }

          // Check if we're now fully ready (both authenticated and have world state)
          this.checkIfFullyReady();
        },
        onTick: (tick: DeltaNetClientWebsocketTick) => {
          const { stateUpdates, removedStableIds } = this.deltaNetState.handleTick(tick);

          // Process state updates
          this.processStateUpdates(stateUpdates);

          // Handle removed users
          this.processRemovedUsers(removedStableIds);

          // Process component updates for all users (not just those with state updates)
          this.processComponentUpdates();
        },
        onUserIndex: (userIndex: DeltaNetClientWebsocketUserIndex) => {
          // Store the userIndex and set it on deltanet state
          this.myUserIndex = userIndex.userIndex;
          this.deltaNetState.setLocalIndex(userIndex.userIndex);

          console.log(
            `Received userIndex: ${userIndex.userIndex}, waiting for initial checkout to resolve stable userId...`,
          );

          // Don't resolve to stable user ID yet - wait for initial checkout
          this.checkIfFullyReady();
        },
        onError: (errorType: string, errorMessage: string, retryable: boolean) => {
          console.error(
            "DeltaNet error:",
            errorType,
            "errorMessage:",
            errorMessage,
            "retryable:",
            retryable,
          );
          this.config.onServerError({
            message: errorMessage,
            errorType: errorType,
          });
        },
        onWarning: (warning: string) => {
          console.warn("DeltaNet warning:", warning);
        },
        onServerCustom: (customType: number, contents: string) => {
          // Handle server custom messages
          this.config.onCustomMessage?.(customType, contents);
        },
      },
      undefined, // timeCallback is optional
      (status: DeltaNetClientWebsocketStatus) => {
        // Map deltanet status to websocket status
        let mappedStatus: WebsocketStatus;
        switch (status) {
          case DeltaNetClientWebsocketStatus.Connected:
          case DeltaNetClientWebsocketStatus.ConnectionOpen:
            mappedStatus = WebsocketStatus.Connected;

            // Send initial authentication data immediately upon connection
            this.sendInitialAuthentication();
            break;
          case DeltaNetClientWebsocketStatus.Disconnected:
            mappedStatus = WebsocketStatus.Disconnected;
            this.isAuthenticated = false;
            this.hasReceivedInitialCheckout = false;
            this.myUserId = null;
            this.myUserIndex = null;
            break;
          case DeltaNetClientWebsocketStatus.Reconnecting:
            mappedStatus = WebsocketStatus.Reconnecting;
            break;
          default:
            mappedStatus = WebsocketStatus.Disconnected;
        }
        this.config.statusUpdateCallback(mappedStatus);
      },
    );
  }

  private checkIfFullyReady(): void {
    // We're fully ready when we have userIndex, initial checkout, and resolved stable user ID
    if (
      this.myUserIndex !== null &&
      this.hasReceivedInitialCheckout &&
      this.myUserId !== null &&
      !this.isAuthenticated
    ) {
      console.log(
        `Client fully ready - userIndex: ${this.myUserIndex}, stable userId: ${this.myUserId}, initial checkout received`,
      );

      this.isAuthenticated = true;
      this.config.assignedIdentity(this.myUserId);

      // If there was a pending update, send it now
      if (this.pendingUpdate) {
        this.sendUpdate(this.pendingUpdate);
        this.pendingUpdate = null;
      }
    }
  }

  private sendInitialAuthentication(): void {
    // Send initial components and states to become "ready"
    // Start with default position and state
    const initialUpdate: UserNetworkingClientUpdate = {
      id: 0, // Will be set by server when we get userIndex
      position: { x: 0, y: 0, z: 0 },
      rotation: { quaternionY: 0, quaternionW: 1 },
      state: 0,
    };

    // Convert to deltanet components
    const components = DeltaNetComponentMapping.toComponents(initialUpdate);

    // Create initial states for user data (no session token needed here)
    // Add empty username and character description for now
    const states = DeltaNetComponentMapping.toStates("", { meshFileUrl: "" }, []);

    // Send to deltanet - this makes the client "ready" and triggers authentication
    // The session token is now passed via the deltanet token field
    this.deltaNetClient.setUserComponents(components, states);
  }

  private processInitialProfiles(): void {
    // Process initial profiles for all users
    for (const [stableUserId, userInfo] of this.deltaNetState.byStableId) {
      if (userInfo.states.size > 0) {
        const nonNullStates = new Map<number, Uint8Array>();
        for (const [stateId, stateValue] of userInfo.states) {
          nonNullStates.set(stateId, stateValue);
        }

        if (nonNullStates.size > 0) {
          const { username, characterDescription, colors } =
            DeltaNetComponentMapping.fromStates(nonNullStates);

          console.log(`Initial profile for user ${stableUserId}:`, {
            username,
            characterDescription,
            colors,
          });

          this.userProfiles.set(stableUserId, {
            username: username ?? "",
            characterDescription: characterDescription ?? { meshFileUrl: "" },
            colors: colors ?? [],
          });
          this.config.clientProfileUpdated(
            stableUserId,
            username ?? "",
            characterDescription ?? { meshFileUrl: "" },
            colors ?? [],
          );
        }
      }
    }
    console.log(`Loaded ${this.userProfiles.size} initial user profiles`);
  }

  private processComponentUpdates(): void {
    // Process component updates for all users
    for (const [stableUserId, userInfo] of this.deltaNetState.byStableId) {
      if (userInfo.components.size > 0) {
        const clientUpdate = DeltaNetComponentMapping.fromComponents(
          userInfo.components,
          stableUserId,
        );
        const userId = this.stableIdToUserId.get(stableUserId);
        if (!userId) {
          throw new Error(`No userId found for stableUserId ${stableUserId}`);
        }
        this.config.clientUpdate(userId, clientUpdate);
      }
    }
  }

  private processStateUpdates(
    stateUpdates: Array<{ stableId: number; stateId: number; state: Uint8Array | null }>,
  ): void {
    const processedUsers = new Set<number>();

    for (const update of stateUpdates) {
      // update.stableId is actually a stable user ID maintained by deltanet, not an index
      const stableUserId = update.stableId;

      console.log({ update });

      if (!processedUsers.has(stableUserId)) {
        processedUsers.add(stableUserId);

        const userInfo = this.deltaNetState.byStableId.get(stableUserId);
        if (userInfo) {
          // Extract username and character description from states
          if (userInfo.states.size > 0) {
            const { userId, username, characterDescription, colors } =
              DeltaNetComponentMapping.fromStates(userInfo.states);

            // Check if this is actually a profile change
            const existingProfile = this.userProfiles.get(userId);
            const profileChanged =
              !existingProfile ||
              existingProfile.username !== username ||
              JSON.stringify(existingProfile.characterDescription) !==
                JSON.stringify(characterDescription) ||
                JSON.stringify(existingProfile.colors) !== JSON.stringify(colors);

            if (profileChanged) {
              console.log(`Profile changed for user ${userId}:`, {
                username,
                characterDescription,
              });
              this.stableIdToUserId.set(stableUserId, userId);
              this.userProfiles.set(userId, {
                username: username ?? "",
                characterDescription: characterDescription ?? { meshFileUrl: "" },
                colors: colors ?? [],
              });
              this.config.clientProfileUpdated(
                userId,
                username ?? "",
                characterDescription ?? { meshFileUrl: "" },
                colors ?? [],
              );
            }
            console.log(`Total user profiles now:`, this.userProfiles.size);
          }
        } else {
          console.log(`No user info found for user ${stableUserId}`);
        }
      }
    }
  }

  private processRemovedUsers(removedStableIds: number[]): void {
    // Handle removed users by notifying the client with null updates
    for (const stableId of removedStableIds) {
      const userId = this.stableIdToUserId.get(stableId);
      if (userId) {
        console.log(`User ${userId} disconnected, removing from client`);

        // Remove from user profiles
        this.userProfiles.delete(userId);

        // Notify the client about the disconnection
        this.config.clientUpdate(userId, null);

        // Remove from stableIdToUserId
        this.stableIdToUserId.delete(stableId);
      }
    }
  }

  public sendUpdate(update: UserNetworkingClientUpdate): void {
    if (!this.isAuthenticated || this.myUserId === null) {
      // Store the update to send after authentication
      this.pendingUpdate = update;
      return;
    }

    // Convert to deltanet components and send
    const components = DeltaNetComponentMapping.toComponents(update);
    this.deltaNetClient.setUserComponents(components, new Map());
  }

  public sendCustomMessage(customType: number, contents: string): void {
    if (!this.isAuthenticated || this.myUserId === null) {
      console.warn("Cannot send custom message before authentication");
      return;
    }

    this.deltaNetClient.sendCustomMessage(customType, contents);
  }

  public updateUserProfile(
    username?: string,
    characterDescription?: CharacterDescription,
    colors?: Array<[number, number, number]>,
  ): void {
    if (!this.isAuthenticated || this.myUserId === null) {
      return;
    }

    // Update user profile by sending new states
    const states = DeltaNetComponentMapping.toStates(username, characterDescription, colors);
    const components = this.pendingUpdate
      ? DeltaNetComponentMapping.toComponents(this.pendingUpdate)
      : new Map();

    this.deltaNetClient.setUserComponents(components, states);
  }

  public stop(): void {
    // Clean up deltanet client
    // Note: DeltaNetClientWebsocket doesn't have a public stop method,
    // but closing will be handled by the underlying websocket
  }
}
