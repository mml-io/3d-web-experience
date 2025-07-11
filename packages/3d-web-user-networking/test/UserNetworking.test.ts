import { Server } from "node:http";

import { deltaNetProtocolSubProtocol_v0_1 } from "@deltanet/delta-net-protocol";
import { DeltaNetServer } from "@deltanet/delta-net-server";
import express from "express";
import enableWs from "express-ws";

import { UserData, UserNetworkingClientUpdate } from "../src";
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
        clientId: number,
        sessionToken: string,
        userIdentity?: UserIdentity,
      ): UserData | null => {
        if (sessionToken === sessionTokenForOne) {
          return {
            username: "user1",
            characterDescription: { meshFileUrl: "http://example.com/user1.glb" },
            colors: [[0, 0, 0]],
          };
        } else if (sessionToken === sessionTokenForTwo) {
          return {
            username: "user2",
            characterDescription: { meshFileUrl: "http://example.com/user2.glb" },
            colors: [[0, 0, 0]],
          };
        }
        return null;
      },
      onClientUserIdentityUpdate: (
        clientId: number,
        userIdentity: UserIdentity,
      ): UserData | null => {
        return null;
      },
      onClientDisconnect: (clientId: number): void => {},
    };
    server = new UserNetworkingServer(options);

    const { app } = enableWs(express(), undefined, {
      wsOptions: {
        handleProtocols: DeltaNetServer.handleWebsocketSubprotocol,
      },
    });
    app.ws("/user-networking", (ws) => {
      server!.connectClient(ws);
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
    user1 = new UserNetworkingClient({
      url: serverAddress,
      sessionToken: sessionTokenForOne,
      websocketFactory: (url) => new WebSocket(url, [deltaNetProtocolSubProtocol_v0_1]),
      statusUpdateCallback: (status) => {
        console.log("User1 WebSocket status:", status);
        if (status === WebsocketStatus.Connected) {
          user1ConnectResolve(null);
        }
      },
      assignedIdentity: (clientId: number) => {
        user1IdentityResolve(clientId);
      },
      onUpdate: (update: NetworkUpdate) => {
        if (userNetworkingClientUpdate === null) {
          user1UserStates.delete(clientId);
        } else {
          user1UserStates.set(clientId, userNetworkingClientUpdate);
        }
      },
      clientProfileUpdated: (id, username, characterDescription, colors) => {
        user1Profiles.set(id, { username, characterDescription, colors });
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
      username: "user1",
      characterDescription: { meshFileUrl: "http://example.com/user1.glb" },
      colors: [[0, 0, 0]],
    });

    const user2UserStates: Map<number, UserNetworkingClientUpdate> = new Map();
    const user2Profiles: Map<number, UserData> = new Map();
    const user2 = new UserNetworkingClient({
      url: serverAddress,
      sessionToken: sessionTokenForTwo,
      websocketFactory: (url) => new WebSocket(url, [deltaNetProtocolSubProtocol_v0_1]),
      statusUpdateCallback: (status) => {
        console.log("User2 WebSocket status:", status);
        if (status === WebsocketStatus.Connected) {
          user2ConnectResolve(null);
        }
      },
      assignedIdentity: (clientId: number) => {
        user2IdentityResolve(clientId);
      },
      clientUpdate: (
        clientId: number,
        userNetworkingClientUpdate: null | UserNetworkingClientUpdate,
      ) => {
        if (userNetworkingClientUpdate === null) {
          user2UserStates.delete(clientId);
        } else {
          user2UserStates.set(clientId, userNetworkingClientUpdate);
        }
      },
      clientProfileUpdated: (id, username, characterDescription, colors) => {
        user2Profiles.set(id, { username, characterDescription, colors });
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
      username: "user1",
      characterDescription: { meshFileUrl: "http://example.com/user1.glb" },
      colors: [[0, 0, 0]],
    });
    expect(user2Profiles.get(2)).toEqual({
      username: "user2",
      characterDescription: { meshFileUrl: "http://example.com/user2.glb" },
      colors: [[0, 0, 0]],
    });

    user1.sendUpdate({
      position: { x: 1, y: 2, z: 3 },
      rotation: { quaternionY: 0.1, quaternionW: 0.2 },
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
          rotation: { quaternionY: expect.closeTo(0.1), quaternionW: expect.closeTo(0.2) },
          state: 1,
        },
      ],
      [
        2,
        {
          position: { x: 0, y: 0, z: 0 },
          rotation: { quaternionY: 0, quaternionW: 1 },
          state: 0,
        },
      ],
    ]);

    user2.sendUpdate({
      position: { x: 2, y: 4, z: 6 },
      rotation: { quaternionY: 0.2, quaternionW: 0.4 },
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
          rotation: { quaternionY: expect.closeTo(0.1), quaternionW: expect.closeTo(0.2) },
          state: 1,
        },
      ],
      [
        2,
        {
          position: { x: 2, y: 4, z: 6 },
          rotation: { quaternionY: expect.closeTo(0.2), quaternionW: expect.closeTo(0.4) },
          state: 2,
        },
      ],
    ]);

    user2.stop();

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
            quaternionW: 0.2,
            quaternionY: 0.1,
          },
          state: 1,
        },
      ],
    ]);

    user1.stop();

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 0,
      "wait for server to see the removal of user 1",
    );
  });

  test("should handle individual state updates", async () => {
    const sessionTokenForOne = "session-token-one";
    const sessionTokenForTwo = "session-token-two";

    const options = {
      onClientConnect: (
        clientId: number,
        sessionToken: string,
        userIdentity?: UserIdentity,
      ): UserData | null => {
        if (sessionToken === sessionTokenForOne) {
          return {
            username: "user1",
            characterDescription: { meshFileUrl: "http://example.com/user1.glb" },
            colors: [[0, 0, 0]],
          };
        } else if (sessionToken === sessionTokenForTwo) {
          return {
            username: "user2",
            characterDescription: { meshFileUrl: "http://example.com/user2.glb" },
            colors: [[0, 0, 0]],
          };
        }
        return null;
      },
      onClientUserIdentityUpdate: (
        clientId: number,
        userIdentity: UserIdentity,
      ): UserData | null => {
        return null;
      },
      onClientDisconnect: (clientId: number): void => {},
    };
    server = new UserNetworkingServer(options);

    const { app } = enableWs(express(), undefined, {
      wsOptions: {
        handleProtocols: DeltaNetServer.handleWebsocketSubprotocol,
      },
    });
    app.ws("/user-networking", (ws) => {
      server!.connectClient(ws);
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
    const user1UsernameUpdates: Array<{ userId: number; username: string }> = [];
    const user1CharacterDescUpdates: Array<{ userId: number; characterDescription: any }> = [];
    const user1ColorUpdates: Array<{ userId: number; colors: Array<[number, number, number]> }> = [];

    const user1 = new UserNetworkingClient({
      url: serverAddress,
      sessionToken: sessionTokenForOne,
      websocketFactory: (url) => new WebSocket(url, [deltaNetProtocolSubProtocol_v0_1]),
      statusUpdateCallback: (status) => {
        if (status === WebsocketStatus.Connected) {
          user1ConnectResolve(null);
        }
      },
      assignedIdentity: (clientId: number) => {
        user1IdentityResolve(clientId);
      },
      clientUpdate: () => {
        // Not needed for this test
      },
      clientProfileUpdated: (id, username, characterDescription, colors) => {
        user1Profiles.set(id, { username, characterDescription, colors });
      },
      onUsernameUpdated: (userId, username) => {
        user1UsernameUpdates.push({ userId, username });
      },
      onCharacterDescriptionUpdated: (userId, characterDescription) => {
        user1CharacterDescUpdates.push({ userId, characterDescription });
      },
      onColorsUpdated: (userId, colors) => {
        user1ColorUpdates.push({ userId, colors });
      },
      onServerError: (error) => {
        console.error("Received server error", error);
      },
    });

    await user1ConnectPromise;
    expect(await user1IdentityPromise).toEqual(1);

    const user2Profiles: Map<number, UserData> = new Map();
    const user2UsernameUpdates: Array<{ userId: number; username: string }> = [];
    const user2CharacterDescUpdates: Array<{ userId: number; characterDescription: any }> = [];
    const user2ColorUpdates: Array<{ userId: number; colors: Array<[number, number, number]> }> = [];

    const user2 = new UserNetworkingClient({
      url: serverAddress,
      sessionToken: sessionTokenForTwo,
      websocketFactory: (url) => new WebSocket(url, [deltaNetProtocolSubProtocol_v0_1]),
      statusUpdateCallback: (status) => {
        if (status === WebsocketStatus.Connected) {
          user2ConnectResolve(null);
        }
      },
      assignedIdentity: (clientId: number) => {
        user2IdentityResolve(clientId);
      },
      clientUpdate: () => {
        // Not needed for this test
      },
      clientProfileUpdated: (id, username, characterDescription, colors) => {
        user2Profiles.set(id, { username, characterDescription, colors });
      },
      onUsernameUpdated: (userId, username) => {
        user2UsernameUpdates.push({ userId, username });
      },
      onCharacterDescriptionUpdated: (userId, characterDescription) => {
        user2CharacterDescUpdates.push({ userId, characterDescription });
      },
      onColorsUpdated: (userId, colors) => {
        user2ColorUpdates.push({ userId, colors });
      },
      onServerError: (error) => {
        console.error("Received server error", error);
      },
    });

    await user2ConnectPromise;
    expect(await user2IdentityPromise).toEqual(2);

    // Wait for initial profile setup
    await waitUntil(() => user1Profiles.has(1) && user1Profiles.has(2), "wait for user1 to see both profiles");
    await waitUntil(() => user2Profiles.has(1) && user2Profiles.has(2), "wait for user2 to see both profiles");

    user1UsernameUpdates.length = 0;
    user1CharacterDescUpdates.length = 0;
    user1ColorUpdates.length = 0;
    user2UsernameUpdates.length = 0;
    user2CharacterDescUpdates.length = 0;
    user2ColorUpdates.length = 0;

    // Test individual username update
    user1.updateUsername("updated-user1");
    
    await waitUntil(() => user2UsernameUpdates.length > 0, "wait for user2 to see username update");
    
    expect(user2UsernameUpdates[user2UsernameUpdates.length - 1]).toEqual({
      userId: 1,
      username: "updated-user1",
    });

    // Test individual character description update
    user2CharacterDescUpdates.length = 0;
    const newCharacterDescription = { meshFileUrl: "http://example.com/new-user1.glb" };
    user1.updateCharacterDescription(newCharacterDescription);
    
    await waitUntil(() => user2CharacterDescUpdates.length > 0, "wait for user2 to see character description update");
    
    expect(user2CharacterDescUpdates[user2CharacterDescUpdates.length - 1]).toEqual({
      userId: 1,
      characterDescription: newCharacterDescription,
    });

    // Test individual colors update
    user2ColorUpdates.length = 0;
    const newColors: Array<[number, number, number]> = [[255, 0, 0], [0, 255, 0]];
    user1.updateColors(newColors);
    
    await waitUntil(() => user2ColorUpdates.length > 0, "wait for user2 to see colors update");
    
    expect(user2ColorUpdates[user2ColorUpdates.length - 1]).toEqual({
      userId: 1,
      colors: newColors,
    });

    // Test batch update
    user2UsernameUpdates.length = 0;
    user2CharacterDescUpdates.length = 0;
    user2ColorUpdates.length = 0;
    
    user1.updateUserStates({
      username: "batch-updated-user1",
      characterDescription: { meshFileUrl: "http://example.com/batch-user1.glb" },
      colors: [[128, 128, 128]],
    });

    await waitUntil(() => 
      user2UsernameUpdates.length > 0 && user2CharacterDescUpdates.length > 0 && user2ColorUpdates.length > 0,
      "wait for batch update to be received"
    );

    // Test getter methods
    expect(user1.getMyUsername()).toBe("batch-updated-user1");
    expect(user1.getMyCharacterDescription()).toEqual({ meshFileUrl: "http://example.com/batch-user1.glb" });
    expect(user1.getMyColors()).toEqual([[128, 128, 128]]);

    user1.stop();
    user2.stop();
  }, 15000);
});
