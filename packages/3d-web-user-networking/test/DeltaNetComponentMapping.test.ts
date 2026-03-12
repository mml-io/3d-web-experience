import { describe, expect, test, jest } from "@jest/globals";

import {
  DeltaNetComponentMapping,
  COMPONENT_POSITION_X,
  COMPONENT_POSITION_Y,
  COMPONENT_POSITION_Z,
  COMPONENT_ROTATION_Y,
  COMPONENT_STATE,
  STATE_USERNAME,
  STATE_CHARACTER_DESCRIPTION,
  STATE_COLORS,
  STATE_INTERNAL_CONNECTION_ID,
  STATE_USER_ID,
  positionMultiplier,
  rotationMultiplier,
} from "../src/DeltaNetComponentMapping";
import type { UserNetworkingClientUpdate } from "../src/types";
import type { UserData } from "../src/UserData";

const mockLogger = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};

describe("DeltaNetComponentMapping", () => {
  describe("component constants", () => {
    test("position IDs are 1-3", () => {
      expect(COMPONENT_POSITION_X).toBe(1);
      expect(COMPONENT_POSITION_Y).toBe(2);
      expect(COMPONENT_POSITION_Z).toBe(3);
    });

    test("rotation ID is 4", () => {
      expect(COMPONENT_ROTATION_Y).toBe(4);
    });

    test("state ID is 5", () => {
      expect(COMPONENT_STATE).toBe(5);
    });

    test("state IDs are sequential", () => {
      expect(STATE_INTERNAL_CONNECTION_ID).toBe(0);
      expect(STATE_CHARACTER_DESCRIPTION).toBe(1);
      expect(STATE_USERNAME).toBe(2);
      expect(STATE_COLORS).toBe(3);
      expect(STATE_USER_ID).toBe(4);
    });

    test("multipliers", () => {
      expect(positionMultiplier).toBe(100);
      expect(rotationMultiplier).toBe(10000);
    });
  });

  describe("toComponents / fromComponents round-trip", () => {
    test("round-trips position values", () => {
      const update: UserNetworkingClientUpdate = {
        position: { x: 1.5, y: -2.75, z: 10.123 },
        rotation: { eulerY: 0 },
        state: 0,
      };
      const components = DeltaNetComponentMapping.toComponents(update);
      const result = DeltaNetComponentMapping.fromComponents(components);

      expect(result.position.x).toBeCloseTo(1.5, 1);
      expect(result.position.y).toBeCloseTo(-2.75, 1);
      expect(result.position.z).toBeCloseTo(10.12, 1);
    });

    test("round-trips rotation values", () => {
      const angle = Math.PI / 2; // 90 degrees
      const update: UserNetworkingClientUpdate = {
        position: { x: 0, y: 0, z: 0 },
        rotation: { eulerY: angle },
        state: 0,
      };
      const components = DeltaNetComponentMapping.toComponents(update);
      const result = DeltaNetComponentMapping.fromComponents(components);

      expect(result.rotation.eulerY).toBeCloseTo(angle, 2);
    });

    test("round-trips animation state", () => {
      const update: UserNetworkingClientUpdate = {
        position: { x: 0, y: 0, z: 0 },
        rotation: { eulerY: 0 },
        state: 4,
      };
      const components = DeltaNetComponentMapping.toComponents(update);
      const result = DeltaNetComponentMapping.fromComponents(components);
      expect(result.state).toBe(4);
    });

    test("handles negative position values", () => {
      const update: UserNetworkingClientUpdate = {
        position: { x: -50.5, y: -100, z: -0.01 },
        rotation: { eulerY: 0 },
        state: 0,
      };
      const components = DeltaNetComponentMapping.toComponents(update);
      const result = DeltaNetComponentMapping.fromComponents(components);

      expect(result.position.x).toBeCloseTo(-50.5, 1);
      expect(result.position.y).toBeCloseTo(-100, 1);
      expect(result.position.z).toBeCloseTo(-0.01, 1);
    });

    test("handles zero values", () => {
      const update: UserNetworkingClientUpdate = {
        position: { x: 0, y: 0, z: 0 },
        rotation: { eulerY: 0 },
        state: 0,
      };
      const components = DeltaNetComponentMapping.toComponents(update);
      const result = DeltaNetComponentMapping.fromComponents(components);
      expect(result.position).toEqual({ x: 0, y: 0, z: 0 });
    });
  });

  describe("position precision", () => {
    test("position is multiplied by 100 for fixed-point", () => {
      const update: UserNetworkingClientUpdate = {
        position: { x: 1, y: 0, z: 0 },
        rotation: { eulerY: 0 },
        state: 0,
      };
      const components = DeltaNetComponentMapping.toComponents(update);
      expect(components.get(COMPONENT_POSITION_X)).toBe(BigInt(100));
    });

    test("position precision is 0.01 units", () => {
      const update: UserNetworkingClientUpdate = {
        position: { x: 1.23, y: 0, z: 0 },
        rotation: { eulerY: 0 },
        state: 0,
      };
      const components = DeltaNetComponentMapping.toComponents(update);
      const result = DeltaNetComponentMapping.fromComponents(components);
      expect(result.position.x).toBeCloseTo(1.23, 2);
    });
  });

  describe("fromComponents with missing components", () => {
    test("defaults to zero for missing components", () => {
      const components = new Map<number, bigint>();
      const result = DeltaNetComponentMapping.fromComponents(components);
      expect(result.position).toEqual({ x: 0, y: 0, z: 0 });
      expect(result.rotation.eulerY).toBe(0);
      expect(result.state).toBe(0);
    });
  });

  describe("toStates / fromUserStates round-trip", () => {
    test("round-trips username", () => {
      const userData: UserData = {
        userId: "user-1",
        username: "Alice",
        characterDescription: null,
        colors: null,
      };
      const states = DeltaNetComponentMapping.toStates(userData);
      const result = DeltaNetComponentMapping.fromUserStates(states, mockLogger as any);
      expect(result.username).toBe("Alice");
    });

    test("round-trips character description", () => {
      const desc = { meshFileUrl: "avatar.glb" };
      const userData: UserData = {
        userId: "user-1",
        username: null,
        characterDescription: desc,
        colors: null,
      };
      const states = DeltaNetComponentMapping.toStates(userData);
      const result = DeltaNetComponentMapping.fromUserStates(states, mockLogger as any);
      expect(result.characterDescription).toEqual(desc);
    });

    test("round-trips colors", () => {
      const colors: Array<[number, number, number]> = [
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
      ];
      const userData: UserData = {
        userId: "user-1",
        username: null,
        characterDescription: null,
        colors,
      };
      const states = DeltaNetComponentMapping.toStates(userData);
      const result = DeltaNetComponentMapping.fromUserStates(states, mockLogger as any);
      expect(result.colors).toEqual(colors);
    });

    test("handles all null UserData", () => {
      const userData: UserData = {
        userId: "user-1",
        username: null,
        characterDescription: null,
        colors: null,
      };
      const states = DeltaNetComponentMapping.toStates(userData);
      const result = DeltaNetComponentMapping.fromUserStates(states, mockLogger as any);
      expect(result.username).toBeNull();
      expect(result.characterDescription).toBeNull();
      expect(result.colors).toBeNull();
    });

    test("round-trips full UserData", () => {
      const userData: UserData = {
        userId: "user-2",
        username: "Bob",
        characterDescription: { mmlCharacterUrl: "char.html" },
        colors: [
          [100, 200, 50],
          [10, 20, 30],
        ],
      };
      const states = DeltaNetComponentMapping.toStates(userData);
      const result = DeltaNetComponentMapping.fromUserStates(states, mockLogger as any);
      expect(result.username).toBe("Bob");
      expect(result.characterDescription).toEqual({ mmlCharacterUrl: "char.html" });
      expect(result.colors).toEqual([
        [100, 200, 50],
        [10, 20, 30],
      ]);
    });
  });

  describe("individual state encoders", () => {
    test("toUsernameState encodes username", () => {
      const states = DeltaNetComponentMapping.toUsernameState("Charlie");
      expect(states.has(STATE_USERNAME)).toBe(true);
      const decoded = new TextDecoder().decode(states.get(STATE_USERNAME));
      expect(decoded).toBe("Charlie");
    });

    test("toCharacterDescriptionState encodes as JSON", () => {
      const desc = { meshFileUrl: "model.glb" };
      const states = DeltaNetComponentMapping.toCharacterDescriptionState(desc);
      expect(states.has(STATE_CHARACTER_DESCRIPTION)).toBe(true);
      const decoded = JSON.parse(new TextDecoder().decode(states.get(STATE_CHARACTER_DESCRIPTION)));
      expect(decoded).toEqual(desc);
    });

    test("toColorsState encodes colors", () => {
      const colors: Array<[number, number, number]> = [[1, 2, 3]];
      const states = DeltaNetComponentMapping.toColorsState(colors);
      expect(states.has(STATE_COLORS)).toBe(true);
      const decoded = DeltaNetComponentMapping.decodeColors(
        states.get(STATE_COLORS)!,
        mockLogger as any,
      );
      expect(decoded).toEqual([[1, 2, 3]]);
    });
  });

  describe("toSingleState", () => {
    test("encodes username string", () => {
      const states = DeltaNetComponentMapping.toSingleState(STATE_USERNAME, "Test");
      expect(states.has(STATE_USERNAME)).toBe(true);
    });

    test("encodes character description object", () => {
      const desc = { meshFileUrl: "test.glb" };
      const states = DeltaNetComponentMapping.toSingleState(STATE_CHARACTER_DESCRIPTION, desc);
      expect(states.has(STATE_CHARACTER_DESCRIPTION)).toBe(true);
    });

    test("encodes colors array", () => {
      const colors: Array<[number, number, number]> = [[10, 20, 30]];
      const states = DeltaNetComponentMapping.toSingleState(STATE_COLORS, colors);
      expect(states.has(STATE_COLORS)).toBe(true);
    });

    test("ignores non-string username", () => {
      const states = DeltaNetComponentMapping.toSingleState(STATE_USERNAME, 123);
      expect(states.size).toBe(0);
    });

    test("ignores null character description", () => {
      const states = DeltaNetComponentMapping.toSingleState(STATE_CHARACTER_DESCRIPTION, null);
      expect(states.size).toBe(0);
    });

    test("ignores non-array colors", () => {
      const states = DeltaNetComponentMapping.toSingleState(STATE_COLORS, "not-array");
      expect(states.size).toBe(0);
    });

    test("ignores unknown state ID", () => {
      const states = DeltaNetComponentMapping.toSingleState(999, "data");
      expect(states.size).toBe(0);
    });
  });

  describe("encodeColors / decodeColors", () => {
    test("round-trips empty array", () => {
      const encoded = DeltaNetComponentMapping.encodeColors([]);
      const decoded = DeltaNetComponentMapping.decodeColors(encoded, mockLogger as any);
      expect(decoded).toEqual([]);
    });

    test("round-trips single color", () => {
      const colors: Array<[number, number, number]> = [[128, 64, 255]];
      const encoded = DeltaNetComponentMapping.encodeColors(colors);
      const decoded = DeltaNetComponentMapping.decodeColors(encoded, mockLogger as any);
      expect(decoded).toEqual(colors);
    });

    test("round-trips multiple colors", () => {
      const colors: Array<[number, number, number]> = [
        [0, 0, 0],
        [255, 255, 255],
        [128, 64, 32],
      ];
      const encoded = DeltaNetComponentMapping.encodeColors(colors);
      const decoded = DeltaNetComponentMapping.decodeColors(encoded, mockLogger as any);
      expect(decoded).toEqual(colors);
    });

    test("decodeColors returns empty array for empty buffer", () => {
      const result = DeltaNetComponentMapping.decodeColors(new Uint8Array(0), mockLogger as any);
      expect(result).toEqual([]);
    });

    test("decodeColors returns empty array and logs error for corrupt data", () => {
      const corrupt = new Uint8Array([255, 255, 255, 255]); // invalid varint
      const result = DeltaNetComponentMapping.decodeColors(corrupt, mockLogger as any);
      expect(result).toEqual([]);
    });
  });

  describe("fromStates", () => {
    test("decodes connectionId from internal connection ID state", async () => {
      const { BufferWriter } = await import("@mml-io/delta-net-protocol");
      const writer = new BufferWriter(4);
      writer.writeUVarint(42);
      const states = new Map<number, Uint8Array>();
      states.set(STATE_INTERNAL_CONNECTION_ID, writer.getBuffer());
      states.set(STATE_USERNAME, new TextEncoder().encode("Dave"));

      const result = DeltaNetComponentMapping.fromStates(states, mockLogger as any);
      expect(result.connectionId).toBe(42);
      expect(result.username).toBe("Dave");
    });

    test("returns null connectionId when no connection ID state", () => {
      const states = new Map<number, Uint8Array>();
      states.set(STATE_USERNAME, new TextEncoder().encode("Eve"));
      const result = DeltaNetComponentMapping.fromStates(states, mockLogger as any);
      expect(result.connectionId).toBeNull();
      expect(result.username).toBe("Eve");
    });
  });

  describe("fromUserStates with partial data", () => {
    test("handles only username", () => {
      const states = new Map<number, Uint8Array>();
      states.set(STATE_USERNAME, new TextEncoder().encode("OnlyName"));
      const result = DeltaNetComponentMapping.fromUserStates(states, mockLogger as any);
      expect(result.username).toBe("OnlyName");
      expect(result.characterDescription).toBeNull();
      expect(result.colors).toBeNull();
    });

    test("handles only character description", () => {
      const states = new Map<number, Uint8Array>();
      const desc = { mmlCharacterString: "<m-character></m-character>" };
      states.set(STATE_CHARACTER_DESCRIPTION, new TextEncoder().encode(JSON.stringify(desc)));
      const result = DeltaNetComponentMapping.fromUserStates(states, mockLogger as any);
      expect(result.username).toBeNull();
      expect(result.characterDescription).toEqual(desc);
    });

    test("handles empty states map", () => {
      const states = new Map<number, Uint8Array>();
      const result = DeltaNetComponentMapping.fromUserStates(states, mockLogger as any);
      expect(result.username).toBeNull();
      expect(result.characterDescription).toBeNull();
      expect(result.colors).toBeNull();
    });
  });

  describe("userIdFromBytes", () => {
    test("returns null for empty bytes", () => {
      const result = DeltaNetComponentMapping.userIdFromBytes(new Uint8Array(0));
      expect(result).toBeNull();
    });

    test("decodes valid user ID", async () => {
      const { BufferWriter } = await import("@mml-io/delta-net-protocol");
      const writer = new BufferWriter(4);
      writer.writeUVarint(99);
      const result = DeltaNetComponentMapping.userIdFromBytes(writer.getBuffer());
      expect(result).toBe(99);
    });
  });

  describe("usernameFromBytes", () => {
    test("returns null for empty bytes", () => {
      const result = DeltaNetComponentMapping.usernameFromBytes(new Uint8Array(0));
      expect(result).toBeNull();
    });

    test("decodes valid username", () => {
      const bytes = new TextEncoder().encode("TestUser");
      const result = DeltaNetComponentMapping.usernameFromBytes(bytes);
      expect(result).toBe("TestUser");
    });
  });

  describe("characterDescriptionFromBytes", () => {
    test("returns null for empty bytes", () => {
      const result = DeltaNetComponentMapping.characterDescriptionFromBytes(new Uint8Array(0));
      expect(result).toBeNull();
    });

    test("decodes valid JSON", () => {
      const desc = { meshFileUrl: "model.glb" };
      const bytes = new TextEncoder().encode(JSON.stringify(desc));
      const result = DeltaNetComponentMapping.characterDescriptionFromBytes(bytes);
      expect(result).toEqual(desc);
    });
  });
});
