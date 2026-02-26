import { BufferWriter } from "../BufferWriter";
import type { DeltaNetV01ServerMessage as DeltaNetServerMessage } from "../delta-net-v0.1";
import {
  encodeError,
  encodePing,
  encodeServerCustom,
  encodeUserIndex,
  encodeWarning,
} from "../delta-net-v0.1";

import { encodeInitialCheckoutV02 } from "./messages/from-server/initialCheckout";
import { encodeTickV02 } from "./messages/from-server/tick";

export function encodeServerMessageV02(
  message: DeltaNetServerMessage,
  writer?: BufferWriter,
): BufferWriter {
  switch (message.type) {
    case "initialCheckout":
      return encodeInitialCheckoutV02(message, writer);
    case "tick":
      return encodeTickV02(message, writer);
    case "userIndex":
      return encodeUserIndex(message, writer);
    case "ping":
      return encodePing(message, writer);
    case "serverCustom":
      return encodeServerCustom(message, writer);
    case "warning":
      return encodeWarning(message, writer);
    case "error":
      return encodeError(message, writer);
    default:
      throw new Error(`Unknown message type: ${(message as any).type}`);
  }
}
