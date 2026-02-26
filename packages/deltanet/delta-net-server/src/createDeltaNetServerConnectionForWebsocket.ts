import {
  deltaNetSupportedSubProtocols,
  DeltaNetServerErrors,
  deltaNetProtocolSubProtocol_v0_1,
  deltaNetProtocolSubProtocol_v0_2,
  encodeError,
} from "@mml-io/delta-net-protocol";

import { DeltaNetConnection } from "./DeltaNetConnection";
import { DeltaNetServer } from "./DeltaNetServer";
import { DeltaNetV01Connection } from "./DeltaNetV01Connection";
import { DeltaNetV02Connection } from "./DeltaNetV02Connection";

function isRecognizedDeltaNetSubProtocol(
  protocol: string,
): protocol is (typeof deltaNetSupportedSubProtocols)[number] {
  return (deltaNetSupportedSubProtocols as readonly string[]).includes(protocol);
}

/**
 * Create a DeltaNetConnection for an incoming WebSocket.
 *
 * @param webSocket  The upgraded WebSocket.
 * @param deltaNetServer  The server instance that will own the connection.
 * @param deltaNetSubProtocol  Optional explicit delta-net sub-protocol version
 *   to use. When provided, the value of `webSocket.protocol` is ignored. This
 *   allows a higher-level protocol (e.g. `3d-web-experience-v0.1`) to be
 *   negotiated at the WebSocket level while the delta-net version is determined
 *   by the caller.
 */
export function createDeltaNetServerConnectionForWebsocket(
  webSocket: WebSocket,
  deltaNetServer: DeltaNetServer,
  deltaNetSubProtocol?: string,
): DeltaNetConnection | null {
  const protocol = deltaNetSubProtocol ?? webSocket.protocol;

  if (!protocol || !isRecognizedDeltaNetSubProtocol(protocol)) {
    const errorMessageString = `Unsupported websocket subprotocol: ${protocol ?? "none"}. Supported: ${deltaNetSupportedSubProtocols.join(", ")}`;
    console.warn(errorMessageString);
    const encoded = encodeError({
      type: "error",
      errorType: DeltaNetServerErrors.UNSUPPORTED_WEBSOCKET_SUBPROTOCOL_ERROR_TYPE,
      message: errorMessageString,
      retryable: false,
    });
    webSocket.send(encoded.getBuffer());
    webSocket.close();
    return null;
  }

  switch (protocol) {
    case deltaNetProtocolSubProtocol_v0_2:
      return new DeltaNetV02Connection(webSocket, deltaNetServer);
    case deltaNetProtocolSubProtocol_v0_1:
      return new DeltaNetV01Connection(webSocket, deltaNetServer);
    default: {
      const _exhaustive: never = protocol;
      throw new Error(`Unhandled protocol version: ${_exhaustive}`);
    }
  }
}
