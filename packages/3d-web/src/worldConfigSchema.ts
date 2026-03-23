const vec3Schema = {
  type: "object",
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    z: { type: "number" },
  },
  required: ["x", "y", "z"],
  additionalProperties: false,
};

export const worldConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    chat: {
      type: "boolean",
    },
    allowOrbitalCamera: {
      type: "boolean",
    },
    allowCustomDisplayName: {
      type: "boolean",
    },
    enableTweakPane: {
      type: "boolean",
    },
    postProcessingEnabled: {
      type: "boolean",
    },
    loadingScreen: {
      type: "object",
      additionalProperties: false,
      properties: {
        background: { type: "string" },
        backgroundImageUrl: { type: "string" },
        backgroundBlurAmount: { type: "number", minimum: 0 },
        overlayLayers: {
          type: "array",
          items: {
            type: "object",
            required: ["overlayImageUrl", "overlayAnchor"],
            additionalProperties: false,
            properties: {
              overlayImageUrl: { type: "string" },
              overlayAnchor: {
                type: "string",
                enum: ["top-left", "top-right", "bottom-left", "bottom-right"],
              },
              overlayOffset: {
                type: "object",
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                },
                required: ["x", "y"],
                additionalProperties: false,
              },
            },
          },
        },
        title: { type: "string" },
        subtitle: { type: "string" },
        color: { type: "string" },
      },
    },
    mmlDocuments: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["url"],
        additionalProperties: false,
        properties: {
          url: { type: "string", pattern: "^(wss?://|https?://|/)" },
          position: vec3Schema,
          rotation: vec3Schema,
          scale: vec3Schema,
          passAuthToken: { type: "boolean" },
        },
      },
    },
    environment: {
      type: "object",
      additionalProperties: false,
      properties: {
        groundPlane: { type: "boolean" },
        skybox: {
          type: "object",
          additionalProperties: false,
          properties: {
            hdrJpgUrl: { type: "string" },
            hdrUrl: { type: "string" },
            intensity: { type: "number", minimum: 0, maximum: 10 },
            blurriness: { type: "number", minimum: 0, maximum: 1 },
            azimuthalAngle: { type: "number", minimum: -360, maximum: 360 },
            polarAngle: { type: "number", minimum: -360, maximum: 360 },
          },
        },
        sun: {
          type: "object",
          additionalProperties: false,
          properties: {
            intensity: { type: "number", minimum: 0, maximum: 10 },
            polarAngle: { type: "number", minimum: -360, maximum: 360 },
            azimuthalAngle: { type: "number", minimum: -360, maximum: 360 },
          },
        },
        envMap: {
          type: "object",
          additionalProperties: false,
          properties: {
            intensity: { type: "number", minimum: 0, maximum: 1 },
          },
        },
        fog: {
          type: "object",
          additionalProperties: false,
          properties: {
            fogNear: { type: "number", minimum: 0 },
            fogFar: { type: "number", minimum: 0 },
            fogColor: {
              type: "object",
              additionalProperties: false,
              required: ["r", "g", "b"],
              properties: {
                r: { type: "number", minimum: 0, maximum: 1 },
                g: { type: "number", minimum: 0, maximum: 1 },
                b: { type: "number", minimum: 0, maximum: 1 },
              },
            },
          },
        },
        postProcessing: {
          type: "object",
          additionalProperties: false,
          properties: {
            bloomIntensity: { type: "number", minimum: 0, maximum: 1 },
          },
        },
        ambientLight: {
          type: "object",
          additionalProperties: false,
          properties: {
            intensity: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
    },
    spawn: {
      type: "object",
      additionalProperties: false,
      properties: {
        spawnPosition: vec3Schema,
        spawnPositionVariance: vec3Schema,
        spawnYRotation: { type: "number", minimum: -360, maximum: 360 },
        respawnTrigger: {
          type: "object",
          additionalProperties: false,
          properties: {
            minX: { type: "number" },
            maxX: { type: "number" },
            minY: { type: "number" },
            maxY: { type: "number" },
            minZ: { type: "number" },
            maxZ: { type: "number" },
          },
        },
      },
    },
    avatars: {
      type: "object",
      additionalProperties: false,
      properties: {
        allowCustomAvatars: { type: "boolean" },
        availableAvatars: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              thumbnailUrl: { type: "string" },
              isDefaultAvatar: { type: "boolean" },
              meshFileUrl: { type: "string", pattern: "^(https?://|/)" },
              mmlCharacterUrl: { type: "string", pattern: "^(https?://|wss?://|/)" },
              mmlCharacterString: { type: "string" },
            },
          },
        },
      },
    },
    auth: {
      type: "object",
      additionalProperties: false,
      properties: {
        allowAnonymous: { type: "boolean" },
        webhookUrl: { type: "string", pattern: "^https?://" },
        serverUrl: { type: "string", pattern: "^https?://" },
        maxConnections: { type: "integer", minimum: 1 },
      },
    },
    hud: {
      oneOf: [
        { type: "boolean", const: false },
        {
          type: "object",
          additionalProperties: { type: "boolean" },
          properties: {
            minimap: { type: "boolean" },
            playerList: { type: "boolean" },
            respawnButton: { type: "boolean" },
          },
        },
      ],
    },
    clientScripts: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
  },
} as const;
