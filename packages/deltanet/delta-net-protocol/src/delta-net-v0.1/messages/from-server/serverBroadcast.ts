import { BufferReader } from "../../../BufferReader";
import { BufferWriter } from "../../../BufferWriter";
import { ServerBroadcastMessageType } from "../../messageTypes";

export type DeltaNetV01ServerBroadcastMessage = {
  type: "serverBroadcast";
  broadcastType: number;
  contents: string;
};

export function encodeServerBroadcast(
  msg: DeltaNetV01ServerBroadcastMessage,
  writer: BufferWriter = new BufferWriter(64),
): BufferWriter {
  writer.writeUint8(ServerBroadcastMessageType);
  writer.writeUVarint(msg.broadcastType);
  writer.writeLengthPrefixedString(msg.contents);
  return writer;
}

// Assumes that the first byte has already been read (the message type)
export function decodeServerBroadcast(buffer: BufferReader): DeltaNetV01ServerBroadcastMessage {
  const broadcastType = buffer.readUVarint();
  const contents = buffer.readUVarintPrefixedString();
  return {
    type: "serverBroadcast",
    broadcastType,
    contents,
  };
}
