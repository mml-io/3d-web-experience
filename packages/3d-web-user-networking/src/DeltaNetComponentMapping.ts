import { UserNetworkingClientUpdate } from "./UserNetworkingCodec";
import { CharacterDescription } from "./UserNetworkingMessages";

// Component IDs used in the deltanet implementation
export const COMPONENT_POSITION_X = 1;
export const COMPONENT_POSITION_Y = 2;
export const COMPONENT_POSITION_Z = 3;
export const COMPONENT_ROTATION_Y = 4;
export const COMPONENT_ROTATION_W = 5;
export const COMPONENT_STATE = 6;

// State IDs for binary data
export const STATE_CHARACTER_DESCRIPTION = 1;
export const STATE_USERNAME = 2;

const rotationMultiplier = 360;
const positionMultiplier = 100;

export class DeltaNetComponentMapping {
  /**
   * Convert UserNetworkingClientUpdate to deltanet components
   */
  static toComponents(update: UserNetworkingClientUpdate): Map<number, bigint> {
    const components = new Map<number, bigint>();

    // Convert position values to fixed-point representation
    // Using 1000x scale for precision with 3 decimal places
    components.set(COMPONENT_POSITION_X, BigInt(Math.round(update.position.x * positionMultiplier)));
    components.set(COMPONENT_POSITION_Y, BigInt(Math.round(update.position.y * positionMultiplier)));
    components.set(COMPONENT_POSITION_Z, BigInt(Math.round(update.position.z * positionMultiplier)));

    // Convert quaternion values to fixed-point representation
    // Using 32767 scale to match original codec precision
    components.set(COMPONENT_ROTATION_Y, BigInt(Math.round(update.rotation.quaternionY * rotationMultiplier)));
    components.set(COMPONENT_ROTATION_W, BigInt(Math.round(update.rotation.quaternionW * rotationMultiplier)));

    // State is already an integer
    components.set(COMPONENT_STATE, BigInt(update.state));

    return components;
  }

  /**
   * Convert deltanet components back to UserNetworkingClientUpdate
   */
  static fromComponents(
    components: Map<number, bigint>,
    userId: number,
  ): UserNetworkingClientUpdate {
    const positionX = Number(components.get(COMPONENT_POSITION_X) || BigInt(0)) / positionMultiplier;
    const positionY = Number(components.get(COMPONENT_POSITION_Y) || BigInt(0)) / positionMultiplier;
    const positionZ = Number(components.get(COMPONENT_POSITION_Z) || BigInt(0)) / positionMultiplier;
    const rotationY = Number(components.get(COMPONENT_ROTATION_Y) || BigInt(0)) / rotationMultiplier;
    const rotationW = Number(components.get(COMPONENT_ROTATION_W) || BigInt(rotationMultiplier)) / rotationMultiplier;

    const state = Number(components.get(COMPONENT_STATE) || BigInt(0));

    return {
      id: userId,
      position: { x: positionX, y: positionY, z: positionZ },
      rotation: { quaternionY: rotationY, quaternionW: rotationW },
      state,
    };
  }

  /**
   * Encode character description and username to binary states
   */
  static toStates(
    username: string,
    characterDescription: CharacterDescription,
  ): Map<number, Uint8Array> {
    const states = new Map<number, Uint8Array>();
    const textEncoder = new TextEncoder();

    // Encode username
    states.set(STATE_USERNAME, textEncoder.encode(username));

    // Encode character description as JSON
    states.set(
      STATE_CHARACTER_DESCRIPTION,
      textEncoder.encode(JSON.stringify(characterDescription)),
    );

    return states;
  }

  /**
   * Decode binary states back to username and character description
   */
  static fromStates(states: Map<number, Uint8Array>): {
    username: string;
    characterDescription: CharacterDescription;
  } {
    const textDecoder = new TextDecoder();

    const usernameBytes = states.get(STATE_USERNAME);
    const username = usernameBytes ? textDecoder.decode(usernameBytes) : "";

    const characterDescBytes = states.get(STATE_CHARACTER_DESCRIPTION);
    let characterDescription: CharacterDescription = { meshFileUrl: "" };

    if (characterDescBytes) {
      try {
        characterDescription = JSON.parse(textDecoder.decode(characterDescBytes));
      } catch (e) {
        console.error("Failed to parse character description:", e);
      }
    }

    return { username, characterDescription };
  }
}
