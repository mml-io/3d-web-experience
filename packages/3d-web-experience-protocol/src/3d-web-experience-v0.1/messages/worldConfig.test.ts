import { describe, expect, it } from "@jest/globals";

import type { WorldConfigPayload } from "./worldConfig";
import { parseWorldConfigPayload, serializeWorldConfigPayload } from "./worldConfig";

describe("WorldConfigPayload type", () => {
  it("accepts a minimal world config", () => {
    const config: WorldConfigPayload = {};
    expect(config).toBeDefined();
  });

  it("accepts a fully populated world config", () => {
    const config: WorldConfigPayload = {
      enableChat: true,
      mmlDocuments: {
        doc1: {
          url: "ws:///doc1",
          position: { x: 0, y: 1, z: 2 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          passAuthToken: true,
        },
      },
      environmentConfiguration: {
        groundPlane: true,
        sun: { intensity: 1, polarAngle: 0.5, azimuthalAngle: 0.3 },
        fog: { fogNear: 10, fogFar: 100, fogColor: { r: 0, g: 0, b: 0 } },
      },
      spawnConfiguration: {
        spawnPosition: { x: 0, y: 0, z: 0 },
        spawnYRotation: 0,
        enableRespawnButton: false,
      },
      avatarConfiguration: {
        availableAvatars: [{ meshFileUrl: "https://example.com/avatar.glb", name: "Bot" }],
        allowCustomAvatars: false,
      },
      allowCustomDisplayName: false,
      enableTweakPane: true,
      allowOrbitalCamera: true,
      postProcessingEnabled: false,
    };
    expect(config.enableChat).toBe(true);
    expect(config.mmlDocuments?.doc1.url).toBe("ws:///doc1");
    expect(config.allowCustomDisplayName).toBe(false);
  });

  it("accepts partial mmlDocuments with only url", () => {
    const config: WorldConfigPayload = {
      mmlDocuments: {
        simple: { url: "https://example.com/doc" },
      },
    };
    expect(config.mmlDocuments?.simple.url).toBe("https://example.com/doc");
    expect(config.mmlDocuments?.simple.position).toBeUndefined();
  });
});

describe("parseWorldConfigPayload", () => {
  it("parses a minimal (empty) config", () => {
    const result = parseWorldConfigPayload(JSON.stringify({}));
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual({});
  });

  it("parses a fully populated config", () => {
    const input = {
      enableChat: true,
      mmlDocuments: {
        doc1: {
          url: "ws:///doc1",
          position: { x: 0, y: 1, z: 2 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          passAuthToken: true,
        },
      },
      environmentConfiguration: {
        groundPlane: true,
        sun: { intensity: 1, polarAngle: 0.5, azimuthalAngle: 0.3 },
        fog: { fogNear: 10, fogFar: 100, fogColor: { r: 0, g: 0, b: 0 } },
      },
      spawnConfiguration: {
        spawnPosition: { x: 0, y: 0, z: 0 },
        spawnYRotation: 0,
        enableRespawnButton: false,
      },
      avatarConfiguration: {
        availableAvatars: [{ meshFileUrl: "https://example.com/avatar.glb", name: "Bot" }],
        allowCustomAvatars: false,
      },
      allowCustomDisplayName: false,
      enableTweakPane: true,
      allowOrbitalCamera: true,
      postProcessingEnabled: false,
    };
    const result = parseWorldConfigPayload(JSON.stringify(input));
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual(input);
  });

  it("returns an Error for malformed JSON", () => {
    const result = parseWorldConfigPayload("not json");
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error for a JSON array", () => {
    const result = parseWorldConfigPayload(JSON.stringify([1, 2]));
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error for null", () => {
    const result = parseWorldConfigPayload("null");
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when enableChat is not a boolean", () => {
    const result = parseWorldConfigPayload(JSON.stringify({ enableChat: "yes" }));
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when mmlDocuments is not an object", () => {
    const result = parseWorldConfigPayload(JSON.stringify({ mmlDocuments: "bad" }));
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when an mmlDocument entry is missing url", () => {
    const result = parseWorldConfigPayload(
      JSON.stringify({ mmlDocuments: { doc: { position: { x: 0, y: 0, z: 0 } } } }),
    );
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when mmlDocument position is invalid", () => {
    const result = parseWorldConfigPayload(
      JSON.stringify({ mmlDocuments: { doc: { url: "ws:///a", position: { x: "bad" } } } }),
    );
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when environmentConfiguration is not an object", () => {
    const result = parseWorldConfigPayload(JSON.stringify({ environmentConfiguration: "bad" }));
    expect(result).toBeInstanceOf(Error);
  });

  it("returns an Error when allowCustomDisplayName is not a boolean", () => {
    const result = parseWorldConfigPayload(JSON.stringify({ allowCustomDisplayName: 1 }));
    expect(result).toBeInstanceOf(Error);
  });

  it("accepts mmlDocuments with only url", () => {
    const input = { mmlDocuments: { simple: { url: "https://example.com/doc" } } };
    const result = parseWorldConfigPayload(JSON.stringify(input));
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual(input);
  });
});

describe("serializeWorldConfigPayload", () => {
  it("serializes an empty config", () => {
    const serialized = serializeWorldConfigPayload({});
    expect(JSON.parse(serialized)).toEqual({});
  });

  it("serializes a config with mmlDocuments", () => {
    const config = {
      enableChat: true,
      mmlDocuments: { doc1: { url: "ws:///doc1" } },
    };
    const serialized = serializeWorldConfigPayload(config);
    expect(JSON.parse(serialized)).toEqual(config);
  });
});

describe("world config round-trips", () => {
  it("world config payload round-trips correctly", () => {
    const original = {
      enableChat: true,
      mmlDocuments: {
        doc1: {
          url: "ws:///doc1",
          position: { x: 1, y: 2, z: 3 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          passAuthToken: true,
        },
      },
      allowCustomDisplayName: false,
    };
    const serialized = serializeWorldConfigPayload(original);
    const reparsed = parseWorldConfigPayload(serialized);
    expect(reparsed).toEqual(original);
  });
});

describe("parseWorldConfigPayload - validation edge cases", () => {
  describe("partial coordinates", () => {
    it("returns an Error when position is missing z", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({ mmlDocuments: { doc: { url: "ws:///a", position: { x: 1, y: 2 } } } }),
      );
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when position is missing y and z", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({ mmlDocuments: { doc: { url: "ws:///a", position: { x: 1 } } } }),
      );
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when position is an empty object", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({ mmlDocuments: { doc: { url: "ws:///a", position: {} } } }),
      );
      expect(result).toBeInstanceOf(Error);
    });
  });

  describe("non-finite coordinate values", () => {
    it("returns an Error when position x is NaN", () => {
      const result = parseWorldConfigPayload(
        '{"mmlDocuments":{"doc":{"url":"ws:///a","position":{"x":null,"y":0,"z":0}}}}',
      );
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when position x is Infinity (string-encoded)", () => {
      const result = parseWorldConfigPayload(
        '{"mmlDocuments":{"doc":{"url":"ws:///a","position":{"x":"Infinity","y":0,"z":0}}}}',
      );
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when position y is a boolean instead of number", () => {
      const result = parseWorldConfigPayload(
        '{"mmlDocuments":{"doc":{"url":"ws:///a","position":{"x":0,"y":true,"z":0}}}}',
      );
      expect(result).toBeInstanceOf(Error);
    });
  });

  describe("invalid nested configs", () => {
    it("returns an Error when spawnConfiguration is a string", () => {
      const result = parseWorldConfigPayload(JSON.stringify({ spawnConfiguration: "bad" }));
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when spawnConfiguration is a number", () => {
      const result = parseWorldConfigPayload(JSON.stringify({ spawnConfiguration: 42 }));
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when spawnConfiguration is null", () => {
      const result = parseWorldConfigPayload(JSON.stringify({ spawnConfiguration: null }));
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when avatarConfiguration is an array", () => {
      const result = parseWorldConfigPayload(JSON.stringify({ avatarConfiguration: [] }));
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when avatarConfiguration is a boolean", () => {
      const result = parseWorldConfigPayload(JSON.stringify({ avatarConfiguration: true }));
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when avatarConfiguration is missing availableAvatars", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({ avatarConfiguration: { allowCustomAvatars: true } }),
      );
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when availableAvatars is not an array", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({ avatarConfiguration: { availableAvatars: "bad" } }),
      );
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when an avatar entry has no source", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({
          avatarConfiguration: { availableAvatars: [{ name: "NoSource" }] },
        }),
      );
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when an avatar entry has multiple sources", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({
          avatarConfiguration: {
            availableAvatars: [{ meshFileUrl: "a.glb", mmlCharacterUrl: "b.html" }],
          },
        }),
      );
      expect(result).toBeInstanceOf(Error);
    });

    it("accepts an avatar with meshFileUrl", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({
          avatarConfiguration: {
            availableAvatars: [{ meshFileUrl: "avatar.glb", name: "Test" }],
          },
        }),
      );
      expect(result).not.toBeInstanceOf(Error);
    });

    it("accepts an avatar with mmlCharacterString", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({
          avatarConfiguration: {
            availableAvatars: [{ mmlCharacterString: "<m-character />" }],
          },
        }),
      );
      expect(result).not.toBeInstanceOf(Error);
    });

    it("accepts an avatar with mmlCharacterUrl", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({
          avatarConfiguration: {
            availableAvatars: [{ mmlCharacterUrl: "https://example.com/char" }],
          },
        }),
      );
      expect(result).not.toBeInstanceOf(Error);
    });

    it("returns an Error when environmentConfiguration.skybox is a string", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({ environmentConfiguration: { skybox: "blue" } }),
      );
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when environmentConfiguration.sun.intensity is a string", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({ environmentConfiguration: { sun: { intensity: "high" } } }),
      );
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when environmentConfiguration.fog.fogColor is missing fields", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({ environmentConfiguration: { fog: { fogColor: { r: 1 } } } }),
      );
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when spawnConfiguration.spawnPosition has non-number coordinates", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({ spawnConfiguration: { spawnPosition: { x: "bad" } } }),
      );
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when spawnConfiguration.respawnTrigger has non-number bounds", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({ spawnConfiguration: { respawnTrigger: { minX: "bad" } } }),
      );
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when spawnConfiguration.enableRespawnButton is not a boolean", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({ spawnConfiguration: { enableRespawnButton: 1 } }),
      );
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when environmentConfiguration.skybox has both hdrJpgUrl and hdrUrl", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({
          environmentConfiguration: {
            skybox: { hdrJpgUrl: "a.jpg", hdrUrl: "b.hdr" },
          },
        }),
      );
      expect(result).toBeInstanceOf(Error);
    });
  });

  describe("boolean field validation", () => {
    it("returns an Error when enableTweakPane is a string", () => {
      const result = parseWorldConfigPayload(JSON.stringify({ enableTweakPane: "yes" }));
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when allowOrbitalCamera is a number", () => {
      const result = parseWorldConfigPayload(JSON.stringify({ allowOrbitalCamera: 1 }));
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when postProcessingEnabled is null", () => {
      const result = parseWorldConfigPayload(JSON.stringify({ postProcessingEnabled: null }));
      expect(result).toBeInstanceOf(Error);
    });
  });

  describe("rotation and scale validation", () => {
    it("returns an Error when rotation is missing z", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({ mmlDocuments: { doc: { url: "ws:///a", rotation: { x: 0, y: 0 } } } }),
      );
      expect(result).toBeInstanceOf(Error);
    });

    it("returns an Error when scale contains a string value", () => {
      const result = parseWorldConfigPayload(
        '{"mmlDocuments":{"doc":{"url":"ws:///a","scale":{"x":"1","y":1,"z":1}}}}',
      );
      expect(result).toBeInstanceOf(Error);
    });
  });

  describe("passAuthToken non-boolean", () => {
    it("returns an Error when passAuthToken is a string", () => {
      const result = parseWorldConfigPayload(
        JSON.stringify({ mmlDocuments: { doc: { url: "ws:///a", passAuthToken: "yes" } } }),
      );
      expect(result).toBeInstanceOf(Error);
    });
  });
});
