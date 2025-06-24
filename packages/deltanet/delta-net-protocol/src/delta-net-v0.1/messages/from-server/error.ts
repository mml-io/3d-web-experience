import { BufferReader } from "../../../BufferReader";
import { BufferWriter } from "../../../BufferWriter";
import { ErrorMessageType } from "../../messageTypes";

export type DeltaNetV01ErrorMessage = {
  type: "error";
  message: string;
  retryable: boolean; // Whether the client should retry the operation - if false the client should not attempt to reconnect/retry
};

export function encodeError(
  msg: DeltaNetV01ErrorMessage,
  writer: BufferWriter = new BufferWriter(64),
): BufferWriter {
  writer.writeUint8(ErrorMessageType);
  writer.writeLengthPrefixedString(msg.message);
  writer.writeBoolean(msg.retryable);
  return writer;
}

// Assumes that the first byte has already been read (the message type)
export function decodeError(buffer: BufferReader): DeltaNetV01ErrorMessage {
  const message = buffer.readUVarintPrefixedString();
  const retryable = buffer.readBoolean();
  return {
    type: "error",
    message,
    retryable,
  };
}
