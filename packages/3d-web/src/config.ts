import Ajv from "ajv";

import { WORLD_CONFIG_UPDATE_BROADCAST_TYPE } from "./constants";
import { worldConfigSchema } from "./worldConfigSchema";

export { WORLD_CONFIG_UPDATE_BROADCAST_TYPE };

export type MMLDocumentConfig = {
  url: string;
  position?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  scale?: { x: number; y: number; z: number };
  passAuthToken?: boolean;
};

export type LoadingScreenConfig = {
  background?: string;
  backgroundImageUrl?: string;
  backgroundBlurAmount?: number;
  overlayLayers?: Array<{
    overlayImageUrl: string;
    overlayAnchor: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    overlayOffset?: { x: number; y: number };
  }>;
  title?: string;
  subtitle?: string;
  color?: string;
};

export type WorldConfig = {
  chat?: boolean;
  allowOrbitalCamera?: boolean;
  allowCustomDisplayName?: boolean;
  enableTweakPane?: boolean;
  postProcessingEnabled?: boolean;
  loadingScreen?: LoadingScreenConfig;
  mmlDocuments?: { [key: string]: MMLDocumentConfig };
  environment?: {
    groundPlane?: boolean;
    skybox?: {
      hdrJpgUrl?: string;
      hdrUrl?: string;
      intensity?: number;
      blurriness?: number;
      azimuthalAngle?: number;
      polarAngle?: number;
    };
    sun?: {
      intensity?: number;
      polarAngle?: number;
      azimuthalAngle?: number;
    };
    envMap?: {
      intensity?: number;
    };
    fog?: {
      fogNear?: number;
      fogFar?: number;
      fogColor?: { r: number; g: number; b: number };
    };
    postProcessing?: {
      bloomIntensity?: number;
    };
    ambientLight?: {
      intensity?: number;
    };
  };
  spawn?: {
    spawnPosition?: { x: number; y: number; z: number };
    spawnPositionVariance?: { x: number; y: number; z: number };
    spawnYRotation?: number;
    respawnTrigger?: {
      minX?: number;
      maxX?: number;
      minY?: number;
      maxY?: number;
      minZ?: number;
      maxZ?: number;
    };
  };
  avatars?: {
    allowCustomAvatars?: boolean;
    availableAvatars?: Array<{
      name?: string;
      thumbnailUrl?: string;
      isDefaultAvatar?: boolean;
      meshFileUrl?: string;
      mmlCharacterUrl?: string;
      mmlCharacterString?: string;
    }>;
  };
  auth?: {
    allowAnonymous?: boolean;
    allowBots?: boolean;
    /** Shared secret required to call the bot auth endpoint. When set, the
     *  `Authorization: Bearer <key>` header must match this value. */
    botApiKey?: string;
    webhookUrl?: string;
    serverUrl?: string;
    maxConnections?: number;
  };
  hud?:
    | false
    | {
        minimap?: boolean;
        playerList?: boolean;
        respawnButton?: boolean;
        [key: string]: boolean | undefined;
      };
  clientScripts?: string[];
};

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(worldConfigSchema);

export function parseWorldConfig(config: unknown): WorldConfig {
  if (validate(config)) {
    const wc = config as WorldConfig;
    if (
      wc.environment?.fog?.fogNear !== undefined &&
      wc.environment?.fog?.fogFar !== undefined &&
      wc.environment.fog.fogNear >= wc.environment.fog.fogFar
    ) {
      throw new Error(
        `Invalid world config:\n  /environment/fog: fogNear (${wc.environment.fog.fogNear}) must be less than fogFar (${wc.environment.fog.fogFar})`,
      );
    }
    return wc;
  }
  const messages = (validate.errors ?? []).map((err) => {
    const path = err.instancePath || "/";
    return `  ${path}: ${err.message}`;
  });
  throw new Error(`Invalid world config:\n${messages.join("\n")}`);
}

/**
 * Minimal config embedded in the HTML page. Everything else arrives over
 * the WebSocket via world config or broadcast messages.
 */
export type PageConfig = {
  loadingScreen?: LoadingScreenConfig;
};

export function buildPageConfig(worldConfig: WorldConfig): PageConfig {
  const config: PageConfig = {};
  if (worldConfig.loadingScreen) {
    config.loadingScreen = worldConfig.loadingScreen;
  }
  return config;
}
