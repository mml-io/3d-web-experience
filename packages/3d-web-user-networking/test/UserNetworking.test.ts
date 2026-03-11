import { Server } from "node:http";
import * as util from "node:util";

import { jest } from "@jest/globals";
import {
  experienceClientSubProtocols,
  experienceProtocolToDeltaNetSubProtocol,
  handleExperienceWebsocketSubprotocol,
} from "@mml-io/3d-web-experience-protocol";
import express from "express";
import enableWs from "express-ws";

import { UserData, UserNetworkingClientUpdate } from "../src";
import {
  DeltaNetComponentMapping,
  STATE_CHARACTER_DESCRIPTION,
  STATE_COLORS,
  STATE_USERNAME,
} from "../src/DeltaNetComponentMapping";
import { WebsocketStatus } from "../src/types";
import { NetworkUpdate, UserNetworkingClient } from "../src/UserNetworkingClient";
import { UserNetworkingServer } from "../src/UserNetworkingServer";

import { createWaitable, waitUntil } from "./test-utils";

describe("UserNetworking", () => {
  let server: UserNetworkingServer | null = null;
  let listener: Server | null = null;
  let user1: UserNetworkingClient | null = null;
  let user2: UserNetworkingClient | null = null;

  afterEach(async () => {
    // Always clean up resources after each test
    try {
      // Stop clients first to prevent reconnection attempts
      if (user1) {
        user1.stop();
        user1 = null;
      }
      if (user2) {
        user2.stop();
        user2 = null;
      }

      // Then dispose server
      if (server) {
        server.dispose();
        server = null;
      }

      // Finally close the HTTP listener
      await new Promise<void>((resolve) => {
        if (listener) {
          listener.close(() => resolve());
        } else {
          resolve();
        }
      });
      listener = null;
    } catch (cleanupError) {
      console.error("Error during cleanup:", cleanupError);
    }
  });

  test("should see updates end-to-end", async () => {
    const sessionTokenForOne = "session-token-one";
    const sessionTokenForTwo = "session-token-two";

    const options = {
      onClientConnect: (
        connectionId: number,
        sessionToken: string,
        userIdentity?: UserData,
      ): true | UserData | Error => {
        if (sessionToken === sessionTokenForOne) {
          return {
            userId: "user-1",
            username: "user1",
            characterDescription: { meshFileUrl: "http://example.com/user1.glb" },
            colors: [[0, 0, 0]],
          };
        } else if (sessionToken === sessionTokenForTwo) {
          return {
            userId: "user-2",
            username: "user2",
            characterDescription: { meshFileUrl: "http://example.com/user2.glb" },
            colors: [[0, 0, 0]],
          };
        }
        return new Error("Invalid session token");
      },
      onClientUserIdentityUpdate: (
        connectionId: number,
        userIdentity: UserData,
      ): UserData | null => {
        return null;
      },
      onClientDisconnect: (connectionId: number): void => {},
      resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
    };
    server = new UserNetworkingServer(options);

    const { app } = enableWs(express(), undefined, {
      wsOptions: { handleProtocols: handleExperienceWebsocketSubprotocol },
    });
    app.ws("/user-networking", (ws) => {
      server!.connectClient(ws as unknown as WebSocket);
    });

    // Wait for server to be ready
    listener = await new Promise<any>((resolve) => {
      const httpServer = app.listen(8585, () => {
        console.log("Test server started on port 8585");
        resolve(httpServer);
      });
    });

    // Give the server a moment to fully initialize
    await new Promise((resolve) => setTimeout(resolve, 200));

    const serverAddress = "ws://localhost:8585/user-networking";
    console.log("Attempting to connect to:", serverAddress);

    const [user1IdentityPromise, user1IdentityResolve] = await createWaitable<number>();
    const [user1ConnectPromise, user1ConnectResolve] = await createWaitable<null>();
    const [user2IdentityPromise, user2IdentityResolve] = await createWaitable<number>();
    const [user2ConnectPromise, user2ConnectResolve] = await createWaitable<null>();

    const user1UserStates: Map<number, UserNetworkingClientUpdate> = new Map();
    const user1Profiles: Map<number, UserData> = new Map();
    const user1UserUpdates: Array<{
      connectionId: number;
      userState: Partial<UserData> | null;
      removal: boolean;
    }> = [];
    user1 = new UserNetworkingClient({
      url: serverAddress,
      sessionToken: sessionTokenForOne,
      websocketFactory: (url) => new WebSocket(url, [...experienceClientSubProtocols]),
      resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      statusUpdateCallback: (status) => {
        console.log("User1 WebSocket status:", status);
        if (status === WebsocketStatus.Connected) {
          user1ConnectResolve(null);
        }
      },
      assignedIdentity: (connectionId: number) => {
        user1IdentityResolve(connectionId);
      },
      onUpdate: (update: NetworkUpdate) => {
        for (const [connectionId, user] of update.addedConnectionIds) {
          const userState = user.userState;
          if (userState) {
            user1Profiles.set(connectionId, userState);
            user1UserUpdates.push({ connectionId, userState, removal: false });
          }
          user1UserStates.set(connectionId, user.components);
        }
        for (const [connectionId, user] of update.updatedUsers) {
          const userState = user.userState;
          if (userState) {
            const existingUserState = user1Profiles.get(connectionId)!;
            if (!existingUserState) {
              throw new Error(`User ${connectionId} not found in user1Profiles`);
            }
            user1Profiles.set(connectionId, { ...existingUserState, ...userState });
            user1UserUpdates.push({
              connectionId,
              userState,
              removal: false,
            });
          }
          user1UserStates.set(connectionId, user.components);
        }
        for (const connectionId of update.removedConnectionIds) {
          user1UserUpdates.push({ connectionId, userState: null, removal: true });
          user1UserStates.delete(connectionId);
        }
      },
      onServerError: (error) => {
        console.error("Received server error", error);
      },
    });
    await user1ConnectPromise;
    expect(await user1IdentityPromise).toEqual(1);

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "wait for server to see the presence of user 1",
    );

    await waitUntil(
      () => user1Profiles.has(1),
      "wait for user 1 to see their own profile returned from the server",
    );

    expect(user1Profiles.get(1)).toEqual({
      connectionId: 1,
      userId: "user-1",
      username: "user1",
      characterDescription: { meshFileUrl: "http://example.com/user1.glb" },
      colors: [[0, 0, 0]],
    });

    const user2UserStates: Map<number, UserNetworkingClientUpdate> = new Map();
    const user2Profiles: Map<number, UserData> = new Map();
    const user2UserUpdates: Array<{
      connectionId: number;
      userState: Partial<UserData> | null;
      removal: boolean;
    }> = [];
    user2 = new UserNetworkingClient({
      url: serverAddress,
      sessionToken: sessionTokenForTwo,
      websocketFactory: (url) => new WebSocket(url, [...experienceClientSubProtocols]),
      resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      statusUpdateCallback: (status) => {
        console.log("User2 WebSocket status:", status);
        if (status === WebsocketStatus.Connected) {
          user2ConnectResolve(null);
        }
      },
      assignedIdentity: (connectionId: number) => {
        user2IdentityResolve(connectionId);
      },
      onUpdate: (update: NetworkUpdate) => {
        for (const [connectionId, user] of update.addedConnectionIds) {
          const userState = user.userState;
          if (userState) {
            user2Profiles.set(connectionId, userState);
            user2UserUpdates.push({ connectionId, userState, removal: false });
          }
          user2UserStates.set(connectionId, user.components);
        }
        for (const [connectionId, user] of update.updatedUsers) {
          const userState = user.userState;
          if (userState) {
            const existingUserState = user2Profiles.get(connectionId)!;
            if (!existingUserState) {
              throw new Error(`User ${connectionId} not found in user2Profiles`);
            }
            user2Profiles.set(connectionId, { ...existingUserState, ...userState });
            user2UserUpdates.push({
              connectionId,
              userState,
              removal: false,
            });
          }
          user2UserStates.set(connectionId, user.components);
        }
        for (const connectionId of update.removedConnectionIds) {
          user2UserUpdates.push({ connectionId, userState: null, removal: true });
          user2UserStates.delete(connectionId);
        }
      },
      onServerError: (error) => {
        console.error("Received server error", error);
      },
    });

    await user2ConnectPromise;
    expect(await user2IdentityPromise).toEqual(2);

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 2,
      "wait for server to see the presence of user 2",
    );

    await waitUntil(
      () => user2Profiles.has(1) && user2Profiles.has(2),
      "wait for user 2 to see both profiles returned from the server",
    );

    expect(user2Profiles.get(1)).toEqual({
      connectionId: 1,
      userId: "user-1",
      username: "user1",
      characterDescription: { meshFileUrl: "http://example.com/user1.glb" },
      colors: [[0, 0, 0]],
    });
    expect(user2Profiles.get(2)).toEqual({
      connectionId: 2,
      userId: "user-2",
      username: "user2",
      characterDescription: { meshFileUrl: "http://example.com/user2.glb" },
      colors: [[0, 0, 0]],
    });

    user1.sendUpdate({
      position: { x: 1, y: 2, z: 3 },
      rotation: { eulerY: 0.1 },
      state: 1,
    });

    // Wait for user 2 to see the update
    await waitUntil(
      () => user2UserStates.has(1) && user2UserStates.get(1)!.position.x !== 0,
      "wait for user 2 to see the update from user 1",
    );

    expect(Array.from(user2UserStates.entries())).toEqual([
      [
        1,
        {
          position: { x: 1, y: 2, z: 3 },
          rotation: { eulerY: expect.closeTo(0.1) },
          state: 1,
        },
      ],
      [
        2,
        {
          position: { x: 0, y: 0, z: 0 },
          rotation: { eulerY: 0 },
          state: 0,
        },
      ],
    ]);

    user2.sendUpdate({
      position: { x: 2, y: 4, z: 6 },
      rotation: { eulerY: 0.2 },
      state: 2,
    });

    // Wait for user 1 to see the update
    await waitUntil(
      () => user1UserStates.has(2) && user1UserStates.get(2)!.position.x !== 0,
      "wait for user 1 to see the update from user 2",
    );

    expect(Array.from(user1UserStates.entries())).toEqual([
      [
        1,
        {
          position: { x: 1, y: 2, z: 3 },
          rotation: { eulerY: expect.closeTo(0.1) },
          state: 1,
        },
      ],
      [
        2,
        {
          position: { x: 2, y: 4, z: 6 },
          rotation: { eulerY: expect.closeTo(0.2) },
          state: 2,
        },
      ],
    ]);

    user2.stop();
    user2 = null;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "wait for server to see the removal of user 2",
    );

    // Wait for user 1 to see the removal
    await waitUntil(() => !user1UserStates.has(2), "wait for user 1 to see the removal of user 2");

    // Has data for user 1 only
    expect(Array.from(user1UserStates.entries())).toEqual([
      [
        1,
        {
          position: {
            x: 1,
            y: 2,
            z: 3,
          },
          rotation: {
            eulerY: 0.1,
          },
          state: 1,
        },
      ],
    ]);

    user1.stop();
    user1 = null;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 0,
      "wait for server to see the removal of user 1",
    );
  });

  test("should handle individual state updates", async () => {
    const sessionTokenForOne = "session-token-one";
    const sessionTokenForTwo = "session-token-two";

    const onServerClientUserUpdate = jest.fn((connectionId: number, userIdentity: UserData) => {
      return userIdentity;
    });

    const options = {
      onClientConnect: (
        connectionId: number,
        sessionToken: string,
        userIdentity?: UserData,
      ): true | UserData | Error => {
        if (sessionToken === sessionTokenForOne) {
          return {
            userId: "user-1",
            username: "user1",
            characterDescription: { meshFileUrl: "http://example.com/user1.glb" },
            colors: [[0, 0, 0]],
          };
        } else if (sessionToken === sessionTokenForTwo) {
          return {
            userId: "user-2",
            username: "user2",
            characterDescription: { meshFileUrl: "http://example.com/user2.glb" },
            colors: [[0, 0, 0]],
          };
        }
        return new Error("Invalid session token");
      },
      onClientUserIdentityUpdate: (
        connectionId: number,
        userIdentity: UserData,
      ): UserData | null | false | true | Error => {
        return onServerClientUserUpdate(connectionId, userIdentity);
      },
      onClientDisconnect: (connectionId: number): void => {},
      resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
    };
    server = new UserNetworkingServer(options);

    const { app } = enableWs(express(), undefined, {
      wsOptions: { handleProtocols: handleExperienceWebsocketSubprotocol },
    });
    app.ws("/user-networking", (ws) => {
      server!.connectClient(ws as unknown as WebSocket);
    });

    // Wait for server to be ready
    listener = await new Promise<any>((resolve) => {
      const httpServer = app.listen(8587, () => {
        console.log("Test server started on port 8587");
        resolve(httpServer);
      });
    });

    // Give the server a moment to fully initialize
    await new Promise((resolve) => setTimeout(resolve, 200));

    const serverAddress = "ws://localhost:8587/user-networking";

    const [user1IdentityPromise, user1IdentityResolve] = await createWaitable<number>();
    const [user1ConnectPromise, user1ConnectResolve] = await createWaitable<null>();
    const [user2IdentityPromise, user2IdentityResolve] = await createWaitable<number>();
    const [user2ConnectPromise, user2ConnectResolve] = await createWaitable<null>();

    const user1Profiles: Map<number, UserData> = new Map();
    const user1UserUpdates: Array<{
      connectionId: number;
      userState: Partial<UserData> | null;
      removal: boolean;
    }> = [];

    user1 = new UserNetworkingClient({
      url: serverAddress,
      sessionToken: sessionTokenForOne,
      websocketFactory: (url) => new WebSocket(url, [...experienceClientSubProtocols]),
      resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      statusUpdateCallback: (status) => {
        if (status === WebsocketStatus.Connected) {
          user1ConnectResolve(null);
        }
      },
      assignedIdentity: (connectionId: number) => {
        user1IdentityResolve(connectionId);
      },
      onUpdate: (update: NetworkUpdate) => {
        for (const [connectionId, user] of update.addedConnectionIds) {
          const userState = user.userState;
          if (userState) {
            user1Profiles.set(connectionId, userState);
            user1UserUpdates.push({ connectionId, userState, removal: false });
          }
        }
        for (const [connectionId, user] of update.updatedUsers) {
          const userState = user.userState;
          if (userState) {
            const existingUserState = user1Profiles.get(connectionId)!;
            if (!existingUserState) {
              throw new Error(`User ${connectionId} not found in user1Profiles`);
            }
            user1Profiles.set(connectionId, { ...existingUserState, ...userState });
            user1UserUpdates.push({
              connectionId,
              userState,
              removal: false,
            });
          }
        }
        for (const connectionId of update.removedConnectionIds) {
          user1UserUpdates.push({ connectionId, userState: null, removal: true });
        }
      },
      onServerError: (error) => {
        console.error("Received server error", error);
      },
    });

    await user1ConnectPromise;
    expect(await user1IdentityPromise).toEqual(1);

    const user2Profiles: Map<number, UserData> = new Map();
    const user2UserUpdates: Array<{
      connectionId: number;
      userState: Partial<UserData> | null;
      removal: boolean;
    }> = [];

    user2 = new UserNetworkingClient({
      url: serverAddress,
      sessionToken: sessionTokenForTwo,
      websocketFactory: (url) => new WebSocket(url, [...experienceClientSubProtocols]),
      resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      statusUpdateCallback: (status) => {
        if (status === WebsocketStatus.Connected) {
          user2ConnectResolve(null);
        }
      },
      assignedIdentity: (connectionId: number) => {
        user2IdentityResolve(connectionId);
      },
      onUpdate: (update: NetworkUpdate) => {
        for (const [connectionId, user] of update.addedConnectionIds) {
          const userState = user.userState;
          if (userState) {
            user2Profiles.set(connectionId, userState);
            user2UserUpdates.push({ connectionId, userState, removal: false });
          }
        }
        for (const [connectionId, user] of update.updatedUsers) {
          const userState = user.userState;
          if (userState) {
            const existingUserState = user2Profiles.get(connectionId)!;
            if (!existingUserState) {
              throw new Error(`User ${connectionId} not found in user2Profiles`);
            }
            user2Profiles.set(connectionId, { ...existingUserState, ...userState });
            user2UserUpdates.push({
              connectionId,
              userState,
              removal: false,
            });
          }
        }
        for (const connectionId of update.removedConnectionIds) {
          user2UserUpdates.push({ connectionId, userState: null, removal: true });
        }
      },
      onServerError: (error) => {
        console.error("Received server error", error);
      },
    });

    await user2ConnectPromise;
    expect(await user2IdentityPromise).toEqual(2);

    // Wait for initial profile setup
    await waitUntil(
      () => user1Profiles.has(1) && user1Profiles.has(2),
      "wait for user1 to see both profiles",
    );
    await waitUntil(
      () => user2Profiles.has(1) && user2Profiles.has(2),
      "wait for user2 to see both profiles",
    );

    // Test individual username update
    user1.updateUsername("updated-user1");

    let usernameUpdateFromUser1 = null;
    await waitUntil(
      () =>
        (usernameUpdateFromUser1 = user2UserUpdates.find(
          (u) => u.connectionId === 1 && u.userState?.username === "updated-user1",
        )) !== undefined,
      "wait for user2 to see username update",
    );

    expect(usernameUpdateFromUser1).toEqual({
      removal: false,
      connectionId: 1,
      userState: {
        connectionId: 1,
        username: "updated-user1",
        characterDescription: { meshFileUrl: "http://example.com/user1.glb" },
        userId: "user-1",
        colors: [[0, 0, 0]],
      },
    });

    // Test individual character description update
    const newCharacterDescription = { meshFileUrl: "http://example.com/new-user1.glb" };
    user1.updateCharacterDescription(newCharacterDescription);

    let characterDescriptionUpdateFromUser1 = null;
    await waitUntil(
      () =>
        (characterDescriptionUpdateFromUser1 = user2UserUpdates.find(
          (u) =>
            u.connectionId === 1 &&
            u.userState?.characterDescription?.meshFileUrl === newCharacterDescription.meshFileUrl,
        )) !== undefined,
      "wait for user2 to see character description update",
    );

    expect(characterDescriptionUpdateFromUser1).toEqual({
      connectionId: 1,
      removal: false,
      userState: {
        connectionId: 1,
        username: "updated-user1",
        characterDescription: newCharacterDescription,
        userId: "user-1",
        colors: [[0, 0, 0]],
      },
    });

    // Test individual colors update
    const newColors: Array<[number, number, number]> = [
      [255, 0, 0],
      [0, 255, 0],
    ];
    user1.updateColors(newColors);

    let colorsUpdateFromUser1 = null;
    await waitUntil(
      () =>
        (colorsUpdateFromUser1 = user2UserUpdates.find(
          (u) => u.connectionId === 1 && util.isDeepStrictEqual(u.userState?.colors, newColors),
        )) !== undefined,
      "wait for user2 to see colors update",
    );

    expect(colorsUpdateFromUser1).toEqual({
      connectionId: 1,
      removal: false,
      userState: {
        connectionId: 1,
        userId: "user-1",
        username: "updated-user1",
        characterDescription: newCharacterDescription,
        colors: newColors,
      },
    });
  }, 15000);

  describe("server-initiated state updates", () => {
    test("should propagate server updateUserUsername to connected client", async () => {
      const sessionToken = "token-srv-username";

      const options = {
        onClientConnect: (
          connectionId: number,
          sessionToken: string,
          userIdentity?: UserData,
        ): true | UserData | Error => {
          return {
            userId: "user-1",
            username: "original-name",
            characterDescription: { meshFileUrl: "http://example.com/avatar.glb" },
            colors: [[0, 0, 0]] as Array<[number, number, number]>,
          };
        },
        onClientUserIdentityUpdate: (
          connectionId: number,
          userIdentity: UserData,
        ): UserData | null => {
          return userIdentity;
        },
        onClientDisconnect: (connectionId: number): void => {},
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      };
      server = new UserNetworkingServer(options);

      const { app } = enableWs(express(), undefined, {
        wsOptions: { handleProtocols: handleExperienceWebsocketSubprotocol },
      });
      app.ws("/user-networking", (ws) => {
        server!.connectClient(ws as unknown as WebSocket);
      });

      listener = await new Promise<any>((resolve) => {
        const httpServer = app.listen(8588, () => resolve(httpServer));
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const serverAddress = "ws://localhost:8588/user-networking";

      const [identityPromise, identityResolve] = await createWaitable<number>();
      const [connectPromise, connectResolve] = await createWaitable<null>();

      const userProfiles: Map<number, UserData> = new Map();
      const userUpdates: Array<{
        connectionId: number;
        userState: Partial<UserData> | null;
        removal: boolean;
      }> = [];

      user1 = new UserNetworkingClient({
        url: serverAddress,
        sessionToken,
        websocketFactory: (url) => new WebSocket(url, [...experienceClientSubProtocols]),
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
        statusUpdateCallback: (status) => {
          if (status === WebsocketStatus.Connected) connectResolve(null);
        },
        assignedIdentity: (connectionId: number) => identityResolve(connectionId),
        onUpdate: (update: NetworkUpdate) => {
          for (const [connectionId, user] of update.addedConnectionIds) {
            if (user.userState) {
              userProfiles.set(connectionId, user.userState);
              userUpdates.push({
                connectionId,
                userState: user.userState,
                removal: false,
              });
            }
          }
          for (const [connectionId, user] of update.updatedUsers) {
            if (user.userState) {
              const existing = userProfiles.get(connectionId)!;
              userProfiles.set(connectionId, { ...existing, ...user.userState });
              userUpdates.push({
                connectionId,
                userState: user.userState,
                removal: false,
              });
            }
          }
          for (const connectionId of update.removedConnectionIds) {
            userUpdates.push({ connectionId, userState: null, removal: true });
          }
        },
        onServerError: (error) => {
          console.error("Server error", error);
        },
      });

      await connectPromise;
      const connectionId = await identityPromise;
      expect(connectionId).toEqual(1);

      await waitUntil(
        () => (server as any).authenticatedClientsById.size === 1,
        "wait for server to see user",
      );
      await waitUntil(() => userProfiles.has(1), "wait for client to see own profile");

      // Server-initiated username update
      server!.updateUserUsername(1, "server-set-name");

      await waitUntil(
        () =>
          userUpdates.some(
            (u) => u.connectionId === 1 && u.userState?.username === "server-set-name",
          ),
        "wait for client to receive server-initiated username update",
      );

      expect(userProfiles.get(1)!.username).toEqual("server-set-name");
    }, 10000);

    test("should propagate server updateUserCharacterDescription to connected client", async () => {
      const sessionToken = "token-srv-char";

      const options = {
        onClientConnect: (
          connectionId: number,
          sessionToken: string,
          userIdentity?: UserData,
        ): true | UserData | Error => {
          return {
            userId: "user-1",
            username: "char-test-user",
            characterDescription: { meshFileUrl: "http://example.com/old.glb" },
            colors: [[0, 0, 0]] as Array<[number, number, number]>,
          };
        },
        onClientUserIdentityUpdate: (
          connectionId: number,
          userIdentity: UserData,
        ): UserData | null => {
          return userIdentity;
        },
        onClientDisconnect: (connectionId: number): void => {},
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      };
      server = new UserNetworkingServer(options);

      const { app } = enableWs(express(), undefined, {
        wsOptions: { handleProtocols: handleExperienceWebsocketSubprotocol },
      });
      app.ws("/user-networking", (ws) => {
        server!.connectClient(ws as unknown as WebSocket);
      });

      listener = await new Promise<any>((resolve) => {
        const httpServer = app.listen(8589, () => resolve(httpServer));
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const serverAddress = "ws://localhost:8589/user-networking";

      const [identityPromise, identityResolve] = await createWaitable<number>();
      const [connectPromise, connectResolve] = await createWaitable<null>();

      const userProfiles: Map<number, UserData> = new Map();
      const userUpdates: Array<{
        connectionId: number;
        userState: Partial<UserData> | null;
        removal: boolean;
      }> = [];

      user1 = new UserNetworkingClient({
        url: serverAddress,
        sessionToken,
        websocketFactory: (url) => new WebSocket(url, [...experienceClientSubProtocols]),
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
        statusUpdateCallback: (status) => {
          if (status === WebsocketStatus.Connected) connectResolve(null);
        },
        assignedIdentity: (connectionId: number) => identityResolve(connectionId),
        onUpdate: (update: NetworkUpdate) => {
          for (const [connectionId, user] of update.addedConnectionIds) {
            if (user.userState) {
              userProfiles.set(connectionId, user.userState);
              userUpdates.push({
                connectionId,
                userState: user.userState,
                removal: false,
              });
            }
          }
          for (const [connectionId, user] of update.updatedUsers) {
            if (user.userState) {
              const existing = userProfiles.get(connectionId)!;
              userProfiles.set(connectionId, { ...existing, ...user.userState });
              userUpdates.push({
                connectionId,
                userState: user.userState,
                removal: false,
              });
            }
          }
          for (const connectionId of update.removedConnectionIds) {
            userUpdates.push({ connectionId, userState: null, removal: true });
          }
        },
        onServerError: (error) => {
          console.error("Server error", error);
        },
      });

      await connectPromise;
      expect(await identityPromise).toEqual(1);

      await waitUntil(
        () => (server as any).authenticatedClientsById.size === 1,
        "wait for server to see user",
      );
      await waitUntil(() => userProfiles.has(1), "wait for client to see own profile");

      const newDesc = { meshFileUrl: "http://example.com/new-avatar.glb" };
      server!.updateUserCharacterDescription(1, newDesc);

      await waitUntil(
        () =>
          userUpdates.some(
            (u) =>
              u.connectionId === 1 &&
              u.userState?.characterDescription?.meshFileUrl === newDesc.meshFileUrl,
          ),
        "wait for client to receive server-initiated character description update",
      );

      expect(userProfiles.get(1)!.characterDescription).toEqual(newDesc);
    }, 10000);

    test("should propagate server updateUserColors to connected client", async () => {
      const sessionToken = "token-srv-colors";

      const options = {
        onClientConnect: (
          connectionId: number,
          sessionToken: string,
          userIdentity?: UserData,
        ): true | UserData | Error => {
          return {
            userId: "user-1",
            username: "colors-test-user",
            characterDescription: { meshFileUrl: "http://example.com/avatar.glb" },
            colors: [[0, 0, 0]] as Array<[number, number, number]>,
          };
        },
        onClientUserIdentityUpdate: (
          connectionId: number,
          userIdentity: UserData,
        ): UserData | null => {
          return userIdentity;
        },
        onClientDisconnect: (connectionId: number): void => {},
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      };
      server = new UserNetworkingServer(options);

      const { app } = enableWs(express(), undefined, {
        wsOptions: { handleProtocols: handleExperienceWebsocketSubprotocol },
      });
      app.ws("/user-networking", (ws) => {
        server!.connectClient(ws as unknown as WebSocket);
      });

      listener = await new Promise<any>((resolve) => {
        const httpServer = app.listen(8590, () => resolve(httpServer));
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const serverAddress = "ws://localhost:8590/user-networking";

      const [identityPromise, identityResolve] = await createWaitable<number>();
      const [connectPromise, connectResolve] = await createWaitable<null>();

      const userProfiles: Map<number, UserData> = new Map();
      const userUpdates: Array<{
        connectionId: number;
        userState: Partial<UserData> | null;
        removal: boolean;
      }> = [];

      user1 = new UserNetworkingClient({
        url: serverAddress,
        sessionToken,
        websocketFactory: (url) => new WebSocket(url, [...experienceClientSubProtocols]),
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
        statusUpdateCallback: (status) => {
          if (status === WebsocketStatus.Connected) connectResolve(null);
        },
        assignedIdentity: (connectionId: number) => identityResolve(connectionId),
        onUpdate: (update: NetworkUpdate) => {
          for (const [connectionId, user] of update.addedConnectionIds) {
            if (user.userState) {
              userProfiles.set(connectionId, user.userState);
              userUpdates.push({
                connectionId,
                userState: user.userState,
                removal: false,
              });
            }
          }
          for (const [connectionId, user] of update.updatedUsers) {
            if (user.userState) {
              const existing = userProfiles.get(connectionId)!;
              userProfiles.set(connectionId, { ...existing, ...user.userState });
              userUpdates.push({
                connectionId,
                userState: user.userState,
                removal: false,
              });
            }
          }
          for (const connectionId of update.removedConnectionIds) {
            userUpdates.push({ connectionId, userState: null, removal: true });
          }
        },
        onServerError: (error) => {
          console.error("Server error", error);
        },
      });

      await connectPromise;
      expect(await identityPromise).toEqual(1);

      await waitUntil(
        () => (server as any).authenticatedClientsById.size === 1,
        "wait for server to see user",
      );
      await waitUntil(() => userProfiles.has(1), "wait for client to see own profile");

      const newColors: Array<[number, number, number]> = [
        [100, 200, 50],
        [10, 20, 30],
      ];
      server!.updateUserColors(1, newColors);

      await waitUntil(
        () =>
          userUpdates.some(
            (u) => u.connectionId === 1 && util.isDeepStrictEqual(u.userState?.colors, newColors),
          ),
        "wait for client to receive server-initiated colors update",
      );

      expect(userProfiles.get(1)!.colors).toEqual(newColors);
    }, 10000);

    test("should propagate server updateUserStates with multiple fields to connected client", async () => {
      const sessionToken = "token-srv-states";

      const options = {
        onClientConnect: (
          connectionId: number,
          sessionToken: string,
          userIdentity?: UserData,
        ): true | UserData | Error => {
          return {
            userId: "user-1",
            username: "states-test-user",
            characterDescription: { meshFileUrl: "http://example.com/avatar.glb" },
            colors: [[0, 0, 0]] as Array<[number, number, number]>,
          };
        },
        onClientUserIdentityUpdate: (
          connectionId: number,
          userIdentity: UserData,
        ): UserData | null => {
          return userIdentity;
        },
        onClientDisconnect: (connectionId: number): void => {},
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      };
      server = new UserNetworkingServer(options);

      const { app } = enableWs(express(), undefined, {
        wsOptions: { handleProtocols: handleExperienceWebsocketSubprotocol },
      });
      app.ws("/user-networking", (ws) => {
        server!.connectClient(ws as unknown as WebSocket);
      });

      listener = await new Promise<any>((resolve) => {
        const httpServer = app.listen(8591, () => resolve(httpServer));
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const serverAddress = "ws://localhost:8591/user-networking";

      const [identityPromise, identityResolve] = await createWaitable<number>();
      const [connectPromise, connectResolve] = await createWaitable<null>();

      const userProfiles: Map<number, UserData> = new Map();
      const userUpdates: Array<{
        connectionId: number;
        userState: Partial<UserData> | null;
        removal: boolean;
      }> = [];

      user1 = new UserNetworkingClient({
        url: serverAddress,
        sessionToken,
        websocketFactory: (url) => new WebSocket(url, [...experienceClientSubProtocols]),
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
        statusUpdateCallback: (status) => {
          if (status === WebsocketStatus.Connected) connectResolve(null);
        },
        assignedIdentity: (connectionId: number) => identityResolve(connectionId),
        onUpdate: (update: NetworkUpdate) => {
          for (const [connectionId, user] of update.addedConnectionIds) {
            if (user.userState) {
              userProfiles.set(connectionId, user.userState);
              userUpdates.push({
                connectionId,
                userState: user.userState,
                removal: false,
              });
            }
          }
          for (const [connectionId, user] of update.updatedUsers) {
            if (user.userState) {
              const existing = userProfiles.get(connectionId)!;
              userProfiles.set(connectionId, { ...existing, ...user.userState });
              userUpdates.push({
                connectionId,
                userState: user.userState,
                removal: false,
              });
            }
          }
          for (const connectionId of update.removedConnectionIds) {
            userUpdates.push({ connectionId, userState: null, removal: true });
          }
        },
        onServerError: (error) => {
          console.error("Server error", error);
        },
      });

      await connectPromise;
      expect(await identityPromise).toEqual(1);

      await waitUntil(
        () => (server as any).authenticatedClientsById.size === 1,
        "wait for server to see user",
      );
      await waitUntil(() => userProfiles.has(1), "wait for client to see own profile");

      const updatedData: UserData = {
        userId: "user-1",
        username: "bulk-updated-name",
        characterDescription: { meshFileUrl: "http://example.com/bulk.glb" },
        colors: [
          [42, 42, 42],
          [99, 99, 99],
        ],
      };
      server!.updateUserStates(1, updatedData);

      await waitUntil(
        () =>
          userUpdates.some(
            (u) => u.connectionId === 1 && u.userState?.username === "bulk-updated-name",
          ),
        "wait for client to receive server-initiated bulk state update",
      );

      const profile = userProfiles.get(1)!;
      expect(profile.username).toEqual("bulk-updated-name");
      expect(profile.characterDescription).toEqual({
        meshFileUrl: "http://example.com/bulk.glb",
      });
      expect(profile.colors).toEqual([
        [42, 42, 42],
        [99, 99, 99],
      ]);
    }, 10000);
  });

  describe("custom messaging", () => {
    test("should deliver sendCustomMessageToClient to the target client", async () => {
      const sessionToken = "token-custom-msg";

      const options = {
        onClientConnect: (
          connectionId: number,
          sessionToken: string,
          userIdentity?: UserData,
        ): true | UserData | Error => {
          return {
            userId: "user-1",
            username: "custom-msg-user",
            characterDescription: { meshFileUrl: "http://example.com/avatar.glb" },
            colors: [[0, 0, 0]] as Array<[number, number, number]>,
          };
        },
        onClientUserIdentityUpdate: (
          connectionId: number,
          userIdentity: UserData,
        ): UserData | null => {
          return userIdentity;
        },
        onClientDisconnect: (connectionId: number): void => {},
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      };
      server = new UserNetworkingServer(options);

      const { app } = enableWs(express(), undefined, {
        wsOptions: { handleProtocols: handleExperienceWebsocketSubprotocol },
      });
      app.ws("/user-networking", (ws) => {
        server!.connectClient(ws as unknown as WebSocket);
      });

      listener = await new Promise<any>((resolve) => {
        const httpServer = app.listen(8592, () => resolve(httpServer));
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const serverAddress = "ws://localhost:8592/user-networking";

      const [identityPromise, identityResolve] = await createWaitable<number>();
      const [connectPromise, connectResolve] = await createWaitable<null>();

      const receivedCustomMessages: Array<{ customType: number; contents: string }> = [];

      user1 = new UserNetworkingClient({
        url: serverAddress,
        sessionToken,
        websocketFactory: (url) => new WebSocket(url, [...experienceClientSubProtocols]),
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
        statusUpdateCallback: (status) => {
          if (status === WebsocketStatus.Connected) connectResolve(null);
        },
        assignedIdentity: (connectionId: number) => identityResolve(connectionId),
        onUpdate: () => {},
        onServerError: (error) => {
          console.error("Server error", error);
        },
        onCustomMessage: (customType: number, contents: string) => {
          receivedCustomMessages.push({ customType, contents });
        },
      });

      await connectPromise;
      expect(await identityPromise).toEqual(1);

      await waitUntil(
        () => (server as any).authenticatedClientsById.size === 1,
        "wait for server to see user",
      );

      server!.sendCustomMessageToClient(1, 42, "hello-from-server");

      await waitUntil(
        () => receivedCustomMessages.length > 0,
        "wait for client to receive custom message",
      );

      expect(receivedCustomMessages[0]).toEqual({
        customType: 42,
        contents: "hello-from-server",
      });
    }, 10000);

    test("should deliver broadcastMessage to all connected clients", async () => {
      const sessionTokenOne = "token-broadcast-1";
      const sessionTokenTwo = "token-broadcast-2";

      const options = {
        onClientConnect: (
          connectionId: number,
          sessionToken: string,
          userIdentity?: UserData,
        ): true | UserData | Error => {
          if (sessionToken === sessionTokenOne) {
            return {
              userId: "user-1",
              username: "broadcast-user-1",
              characterDescription: { meshFileUrl: "http://example.com/u1.glb" },
              colors: [[0, 0, 0]] as Array<[number, number, number]>,
            };
          }
          return {
            userId: "user-2",
            username: "broadcast-user-2",
            characterDescription: { meshFileUrl: "http://example.com/u2.glb" },
            colors: [[0, 0, 0]] as Array<[number, number, number]>,
          };
        },
        onClientUserIdentityUpdate: (
          connectionId: number,
          userIdentity: UserData,
        ): UserData | null => {
          return userIdentity;
        },
        onClientDisconnect: (connectionId: number): void => {},
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      };
      server = new UserNetworkingServer(options);

      const { app } = enableWs(express(), undefined, {
        wsOptions: { handleProtocols: handleExperienceWebsocketSubprotocol },
      });
      app.ws("/user-networking", (ws) => {
        server!.connectClient(ws as unknown as WebSocket);
      });

      listener = await new Promise<any>((resolve) => {
        const httpServer = app.listen(8593, () => resolve(httpServer));
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const serverAddress = "ws://localhost:8593/user-networking";

      // User 1
      const [id1Promise, id1Resolve] = await createWaitable<number>();
      const [conn1Promise, conn1Resolve] = await createWaitable<null>();
      const user1CustomMessages: Array<{ customType: number; contents: string }> = [];

      user1 = new UserNetworkingClient({
        url: serverAddress,
        sessionToken: sessionTokenOne,
        websocketFactory: (url) => new WebSocket(url, [...experienceClientSubProtocols]),
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
        statusUpdateCallback: (status) => {
          if (status === WebsocketStatus.Connected) conn1Resolve(null);
        },
        assignedIdentity: (connectionId: number) => id1Resolve(connectionId),
        onUpdate: () => {},
        onServerError: (error) => {
          console.error("Server error", error);
        },
        onCustomMessage: (customType: number, contents: string) => {
          user1CustomMessages.push({ customType, contents });
        },
      });

      await conn1Promise;
      expect(await id1Promise).toEqual(1);

      // User 2
      const [id2Promise, id2Resolve] = await createWaitable<number>();
      const [conn2Promise, conn2Resolve] = await createWaitable<null>();
      const user2CustomMessages: Array<{ customType: number; contents: string }> = [];

      user2 = new UserNetworkingClient({
        url: serverAddress,
        sessionToken: sessionTokenTwo,
        websocketFactory: (url) => new WebSocket(url, [...experienceClientSubProtocols]),
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
        statusUpdateCallback: (status) => {
          if (status === WebsocketStatus.Connected) conn2Resolve(null);
        },
        assignedIdentity: (connectionId: number) => id2Resolve(connectionId),
        onUpdate: () => {},
        onServerError: (error) => {
          console.error("Server error", error);
        },
        onCustomMessage: (customType: number, contents: string) => {
          user2CustomMessages.push({ customType, contents });
        },
      });

      await conn2Promise;
      expect(await id2Promise).toEqual(2);

      await waitUntil(
        () => (server as any).authenticatedClientsById.size === 2,
        "wait for server to see both users",
      );

      server!.broadcastMessage(99, "broadcast-payload");

      await waitUntil(
        () => user1CustomMessages.length > 0 && user2CustomMessages.length > 0,
        "wait for both clients to receive broadcast",
      );

      expect(user1CustomMessages[0]).toEqual({
        customType: 99,
        contents: "broadcast-payload",
      });
      expect(user2CustomMessages[0]).toEqual({
        customType: 99,
        contents: "broadcast-payload",
      });
    }, 10000);
  });

  describe("auth error paths", () => {
    test("should disconnect client when onClientConnect returns an Error", async () => {
      const options = {
        onClientConnect: (
          connectionId: number,
          sessionToken: string,
          userIdentity?: UserData,
        ): true | UserData | Error => {
          return new Error("Invalid credentials");
        },
        onClientUserIdentityUpdate: (
          connectionId: number,
          userIdentity: UserData,
        ): UserData | null => {
          return null;
        },
        onClientDisconnect: (connectionId: number): void => {},
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      };
      server = new UserNetworkingServer(options);

      const { app } = enableWs(express(), undefined, {
        wsOptions: { handleProtocols: handleExperienceWebsocketSubprotocol },
      });
      app.ws("/user-networking", (ws) => {
        server!.connectClient(ws as unknown as WebSocket);
      });

      listener = await new Promise<any>((resolve) => {
        const httpServer = app.listen(8594, () => resolve(httpServer));
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const serverAddress = "ws://localhost:8594/user-networking";

      const serverErrors: Array<{ message: string; errorType: string }> = [];
      const statusChanges: WebsocketStatus[] = [];

      user1 = new UserNetworkingClient({
        url: serverAddress,
        sessionToken: "bad-token",
        websocketFactory: (url) => new WebSocket(url, [...experienceClientSubProtocols]),
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
        statusUpdateCallback: (status) => {
          statusChanges.push(status);
        },
        assignedIdentity: (connectionId: number) => {
          // Should not be called for failed auth
        },
        onUpdate: () => {},
        onServerError: (error) => {
          serverErrors.push(error);
        },
      });

      // The client should receive an error and eventually disconnect/reconnect
      await waitUntil(() => serverErrors.length > 0, "wait for client to receive auth error");

      expect(serverErrors[0].errorType).toBeDefined();
      expect(serverErrors[0].message).toBeDefined();

      // Server should not have any authenticated clients
      expect((server as any).authenticatedClientsById.size).toEqual(0);
    }, 10000);
  });
});

describe("DeltaNetComponentMapping.toSingleState", () => {
  test("STATE_USERNAME: encodes a string as UTF-8 bytes", () => {
    const result = DeltaNetComponentMapping.toSingleState(STATE_USERNAME, "test-user");

    expect(result.size).toEqual(1);
    expect(result.has(STATE_USERNAME)).toBe(true);

    const bytes = result.get(STATE_USERNAME)!;
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toEqual("test-user");
  });

  test("STATE_CHARACTER_DESCRIPTION: encodes an object as JSON UTF-8 bytes", () => {
    const desc = { meshFileUrl: "http://example.com/avatar.glb" };
    const result = DeltaNetComponentMapping.toSingleState(STATE_CHARACTER_DESCRIPTION, desc);

    expect(result.size).toEqual(1);
    expect(result.has(STATE_CHARACTER_DESCRIPTION)).toBe(true);

    const bytes = result.get(STATE_CHARACTER_DESCRIPTION)!;
    const decoded = JSON.parse(new TextDecoder().decode(bytes));
    expect(decoded).toEqual(desc);
  });

  test("STATE_COLORS: encodes an array of color tuples as binary", () => {
    const colors: Array<[number, number, number]> = [
      [255, 128, 0],
      [0, 255, 64],
    ];
    const result = DeltaNetComponentMapping.toSingleState(STATE_COLORS, colors);

    expect(result.size).toEqual(1);
    expect(result.has(STATE_COLORS)).toBe(true);

    // Verify by round-tripping through decodeColors
    const bytes = result.get(STATE_COLORS)!;
    const logger = { info: () => {}, warn: () => {}, error: () => {} };
    const decodedColors = DeltaNetComponentMapping.decodeColors(bytes, logger as any);
    expect(decodedColors).toEqual(colors);
  });

  test("unknown state ID: returns an empty map", () => {
    const result = DeltaNetComponentMapping.toSingleState(999, "some-value");
    expect(result.size).toEqual(0);
  });

  test("STATE_USERNAME: returns empty map for non-string value", () => {
    const result = DeltaNetComponentMapping.toSingleState(STATE_USERNAME, 12345);
    expect(result.size).toEqual(0);
  });

  test("STATE_CHARACTER_DESCRIPTION: returns empty map for null value", () => {
    const result = DeltaNetComponentMapping.toSingleState(STATE_CHARACTER_DESCRIPTION, null);
    expect(result.size).toEqual(0);
  });

  test("STATE_COLORS: returns empty map for non-array value", () => {
    const result = DeltaNetComponentMapping.toSingleState(STATE_COLORS, "not-an-array");
    expect(result.size).toEqual(0);
  });
});
