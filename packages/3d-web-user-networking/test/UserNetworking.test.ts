import { Server } from "node:http";

import { deltaNetProtocolSubProtocol_v0_1 } from "@deltanet/delta-net-protocol";
import { DeltaNetServer } from "@deltanet/delta-net-server";
import express from "express";
import enableWs from "express-ws";

import { UserData, UserIdentity, UserNetworkingClientUpdate } from "../src";
import { WebsocketStatus } from "../src/types";
import { UserNetworkingClient } from "../src/UserNetworkingClient";
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
      clientUpdate: (
        clientId: number,
        userNetworkingClientUpdate: null | UserNetworkingClientUpdate,
      ) => {
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
      id: 1,
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
          id: 1000,
          position: { x: 1, y: 2, z: 3 },
          rotation: { quaternionY: expect.closeTo(0.1), quaternionW: expect.closeTo(0.2) },
          state: 1,
        },
      ],
      [
        2,
        {
          id: 1001,
          position: { x: 0, y: 0, z: 0 },
          rotation: { quaternionY: 0, quaternionW: 1 },
          state: 0,
        },
      ],
    ]);

    user2.sendUpdate({
      id: 2,
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
          id: 1000,
          position: { x: 1, y: 2, z: 3 },
          rotation: { quaternionY: expect.closeTo(0.1), quaternionW: expect.closeTo(0.2) },
          state: 1,
        },
      ],
      [
        2,
        {
          id: 1001,
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
          id: 1000,
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
});
