import { AnimationWeights, AnimationTimes } from "../character/AnimationMixer";
import { AnimationState } from "../character/CharacterState";
import { AnimationConfig } from "../character/types";
import { EulXYZ, Vect3 } from "../math";

export type CharacterDescription =
  | {
      meshFileUrl: string;
      mmlCharacterString?: null;
      mmlCharacterUrl?: null;
    }
  | {
      meshFileUrl?: null;
      mmlCharacterString: string;
      mmlCharacterUrl?: null;
    }
  | {
      meshFileUrl?: null;
      mmlCharacterString?: null;
      mmlCharacterUrl: string;
    };

export type CameraTransform = {
  position: Vect3;
  rotation: {
    x: number;
    y: number;
    z: number;
  };
  fov: number;
};

export type CharacterRenderState = {
  id: number;
  position: Vect3;
  rotation: EulXYZ;
  animationState: AnimationState;
  animationWeights: AnimationWeights;
  animationTimes: AnimationTimes;
  username: string;
  characterDescription: CharacterDescription | null;
  colors: Array<[number, number, number]> | null;
  isLocal: boolean;
};

export type RenderState = {
  characters: Map<number, CharacterRenderState>;
  updatedCharacterDescriptions: number[];
  removedUserIds: number[];
  cameraTransform: CameraTransform;
  localCharacterId: number | null;
  deltaTimeSeconds: number;
};

export type EnvironmentConfiguration = {
  groundPlane?: boolean;
  skybox?: {
    intensity?: number;
    blurriness?: number;
    azimuthalAngle?: number;
    polarAngle?: number;
  } & (
    | {
        hdrJpgUrl: string;
      }
    | {
        hdrUrl: string;
      }
  );
  envMap?: {
    intensity?: number;
  };
  sun?: {
    intensity?: number;
    polarAngle?: number;
    azimuthalAngle?: number;
  };
  fog?: {
    fogNear?: number;
    fogFar?: number;
    fogColor?: {
      r: number;
      g: number;
      b: number;
    };
  };
  postProcessing?: {
    bloomIntensity?: number;
  };
  ambientLight?: {
    intensity?: number;
  };
};

export type MMLDocumentConfiguration = {
  url: string;
  position?: {
    x: number;
    y: number;
    z: number;
  };
  rotation?: {
    x: number;
    y: number;
    z: number;
  };
  scale?: {
    x: number;
    y: number;
    z: number;
  };
  passAuthToken?: boolean;
};

export interface IRenderer {
  /**
   * Render a frame with the complete game state
   */
  render(state: RenderState): void;

  /**
   * Resize the renderer to fit its container
   */
  fitContainer(): void;

  /**
   * Clean up and dispose of all resources
   */
  dispose(): void;

  /**
   * Add a chat bubble to a character
   */
  addChatBubble(characterId: number, message: string): void;

  /**
   * Set MML documents configuration and auth token
   */
  setMMLConfiguration(
    mmlDocuments: { [key: string]: MMLDocumentConfiguration },
    authToken: string | null,
  ): void;

  /**
   * Handle chat message for MML chat probes
   */
  onChatMessage(message: string): void;

  /**
   * Update renderer configuration
   */
  updateConfig(config: Partial<RendererConfig>): void;
}

export type RendererConfig = {
  animationConfig: AnimationConfig;
  environmentConfiguration?: EnvironmentConfiguration;
  postProcessingEnabled?: boolean;
  spawnSun?: boolean;
  enableTweakPane?: boolean;
};
