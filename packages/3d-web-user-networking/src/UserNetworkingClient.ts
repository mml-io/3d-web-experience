import { deltaNetProtocolSubProtocol_v0_1 } from "@deltanet/delta-net-protocol";
import {
  DeltaNetClientState,
  DeltaNetClientWebsocket,
  DeltaNetClientWebsocketInitialCheckout,
  DeltaNetClientWebsocketStatus,
  DeltaNetClientWebsocketTick,
  DeltaNetClientWebsocketUserIndex,
} from "@deltanet/delta-net-web";

import { DeltaNetComponentMapping } from "./DeltaNetComponentMapping";
import { WebsocketFactory, WebsocketStatus } from "./ReconnectingWebSocket";
import { UserNetworkingClientUpdate } from "./UserNetworkingCodec";
import {
  CharacterDescription,
  FromUserNetworkingClientMessage,
  USER_NETWORKING_USER_AUTHENTICATE_MESSAGE_TYPE,
  UserNetworkingServerErrorType,
} from "./UserNetworkingMessages";

export type UserNetworkingClientConfig = {
  url: string;
  sessionToken: string;
  websocketFactory: WebsocketFactory;
  statusUpdateCallback: (status: WebsocketStatus) => void;
  assignedIdentity: (clientId: number) => void;
  clientUpdate: (id: number, update: null | UserNetworkingClientUpdate) => void;
  clientProfileUpdated: (
    id: number,
    username: string,
    characterDescription: CharacterDescription,
    colors: Array<[number, number, number]>,
  ) => void;
  onServerError: (error: { message: string; errorType: UserNetworkingServerErrorType }) => void;
  onServerBroadcast?: (broadcast: { broadcastType: string; payload: any }) => void;
};

export class UserNetworkingClient {
  private deltaNetClient: DeltaNetClientWebsocket;
  private deltaNetState: DeltaNetClientState;
  private myUserId: number | null = null;
  private myUserIndex: number | null = null;
  private userProfiles: Map<
    number,
    { username: string; characterDescription: CharacterDescription; colors: Array<[number, number, number]> }
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
          const { stateUpdates, removedUserIds } = this.deltaNetState.handleInitialCheckout(initialCheckout);
          
          // Process initial profiles for all users
          this.processInitialProfiles();
          
          // Process any state updates (though these should just be setting up the initial profiles)
          this.processStateUpdates(stateUpdates);
          
          // Handle removed users (shouldn't happen during initial checkout, but for consistency)
          this.processRemovedUsers(removedUserIds);
          
          // Mark that we've received the initial world state
          this.hasReceivedInitialCheckout = true;
          
          // Now that we have the user IDs, resolve our stable user ID from the userIndex
          if (this.myUserIndex !== null) {
            const userIds = this.deltaNetState.getUserIds();
            if (this.myUserIndex < userIds.length) {
              this.myUserId = userIds[this.myUserIndex];
              console.log(`Resolved userIndex ${this.myUserIndex} to stable userId: ${this.myUserId}`);
            } else {
              console.error(`Invalid userIndex ${this.myUserIndex}, userIds length: ${userIds.length}`);
            }
          }
          
          // Check if we're now fully ready (both authenticated and have world state)
          this.checkIfFullyReady();
        },
        onTick: (tick: DeltaNetClientWebsocketTick) => {
          const { stateUpdates, removedUserIds } = this.deltaNetState.handleTick(tick);
          
          // Process state updates
          this.processStateUpdates(stateUpdates);
          
          // Handle removed users
          this.processRemovedUsers(removedUserIds);
          
          // Process component updates for all users (not just those with state updates)
          this.processComponentUpdates();
        },
        onUserIndex: (userIndex: DeltaNetClientWebsocketUserIndex) => {
          // Store the userIndex and set it on deltanet state
          this.myUserIndex = userIndex.userIndex;
          this.deltaNetState.setUserIndex(userIndex.userIndex);
          
          console.log(`Received userIndex: ${userIndex.userIndex}, waiting for initial checkout to resolve stable userId...`);
          
          // Don't resolve to stable user ID yet - wait for initial checkout
          this.checkIfFullyReady();
        },
        onError: (error: string, retryable: boolean) => {
          console.error("DeltaNet error:", error, "retryable:", retryable);
          this.config.onServerError({
            message: error,
            errorType: "UNKNOWN_ERROR" as UserNetworkingServerErrorType,
          });
        },
        onWarning: (warning: string) => {
          console.warn("DeltaNet warning:", warning);
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
    if (this.myUserIndex !== null && this.hasReceivedInitialCheckout && this.myUserId !== null && !this.isAuthenticated) {
      console.log(`Client fully ready - userIndex: ${this.myUserIndex}, stable userId: ${this.myUserId}, initial checkout received`);
      
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
    for (const [stableUserId, userInfo] of this.deltaNetState.byUserId) {
      if (userInfo.states.size > 0) {
        // Filter out null values from states
        const nonNullStates = new Map<number, Uint8Array>();
        for (const [stateId, stateValue] of userInfo.states) {
          if (stateValue !== null) {
            nonNullStates.set(stateId, stateValue);
          }
        }

        if (nonNullStates.size > 0) {
          const { username, characterDescription, colors } =
            DeltaNetComponentMapping.fromStates(nonNullStates);
          
          console.log(`Initial profile for user ${stableUserId}:`, { username, characterDescription });
          
          this.userProfiles.set(stableUserId, { username, characterDescription, colors });
          this.config.clientProfileUpdated(stableUserId, username, characterDescription, colors);
        }
      }
    }
    console.log(`Loaded ${this.userProfiles.size} initial user profiles`);
  }

  private processComponentUpdates(): void {
    // Process component updates for all users
    for (const [stableUserId, userInfo] of this.deltaNetState.byUserId) {
      if (userInfo.components.size > 0) {
        const clientUpdate = DeltaNetComponentMapping.fromComponents(
          userInfo.components,
          stableUserId,
        );
        this.config.clientUpdate(stableUserId, clientUpdate);
      }
    }
  }

  private processStateUpdates(
    stateUpdates: Array<{ userId: number; stateId: number; state: Uint8Array | null }>,
  ): void {
    const processedUsers = new Set<number>();

    for (const update of stateUpdates) {
      // update.userId is actually a stable user ID maintained by deltanet, not an index
      const stableUserId = update.userId;
      
      if (!processedUsers.has(stableUserId)) {
        processedUsers.add(stableUserId);

        const userInfo = this.deltaNetState.byUserId.get(stableUserId);
        if (userInfo) {
          // Extract username and character description from states
          if (userInfo.states.size > 0) {
            // Filter out null values from states
            const nonNullStates = new Map<number, Uint8Array>();
            for (const [stateId, stateValue] of userInfo.states) {
              if (stateValue !== null) {
                nonNullStates.set(stateId, stateValue);
              }
            }

            if (nonNullStates.size > 0) {
              const { username, characterDescription, colors } =
                DeltaNetComponentMapping.fromStates(nonNullStates);
              
              // TODO - do a cleaner way to check if this is a partial profile change
              const existingProfile = this.userProfiles.get(stableUserId);
              const profileChanged = !existingProfile || 
                existingProfile.username !== username || 
                JSON.stringify(existingProfile.characterDescription) !== JSON.stringify(characterDescription) ||
                JSON.stringify(existingProfile.colors) !== JSON.stringify(colors);
              
              if (profileChanged) {
                console.log(`Profile changed for user ${stableUserId}:`, { username, characterDescription });
                
                this.userProfiles.set(stableUserId, { username, characterDescription, colors });
                this.config.clientProfileUpdated(stableUserId, username, characterDescription, colors);
                
                console.log(`Total user profiles now:`, this.userProfiles.size);
              }
            }
          }
        } else {
          console.log(`No user info found for user ${stableUserId}`);
        }
      }
    }
  }

  private processRemovedUsers(removedUserIds: number[]): void {
    // Handle removed users by notifying the client with null updates
    for (const userId of removedUserIds) {
      console.log(`User ${userId} disconnected, removing from client`);
      
      // Remove from user profiles
      this.userProfiles.delete(userId);
      
      // Notify the client about the disconnection
      this.config.clientUpdate(userId, null);
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

  public sendMessage(message: FromUserNetworkingClientMessage): void {
    // For deltanet implementation, we don't need to send JSON messages
    // Authentication is handled through the deltanet token system
    // Other messages like user updates are handled through components/states
    console.warn("sendMessage is deprecated in deltanet implementation:", message);
  }

  public updateUserProfile(username?: string, characterDescription?: CharacterDescription, colors?: Array<[number, number, number]>): void {
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
