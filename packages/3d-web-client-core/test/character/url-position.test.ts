import {
  decodeCharacterAndCamera,
  encodeCharacterAndCamera,
} from "../../src/character/url-position";

describe("url-position", () => {
  it("encodeCharacterAndCamera produces comma-separated string", () => {
    const result = encodeCharacterAndCamera(
      { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 } },
      { position: { x: 4, y: 5, z: 6 }, rotation: { x: 0, y: 0, z: 0 } },
    );
    expect(typeof result).toBe("string");
    const parts = result.split(",");
    // 3 position + 4 quaternion + 3 position + 4 quaternion = 14
    expect(parts).toHaveLength(14);
  });

  it("decodeCharacterAndCamera parses a string", () => {
    const hash = "1,2,3,0,0,0,1,4,5,6,0,0,0,1";
    const decoded = decodeCharacterAndCamera(hash);
    expect(decoded.character.position.x).toBe(1);
    expect(decoded.character.position.y).toBe(2);
    expect(decoded.character.position.z).toBe(3);
    expect(decoded.character.quaternion.w).toBe(1);
    expect(decoded.camera.position.x).toBe(4);
    expect(decoded.camera.position.y).toBe(5);
    expect(decoded.camera.position.z).toBe(6);
    expect(decoded.camera.quaternion.w).toBe(1);
  });

  it("round-trip encode → decode", () => {
    const charPos = { x: 1.5, y: 2.5, z: 3.5 };
    const charRot = { x: 0, y: 0.5, z: 0 };
    const camPos = { x: 4.5, y: 5.5, z: 6.5 };
    const camRot = { x: 0.1, y: 0.2, z: 0.3 };

    const encoded = encodeCharacterAndCamera(
      { position: charPos, rotation: charRot },
      { position: camPos, rotation: camRot },
    );
    const decoded = decodeCharacterAndCamera(encoded);

    expect(decoded.character.position.x).toBeCloseTo(charPos.x, 2);
    expect(decoded.character.position.y).toBeCloseTo(charPos.y, 2);
    expect(decoded.character.position.z).toBeCloseTo(charPos.z, 2);
    expect(decoded.camera.position.x).toBeCloseTo(camPos.x, 2);
    expect(decoded.camera.position.y).toBeCloseTo(camPos.y, 2);
    expect(decoded.camera.position.z).toBeCloseTo(camPos.z, 2);
  });

  it("encodeCharacterAndCamera with non-zero rotation encodes quaternion values", () => {
    const result = encodeCharacterAndCamera(
      { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } },
      { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    );
    const parts = result.split(",").map(Number);
    // Character quaternion (indices 3-6) should have non-zero y component
    const qy = parts[4]; // quaternion y
    expect(Math.abs(qy)).toBeGreaterThan(0.1);
  });
});
