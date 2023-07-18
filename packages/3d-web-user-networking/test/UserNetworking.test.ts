/**
 * @jest-environment jsdom
 */

import express from "express";
import enableWs from "express-ws";

import { UserNetworkingClient } from "../src/UserNetworkingClient";
import { UserNetworkingServer } from "../src/UserNetworkingServer";

function waitUntil(checkFn: () => boolean) {
  return new Promise((resolve, reject) => {
    if (checkFn()) {
      resolve(null);
      return;
    }

    let maxTimeout: NodeJS.Timeout | null = null;
    const interval = setInterval(() => {
      if (checkFn()) {
        clearInterval(interval);
        if (maxTimeout) {
          clearTimeout(maxTimeout);
        }
        resolve(null);
      }
    }, 10);

    maxTimeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("waitUntil timed out"));
    }, 3000);
  });
}

describe("UserNetworking", () => {
  test("should see updates end-to-end", async () => {
    const server = new UserNetworkingServer();

    const { app } = enableWs(express());
    app.ws("/user-networking", (ws: WebSocket) => {
      server.connectClient(ws);
    });
    const listener = app.listen(8585);

    const user1 = new UserNetworkingClient();
    const user2 = new UserNetworkingClient();

    await user1.connection.connect("ws://localhost:8585/user-networking");
    await user2.connection.connect("ws://localhost:8585/user-networking");

    user1.sendUpdate({
      id: 1,
      position: { x: 1, y: 2, z: 3 },
      rotation: { quaternionY: 0.1, quaternionW: 0.2 },
      state: 1,
    });

    // Wait for user 2 to see the update
    await waitUntil(
      () =>
        user2.clientUpdates.size === 2 &&
        user2.clientUpdates.has(1) &&
        user2.clientUpdates.get(1).position.x !== 0,
    );

    expect(Array.from(user2.clientUpdates.entries())).toEqual([
      [
        1,
        {
          id: 1,
          position: { x: 1, y: 2, z: 3 },
          rotation: { quaternionY: expect.closeTo(0.1), quaternionW: expect.closeTo(0.2) },
          state: 1,
        },
      ],
      [
        2,
        {
          id: 2,
          position: { x: 0, y: 0, z: 0 },
          rotation: { quaternionY: expect.closeTo(0), quaternionW: expect.closeTo(0) },
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
      () => user1.clientUpdates.has(2) && user1.clientUpdates.get(2).position.x !== 0,
    );

    expect(Array.from(user1.clientUpdates.entries())).toEqual([
      [
        1,
        {
          id: 1,
          position: { x: 1, y: 2, z: 3 },
          rotation: { quaternionY: expect.closeTo(0.1), quaternionW: expect.closeTo(0.2) },
          state: 1,
        },
      ],
      [
        2,
        {
          id: 2,
          position: { x: 2, y: 4, z: 6 },
          rotation: { quaternionY: expect.closeTo(0.2), quaternionW: expect.closeTo(0.4) },
          state: 2,
        },
      ],
    ]);

    user2.connection.ws.close();

    // Wait for user 1 to see the removal
    await waitUntil(() => !user1.clientUpdates.has(2));

    expect(Array.from(user1.clientUpdates.entries())).toEqual([
      [
        1,
        {
          id: 1,
          position: { x: 1, y: 2, z: 3 },
          rotation: { quaternionY: expect.closeTo(0.1), quaternionW: expect.closeTo(0.2) },
          state: 1,
        },
      ],
    ]);

    listener.close();
  });
});
