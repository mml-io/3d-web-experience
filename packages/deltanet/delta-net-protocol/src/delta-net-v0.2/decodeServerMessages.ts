import { BufferReader } from "../BufferReader";
import type { DecodeServerMessageOptions } from "../decodeOptions";
import type { DeltaNetV01ServerMessage as DeltaNetServerMessage } from "../delta-net-v0.1";
import {
  decodeError,
  decodePing,
  decodeServerCustom,
  decodeUserIndex,
  decodeWarning,
  ErrorMessageType,
  InitialCheckoutMessageType,
  PingMessageType,
  ServerCustomMessageType,
  TickMessageType,
  UserIndexMessageType,
  WarningMessageType,
} from "../delta-net-v0.1";

import { decodeInitialCheckoutV02 } from "./messages/from-server/initialCheckout";
import { decodeTickV02 } from "./messages/from-server/tick";

export function decodeServerMessagesV02(
  buffer: BufferReader,
  opts?: DecodeServerMessageOptions,
): Array<DeltaNetServerMessage> {
  const messages: DeltaNetServerMessage[] = [];
  while (!buffer.isEnd()) {
    const messageType = buffer.readUInt8();
    switch (messageType) {
      case InitialCheckoutMessageType:
        messages.push(decodeInitialCheckoutV02(buffer, opts));
        break;
      case UserIndexMessageType:
        messages.push(decodeUserIndex(buffer));
        break;
      case TickMessageType:
        messages.push(decodeTickV02(buffer, opts));
        break;
      case ServerCustomMessageType:
        messages.push(decodeServerCustom(buffer));
        break;
      case PingMessageType:
        messages.push(decodePing(buffer));
        break;
      case WarningMessageType:
        messages.push(decodeWarning(buffer));
        break;
      case ErrorMessageType:
        messages.push(decodeError(buffer));
        break;
      default:
        throw new Error(`Unknown message type: ${messageType}`);
    }
  }
  return messages;
}
