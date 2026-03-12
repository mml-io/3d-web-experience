export * from "./3d-web-experience-v0.1";

import {
  experienceProtocolSubProtocol_v0_1,
  experienceProtocol_v0_1_deltaNetSubProtocol,
} from "./3d-web-experience-v0.1";

/**
 * Sub-protocols a client should offer during WebSocket handshake, in preference
 * order (newest first).
 */
export const experienceClientSubProtocols = [experienceProtocolSubProtocol_v0_1] as const;

/**
 * Maps an experience protocol sub-protocol string to the corresponding
 * delta-net sub-protocol string used on the wire.
 *
 * Returns `null` if the provided string is not a recognised experience protocol
 * version.
 */
export function experienceProtocolToDeltaNetSubProtocol(experienceProtocol: string): string | null {
  switch (experienceProtocol) {
    case experienceProtocolSubProtocol_v0_1:
      return experienceProtocol_v0_1_deltaNetSubProtocol;
    default:
      return null;
  }
}

/**
 * WebSocket `handleProtocols` callback for use with ws / express-ws.
 *
 * Selects the highest-priority experience protocol version from the set of
 * protocols offered by the client.
 */
export function handleExperienceWebsocketSubprotocol(
  protocols: Set<string> | Array<string>,
): string | false {
  const protocolsSet = protocols instanceof Set ? protocols : new Set(protocols);
  for (const protocol of experienceClientSubProtocols) {
    if (protocolsSet.has(protocol)) {
      return protocol;
    }
  }
  console.warn(
    `[experience-protocol] No supported sub-protocol found. Client offered: [${[...protocolsSet].join(", ")}], server supports: [${experienceClientSubProtocols.join(", ")}]`,
  );
  return false;
}
