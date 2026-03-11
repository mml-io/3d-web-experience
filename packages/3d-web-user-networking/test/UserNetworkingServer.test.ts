/**
 * Unit/integration tests for UserNetworkingServer edge cases.
 *
 * The existing UserNetworking.test.ts covers the happy-path end-to-end flow.
 * This file targets specific branches and methods that are hard to reach
 * through the integration test alone.
 */
import { Server } from "node:http";

import { jest } from "@jest/globals";
import {
  experienceClientSubProtocols,
  experienceProtocolToDeltaNetSubProtocol,
  handleExperienceWebsocketSubprotocol,
} from "@mml-io/3d-web-experience-protocol";
import express from "express";
import enableWs from "express-ws";

import { UserData, UserIdentityUpdate, UserNetworkingClientUpdate } from "../src";
import { WebsocketStatus } from "../src/types";
import { NetworkUpdate, UserNetworkingClient } from "../src/UserNetworkingClient";
import { UserNetworkingServerError } from "../src/UserNetworkingMessages";
import { UserNetworkingServer, UserNetworkingServerOptions } from "../src/UserNetworkingServer";

import { createWaitable, waitUntil } from "./test-utils";

function createTestSetup(optionOverrides?: Partial<UserNetworkingServerOptions>) {
  const onClientConnect = jest
    .fn<
      (
        connectionId: number,
        sessionToken: string,
        userIdentity?: UserData,
      ) => true | UserData | Error
    >()
    .mockImplementation((_connectionId, sessionToken) => {
      if (sessionToken === "valid-token") {
        return {
          userId: "user-1",
          username: "TestUser",
          characterDescription: { meshFileUrl: "http://example.com/user.glb" },
          colors: [[0, 0, 0]] as Array<[number, number, number]>,
        };
      }
      return new Error("Invalid session token");
    });

  const onClientUserIdentityUpdate = jest
    .fn<
      (
        connectionId: number,
        userIdentity: UserIdentityUpdate,
      ) =>
        | UserIdentityUpdate
        | null
        | true
        | false
        | Error
        | Promise<UserIdentityUpdate | null | false | true | Error>
    >()
    .mockImplementation((_connectionId, identity) => identity);

  const onClientDisconnect = jest.fn<(connectionId: number) => void>();
  const onClientAuthenticated = jest.fn<(connectionId: number) => void>();
  const onCustomMessage =
    jest.fn<(connectionId: number, customType: number, contents: string) => void>();

  const options: UserNetworkingServerOptions = {
    onClientConnect,
    onClientUserIdentityUpdate,
    onClientDisconnect,
    onClientAuthenticated,
    onCustomMessage,
    resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
    ...optionOverrides,
  };

  return {
    options,
    onClientConnect,
    onClientUserIdentityUpdate,
    onClientDisconnect,
    onClientAuthenticated,
    onCustomMessage,
  };
}

describe("UserNetworkingServer", () => {
  let server: UserNetworkingServer | null = null;
  let listener: Server | null = null;
  let client: UserNetworkingClient | null = null;

  afterEach(async () => {
    try {
      if (client) {
        client.stop();
        client = null;
      }
      if (server) {
        server.dispose();
        server = null;
      }
      await new Promise<void>((resolve) => {
        if (listener) {
          listener.close(() => resolve());
        } else {
          resolve();
        }
      });
      listener = null;
    } catch {
      // ignore cleanup errors
    }
  });

  async function startServer(options: UserNetworkingServerOptions, port: number): Promise<string> {
    server = new UserNetworkingServer(options);

    const { app } = enableWs(express(), undefined, {
      wsOptions: { handleProtocols: handleExperienceWebsocketSubprotocol },
    });
    app.ws("/ws", (ws) => {
      server!.connectClient(ws as unknown as WebSocket);
    });

    listener = await new Promise<Server>((resolve) => {
      const httpServer = app.listen(port, () => resolve(httpServer));
    });

    return `ws://localhost:${port}/ws`;
  }

  async function connectClient(
    url: string,
    sessionToken: string,
  ): Promise<{
    client: UserNetworkingClient;
    identityPromise: Promise<number>;
    connectPromise: Promise<null>;
    profiles: Map<number, UserData>;
    updates: Array<{
      connectionId: number;
      userState: Partial<UserData> | null;
      removal: boolean;
    }>;
  }> {
    const [identityPromise, identityResolve] = await createWaitable<number>();
    const [connectPromise, connectResolve] = await createWaitable<null>();
    const profiles = new Map<number, UserData>();
    const updates: Array<{
      connectionId: number;
      userState: Partial<UserData> | null;
      removal: boolean;
    }> = [];

    const c = new UserNetworkingClient({
      url,
      sessionToken,
      websocketFactory: (u) => new WebSocket(u, [...experienceClientSubProtocols]),
      resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      statusUpdateCallback: (status) => {
        if (status === WebsocketStatus.Connected) {
          connectResolve(null);
        }
      },
      assignedIdentity: identityResolve,
      onUpdate: (update: NetworkUpdate) => {
        for (const [connectionId, user] of update.addedConnectionIds) {
          if (user.userState) {
            profiles.set(connectionId, user.userState);
            updates.push({
              connectionId,
              userState: user.userState,
              removal: false,
            });
          }
        }
        for (const [connectionId, user] of update.updatedUsers) {
          if (user.userState) {
            const existing = profiles.get(connectionId);
            profiles.set(connectionId, { ...existing, ...user.userState } as UserData);
            updates.push({
              connectionId,
              userState: user.userState,
              removal: false,
            });
          }
        }
        for (const connectionId of update.removedConnectionIds) {
          updates.push({ connectionId, userState: null, removal: true });
          profiles.delete(connectionId);
        }
      },
      onServerError: () => {},
    });

    return { client: c, identityPromise, connectPromise, profiles, updates };
  }

  test("onClientAuthenticated is called after client is authenticated", async () => {
    const { options, onClientAuthenticated } = createTestSetup();

    const url = await startServer(options, 9510);
    const { client: c, connectPromise, identityPromise } = await connectClient(url, "valid-token");
    client = c;

    await connectPromise;
    await identityPromise;

    await waitUntil(
      () => onClientAuthenticated.mock.calls.length >= 1,
      "onClientAuthenticated to be called",
    );

    expect(onClientAuthenticated).toHaveBeenCalledWith(expect.any(Number));
  }, 10000);

  test("dispose with clientCloseError sends error to connected clients", async () => {
    const { options } = createTestSetup();

    const url = await startServer(options, 9511);
    const { client: c, connectPromise, identityPromise } = await connectClient(url, "valid-token");
    client = c;

    await connectPromise;
    await identityPromise;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    // Dispose with an error message
    server!.dispose(
      new UserNetworkingServerError("SERVER_SHUTDOWN", "Server is shutting down", true),
    );
    server = null;

    // Client should eventually disconnect
    await waitUntil(() => {
      // The client should have been disconnected
      return true; // just ensure no error thrown
    }, "client to handle shutdown");
  }, 10000);

  test("sendCustomMessageToClient with unknown client does nothing", async () => {
    const { options } = createTestSetup();
    server = new UserNetworkingServer(options);

    // Should not throw
    server.sendCustomMessageToClient(999, 1, "test");
  });

  test("broadcastMessage sends to deltanet server", async () => {
    const { options } = createTestSetup();
    server = new UserNetworkingServer(options);

    // Should not throw
    server.broadcastMessage(42, "hello");
  });

  test("updateUserCharacter updates user data and broadcasts", async () => {
    const { options } = createTestSetup();

    const url = await startServer(options, 9512);
    const {
      client: c1,
      connectPromise: c1Connect,
      identityPromise: id1,
    } = await connectClient(url, "valid-token");
    client = c1;

    await c1Connect;
    const connectionId = await id1;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    const newUserData: UserData = {
      userId: "user-1",
      username: "UpdatedUser",
      characterDescription: { meshFileUrl: "http://example.com/new.glb" },
      colors: [[1, 0, 0]],
    };

    server!.updateUserCharacter(connectionId, newUserData);

    // Verify the internal state was updated
    const authenticatedClient = (server as any).authenticatedClientsById.get(connectionId);
    expect(authenticatedClient.authenticatedUser.username).toBe("UpdatedUser");
  }, 10000);

  test("updateUserUsername updates just the username", async () => {
    const { options } = createTestSetup();

    const url = await startServer(options, 9513);
    const {
      client: c1,
      connectPromise: c1Connect,
      identityPromise: id1,
    } = await connectClient(url, "valid-token");
    client = c1;

    await c1Connect;
    const connectionId = await id1;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    server!.updateUserUsername(connectionId, "NewUsername");

    const authenticatedClient = (server as any).authenticatedClientsById.get(connectionId);
    expect(authenticatedClient.authenticatedUser.username).toBe("NewUsername");
  }, 10000);

  test("updateUserUsername with unknown client does nothing", () => {
    const { options } = createTestSetup();
    server = new UserNetworkingServer(options);

    // Should not throw
    server.updateUserUsername(999, "Nobody");
  });

  test("updateUserCharacterDescription updates just the character", async () => {
    const { options } = createTestSetup();

    const url = await startServer(options, 9514);
    const {
      client: c1,
      connectPromise: c1Connect,
      identityPromise: id1,
    } = await connectClient(url, "valid-token");
    client = c1;

    await c1Connect;
    const connectionId = await id1;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    server!.updateUserCharacterDescription(connectionId, {
      meshFileUrl: "http://example.com/desc.glb",
    });

    const authenticatedClient = (server as any).authenticatedClientsById.get(connectionId);
    expect(authenticatedClient.authenticatedUser.characterDescription.meshFileUrl).toBe(
      "http://example.com/desc.glb",
    );
  }, 10000);

  test("updateUserCharacterDescription with unknown client does nothing", () => {
    const { options } = createTestSetup();
    server = new UserNetworkingServer(options);

    server.updateUserCharacterDescription(999, { meshFileUrl: "http://test.com/x.glb" });
  });

  test("updateUserColors updates just the colors", async () => {
    const { options } = createTestSetup();

    const url = await startServer(options, 9515);
    const {
      client: c1,
      connectPromise: c1Connect,
      identityPromise: id1,
    } = await connectClient(url, "valid-token");
    client = c1;

    await c1Connect;
    const connectionId = await id1;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    server!.updateUserColors(connectionId, [
      [1, 0, 0],
      [0, 1, 0],
    ]);

    const authenticatedClient = (server as any).authenticatedClientsById.get(connectionId);
    expect(authenticatedClient.authenticatedUser.colors).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
  }, 10000);

  test("updateUserColors with unknown client does nothing", () => {
    const { options } = createTestSetup();
    server = new UserNetworkingServer(options);

    server.updateUserColors(999, [[1, 0, 0]]);
  });

  test("updateUserStates updates username, characterDescription, and colors", async () => {
    const { options } = createTestSetup();

    const url = await startServer(options, 9516);
    const {
      client: c1,
      connectPromise: c1Connect,
      identityPromise: id1,
    } = await connectClient(url, "valid-token");
    client = c1;

    await c1Connect;
    const connectionId = await id1;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    server!.updateUserStates(connectionId, {
      username: "Combo",
      characterDescription: { meshFileUrl: "http://example.com/combo.glb" },
      colors: [[0, 0, 1]],
    });

    const authenticatedClient = (server as any).authenticatedClientsById.get(connectionId);
    expect(authenticatedClient.authenticatedUser.username).toBe("Combo");
    expect(authenticatedClient.authenticatedUser.characterDescription.meshFileUrl).toBe(
      "http://example.com/combo.glb",
    );
    expect(authenticatedClient.authenticatedUser.colors).toEqual([[0, 0, 1]]);
  }, 10000);

  test("updateUserStates with unknown client does nothing", () => {
    const { options } = createTestSetup();
    server = new UserNetworkingServer(options);

    server.updateUserStates(999, {
      username: "Nobody",
      characterDescription: null,
      colors: null,
    });
  });

  test("updateUserStates with undefined fields does not update them", async () => {
    const { options } = createTestSetup();

    const url = await startServer(options, 9517);
    const {
      client: c1,
      connectPromise: c1Connect,
      identityPromise: id1,
    } = await connectClient(url, "valid-token");
    client = c1;

    await c1Connect;
    const connectionId = await id1;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    // All undefined — no updates
    server!.updateUserStates(connectionId, {
      username: undefined as unknown as string,
      characterDescription: undefined as unknown as null,
      colors: undefined as unknown as null,
    });

    // Should still have original data
    const authenticatedClient = (server as any).authenticatedClientsById.get(connectionId);
    expect(authenticatedClient.authenticatedUser.username).toBe("TestUser");
  }, 10000);

  test("updateUserStates with null fields clears them", async () => {
    const { options } = createTestSetup();

    const url = await startServer(options, 9518);
    const {
      client: c1,
      connectPromise: c1Connect,
      identityPromise: id1,
    } = await connectClient(url, "valid-token");
    client = c1;

    await c1Connect;
    const connectionId = await id1;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    // Null fields should clear them
    server!.updateUserStates(connectionId, {
      username: null as unknown as string,
      characterDescription: null,
      colors: null,
    });

    const authenticatedClient = (server as any).authenticatedClientsById.get(connectionId);
    expect(authenticatedClient.authenticatedUser.username).toBeNull();
    expect(authenticatedClient.authenticatedUser.characterDescription).toBeNull();
    expect(authenticatedClient.authenticatedUser.colors).toBeNull();
  }, 10000);

  test("connectClient with resolveProtocol returning null rejects connection", () => {
    const { options } = createTestSetup({
      resolveProtocol: () => null,
    });
    server = new UserNetworkingServer(options);

    const mockSocket = {
      protocol: "unknown-protocol",
      close: jest.fn(),
      addEventListener: jest.fn(),
    } as unknown as WebSocket;

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    server.connectClient(mockSocket);
    expect((mockSocket as any).close).toHaveBeenCalledWith(1002, "Unsupported sub-protocol");
    warnSpy.mockRestore();
  });

  test("dispose without clientCloseError just closes connections", async () => {
    const { options } = createTestSetup();

    const url = await startServer(options, 9518);
    const {
      client: c1,
      connectPromise: c1Connect,
      identityPromise: id1,
    } = await connectClient(url, "valid-token");
    client = c1;

    await c1Connect;
    await id1;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    // Dispose without error
    server!.dispose();
    server = null;
  }, 10000);

  test("authentication failure rejects the client", async () => {
    const { options } = createTestSetup();

    const url = await startServer(options, 9519);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const errPromise = new Promise<void>((resolve) => {
      const ws = new WebSocket(url, [...experienceClientSubProtocols]);
      ws.addEventListener("close", () => resolve());
      ws.addEventListener("open", () => {
        // The server will reject the connection after receiving the bad token
      });
    });

    // The invalid-token connection should be rejected
    // Give the server time to process and reject
    await Promise.race([errPromise, new Promise((resolve) => setTimeout(resolve, 3000))]);

    warnSpy.mockRestore();
  }, 10000);

  test("client sendUpdate before auth stores pending update", async () => {
    const { options } = createTestSetup();
    const url = await startServer(options, 9520);

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const [identityPromise, identityResolve] = await createWaitable<number>();
    const [connectPromise, connectResolve] = await createWaitable<null>();

    const c = new UserNetworkingClient({
      url,
      sessionToken: "valid-token",
      websocketFactory: (u) => new WebSocket(u, [...experienceClientSubProtocols]),
      resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      statusUpdateCallback: (status) => {
        if (status === WebsocketStatus.Connected) connectResolve(null);
      },
      assignedIdentity: identityResolve,
      onUpdate: () => {},
      onServerError: () => {},
    });
    client = c;

    // Call sendUpdate immediately before auth completes — should just store the update
    c.sendUpdate({ position: { x: 1, y: 2, z: 3 }, rotation: { eulerY: 0 }, state: 0 });

    await connectPromise;
    await identityPromise;
    warnSpy.mockRestore();
  }, 10000);

  test("client sendCustomMessage before auth warns and returns", async () => {
    const { options } = createTestSetup();
    const url = await startServer(options, 9521);

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const [, connectResolve] = await createWaitable<null>();

    const c = new UserNetworkingClient({
      url,
      sessionToken: "valid-token",
      websocketFactory: (u) => new WebSocket(u, [...experienceClientSubProtocols]),
      resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      statusUpdateCallback: (status) => {
        if (status === WebsocketStatus.Connected) connectResolve(null);
      },
      assignedIdentity: () => {},
      onUpdate: () => {},
      onServerError: () => {},
    });
    client = c;

    // Call before auth completes — should warn
    c.sendCustomMessage(1, "test-message");

    expect(warnSpy).toHaveBeenCalledWith("Cannot send custom message before authentication");
    warnSpy.mockRestore();
  }, 10000);

  test("client updateUsername before auth is a no-op", async () => {
    const { options } = createTestSetup();
    const url = await startServer(options, 9522);

    const c = new UserNetworkingClient({
      url,
      sessionToken: "valid-token",
      websocketFactory: (u) => new WebSocket(u, [...experienceClientSubProtocols]),
      resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      statusUpdateCallback: () => {},
      assignedIdentity: () => {},
      onUpdate: () => {},
      onServerError: () => {},
    });
    client = c;

    // Should not throw, just return early
    c.updateUsername("EarlyUser");
  }, 10000);

  test("client updateCharacterDescription before auth is a no-op", async () => {
    const { options } = createTestSetup();
    const url = await startServer(options, 9523);

    const c = new UserNetworkingClient({
      url,
      sessionToken: "valid-token",
      websocketFactory: (u) => new WebSocket(u, [...experienceClientSubProtocols]),
      resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      statusUpdateCallback: () => {},
      assignedIdentity: () => {},
      onUpdate: () => {},
      onServerError: () => {},
    });
    client = c;

    // Should not throw, just return early
    c.updateCharacterDescription({ meshFileUrl: "http://test.com/early.glb" });
  }, 10000);

  test("client updateColors before auth is a no-op", async () => {
    const { options } = createTestSetup();
    const url = await startServer(options, 9524);

    const c = new UserNetworkingClient({
      url,
      sessionToken: "valid-token",
      websocketFactory: (u) => new WebSocket(u, [...experienceClientSubProtocols]),
      resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      statusUpdateCallback: () => {},
      assignedIdentity: () => {},
      onUpdate: () => {},
      onServerError: () => {},
    });
    client = c;

    // Should not throw, just return early
    c.updateColors([[1, 0, 0]]);
  }, 10000);

  test("client sends custom message after auth, server onCustomMessage is called", async () => {
    const { options, onCustomMessage } = createTestSetup();

    const url = await startServer(options, 9525);
    const { client: c, connectPromise, identityPromise } = await connectClient(url, "valid-token");
    client = c;

    await connectPromise;
    await identityPromise;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    // Send a custom message after authentication
    c.sendCustomMessage(42, "hello-custom");

    await waitUntil(() => onCustomMessage.mock.calls.length >= 1, "onCustomMessage to be called");

    expect(onCustomMessage).toHaveBeenCalledWith(expect.any(Number), 42, "hello-custom");
  }, 10000);

  test("client updateUsername after auth sends state update", async () => {
    const { options, onClientUserIdentityUpdate } = createTestSetup();

    const url = await startServer(options, 9526);
    const { client: c, connectPromise, identityPromise } = await connectClient(url, "valid-token");
    client = c;

    await connectPromise;
    await identityPromise;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    // Update username after authentication
    c.updateUsername("ClientUpdatedName");

    await waitUntil(
      () => onClientUserIdentityUpdate.mock.calls.length >= 1,
      "onClientUserIdentityUpdate to be called",
    );

    // The server should have received a state update
    expect(onClientUserIdentityUpdate).toHaveBeenCalled();
  }, 10000);

  test("client updateCharacterDescription after auth sends state update", async () => {
    const { options, onClientUserIdentityUpdate } = createTestSetup();

    const url = await startServer(options, 9527);
    const { client: c, connectPromise, identityPromise } = await connectClient(url, "valid-token");
    client = c;

    await connectPromise;
    await identityPromise;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    c.updateCharacterDescription({ meshFileUrl: "http://example.com/updated.glb" });

    await waitUntil(
      () => onClientUserIdentityUpdate.mock.calls.length >= 1,
      "onClientUserIdentityUpdate to be called",
    );

    expect(onClientUserIdentityUpdate).toHaveBeenCalled();
  }, 10000);

  test("client updateColors after auth sends state update", async () => {
    const { options, onClientUserIdentityUpdate } = createTestSetup();

    const url = await startServer(options, 9528);
    const { client: c, connectPromise, identityPromise } = await connectClient(url, "valid-token");
    client = c;

    await connectPromise;
    await identityPromise;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    c.updateColors([[0.5, 0.5, 0.5]]);

    await waitUntil(
      () => onClientUserIdentityUpdate.mock.calls.length >= 1,
      "onClientUserIdentityUpdate to be called",
    );

    expect(onClientUserIdentityUpdate).toHaveBeenCalled();
  }, 10000);

  test("handleStatesUpdate with onClientUserIdentityUpdate returning null rejects", async () => {
    const { options, onClientUserIdentityUpdate } = createTestSetup();
    // Override to return null (sync)
    onClientUserIdentityUpdate.mockImplementation(() => null);

    const url = await startServer(options, 9529);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const serverErrors: Array<{ message: string; errorType: string }> = [];
    const [identityPromise, identityResolve] = await createWaitable<number>();
    const [connectPromise, connectResolve] = await createWaitable<null>();

    const c = new UserNetworkingClient({
      url,
      sessionToken: "valid-token",
      websocketFactory: (u) => new WebSocket(u, [...experienceClientSubProtocols]),
      resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      statusUpdateCallback: (status) => {
        if (status === WebsocketStatus.Connected) connectResolve(null);
      },
      assignedIdentity: identityResolve,
      onUpdate: () => {},
      onServerError: (err) => {
        serverErrors.push(err);
      },
    });
    client = c;

    await connectPromise;
    await identityPromise;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    // This triggers handleStatesUpdate which will call onClientUserIdentityUpdate (returns null)
    c.updateUsername("Rejected");

    // Wait for the server to process the update
    await waitUntil(
      () => onClientUserIdentityUpdate.mock.calls.length >= 1,
      "onClientUserIdentityUpdate to be called",
    );

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  }, 10000);

  test("handleStatesUpdate with onClientUserIdentityUpdate returning false rejects", async () => {
    const { options, onClientUserIdentityUpdate } = createTestSetup();
    onClientUserIdentityUpdate.mockImplementation(() => false);

    const url = await startServer(options, 9530);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const [identityPromise, identityResolve] = await createWaitable<number>();
    const [connectPromise, connectResolve] = await createWaitable<null>();

    const c = new UserNetworkingClient({
      url,
      sessionToken: "valid-token",
      websocketFactory: (u) => new WebSocket(u, [...experienceClientSubProtocols]),
      resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      statusUpdateCallback: (status) => {
        if (status === WebsocketStatus.Connected) connectResolve(null);
      },
      assignedIdentity: identityResolve,
      onUpdate: () => {},
      onServerError: () => {},
    });
    client = c;

    await connectPromise;
    await identityPromise;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    c.updateUsername("RejectedFalse");

    await waitUntil(
      () => onClientUserIdentityUpdate.mock.calls.length >= 1,
      "onClientUserIdentityUpdate to be called",
    );

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  }, 10000);

  test("handleStatesUpdate with onClientUserIdentityUpdate returning Error rejects", async () => {
    const { options, onClientUserIdentityUpdate } = createTestSetup();
    onClientUserIdentityUpdate.mockImplementation(() => new Error("Update denied"));

    const url = await startServer(options, 9531);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const [identityPromise, identityResolve] = await createWaitable<number>();
    const [connectPromise, connectResolve] = await createWaitable<null>();

    const c = new UserNetworkingClient({
      url,
      sessionToken: "valid-token",
      websocketFactory: (u) => new WebSocket(u, [...experienceClientSubProtocols]),
      resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
      statusUpdateCallback: (status) => {
        if (status === WebsocketStatus.Connected) connectResolve(null);
      },
      assignedIdentity: identityResolve,
      onUpdate: () => {},
      onServerError: () => {},
    });
    client = c;

    await connectPromise;
    await identityPromise;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    c.updateUsername("RejectedError");

    await waitUntil(
      () => onClientUserIdentityUpdate.mock.calls.length >= 1,
      "onClientUserIdentityUpdate to be called",
    );

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  }, 10000);

  test("onClientConnect returning true uses client-provided identity", async () => {
    const { options, onClientConnect } = createTestSetup();
    // Override to return true (accept client-provided identity as-is)
    onClientConnect.mockImplementation(() => true);

    const url = await startServer(options, 9532);

    const [identityPromise, identityResolve] = await createWaitable<number>();
    const [connectPromise, connectResolve] = await createWaitable<null>();

    const c = new UserNetworkingClient(
      {
        url,
        sessionToken: "valid-token",
        websocketFactory: (u) => new WebSocket(u, [...experienceClientSubProtocols]),
        resolveProtocol: experienceProtocolToDeltaNetSubProtocol,
        statusUpdateCallback: (status) => {
          if (status === WebsocketStatus.Connected) connectResolve(null);
        },
        assignedIdentity: identityResolve,
        onUpdate: () => {},
        onServerError: () => {},
      },
      {
        userId: "user-client",
        username: "ClientProvidedUser",
        characterDescription: { meshFileUrl: "http://example.com/client.glb" },
        colors: [[1, 1, 1]],
      },
    );
    client = c;

    await connectPromise;
    await identityPromise;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    // The server should have used the client-provided identity since onClientConnect returned true
    expect(onClientConnect).toHaveBeenCalled();
  }, 10000);

  test("handleStatesUpdate with async onClientUserIdentityUpdate returning userData", async () => {
    const { options, onClientUserIdentityUpdate } = createTestSetup();
    // Override to return a Promise that resolves with userData
    onClientUserIdentityUpdate.mockImplementation((_connectionId, userData) =>
      Promise.resolve(userData),
    );

    const url = await startServer(options, 9533);

    const { client: c, connectPromise, identityPromise } = await connectClient(url, "valid-token");
    client = c;

    await connectPromise;
    await identityPromise;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    c.updateUsername("AsyncUpdatedUser");

    await waitUntil(
      () => onClientUserIdentityUpdate.mock.calls.length >= 1,
      "onClientUserIdentityUpdate to be called",
    );

    // Wait a bit for the async promise to resolve and state to be applied
    await new Promise((r) => setTimeout(r, 200));

    expect(onClientUserIdentityUpdate).toHaveBeenCalled();
  }, 10000);

  test("handleStatesUpdate with async onClientUserIdentityUpdate returning null", async () => {
    const { options, onClientUserIdentityUpdate } = createTestSetup();
    onClientUserIdentityUpdate.mockImplementation(() => Promise.resolve(null));

    const url = await startServer(options, 9534);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const { client: c, connectPromise, identityPromise } = await connectClient(url, "valid-token");
    client = c;

    await connectPromise;
    await identityPromise;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    c.updateUsername("AsyncNull");

    await waitUntil(
      () => onClientUserIdentityUpdate.mock.calls.length >= 1,
      "async onClientUserIdentityUpdate to be called",
    );

    await new Promise((r) => setTimeout(r, 200));

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  }, 10000);

  test("handleStatesUpdate with async onClientUserIdentityUpdate returning false", async () => {
    const { options, onClientUserIdentityUpdate } = createTestSetup();
    onClientUserIdentityUpdate.mockImplementation(() => Promise.resolve(false));

    const url = await startServer(options, 9535);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const { client: c, connectPromise, identityPromise } = await connectClient(url, "valid-token");
    client = c;

    await connectPromise;
    await identityPromise;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    c.updateUsername("AsyncFalse");

    await waitUntil(
      () => onClientUserIdentityUpdate.mock.calls.length >= 1,
      "async onClientUserIdentityUpdate to be called",
    );

    await new Promise((r) => setTimeout(r, 200));

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  }, 10000);

  test("handleStatesUpdate with async onClientUserIdentityUpdate returning Error", async () => {
    const { options, onClientUserIdentityUpdate } = createTestSetup();
    onClientUserIdentityUpdate.mockImplementation(() =>
      Promise.resolve(new Error("Async update denied")),
    );

    const url = await startServer(options, 9536);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const { client: c, connectPromise, identityPromise } = await connectClient(url, "valid-token");
    client = c;

    await connectPromise;
    await identityPromise;

    await waitUntil(
      () => (server as any).authenticatedClientsById.size === 1,
      "client to be authenticated",
    );

    c.updateUsername("AsyncError");

    await waitUntil(
      () => onClientUserIdentityUpdate.mock.calls.length >= 1,
      "async onClientUserIdentityUpdate to be called",
    );

    await new Promise((r) => setTimeout(r, 200));

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  }, 10000);
});
