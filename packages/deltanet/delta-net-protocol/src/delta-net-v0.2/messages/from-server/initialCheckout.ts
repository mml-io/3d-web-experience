import { BufferReader } from "../../../BufferReader";
import { BufferWriter } from "../../../BufferWriter";
import type { DecodeServerMessageOptions } from "../../../decodeOptions";
import { DeflateCompressor } from "../../../DeflateCompressor";
import type {
  DeltaNetV01InitialCheckoutComponent as DeltaNetInitialCheckoutComponent,
  DeltaNetV01InitialCheckoutMessage as DeltaNetInitialCheckoutMessage,
  DeltaNetV01InitialCheckoutState as DeltaNetInitialCheckoutState,
} from "../../../delta-net-v0.1";
import { InitialCheckoutMessageType } from "../../../delta-net-v0.1";
import { MAX_CONTIGUOUS_ELEMENTS } from "../../constants";

/**
 * Encodes an initial checkout message using v0.2 contiguous compression.
 * All component values and deltas are concatenated into single blocks before compression.
 */
export function encodeInitialCheckoutV02(
  msg: DeltaNetInitialCheckoutMessage,
  writer: BufferWriter = new BufferWriter(64),
): BufferWriter {
  writer.writeUint8(InitialCheckoutMessageType);
  writer.writeUVarint(msg.serverTime);
  writer.writeUVarint(msg.indicesCount);

  // Write component count and all component IDs upfront
  writer.writeUVarint(msg.components.length);
  for (const { componentId } of msg.components) {
    writer.writeUVarint(componentId);
  }

  // Concatenate all values into a single contiguous array, then all deltas
  if (msg.components.length > 0 && msg.indicesCount > 0) {
    const totalLength = msg.components.length * msg.indicesCount;
    if (totalLength > MAX_CONTIGUOUS_ELEMENTS) {
      throw new Error(
        `Encoded totalLength exceeds maximum: ${totalLength} elements (${msg.components.length} components * ${msg.indicesCount} indices)`,
      );
    }

    // Concatenate all values
    const allValues = new BigInt64Array(totalLength);
    for (let i = 0; i < msg.components.length; i++) {
      const values = msg.components[i].values;
      if (values.length < msg.indicesCount) {
        throw new Error(
          `Component ${msg.components[i].componentId} values length ${values.length} is less than indicesCount ${msg.indicesCount}`,
        );
      }
      allValues.set(values.subarray(0, msg.indicesCount), i * msg.indicesCount);
    }
    const [, compressedValues] = DeflateCompressor.varIntCompress(allValues, totalLength);
    writer.writeUVarintLengthPrefixedBytes(compressedValues);

    // Concatenate all deltas
    const allDeltas = new BigInt64Array(totalLength);
    for (let i = 0; i < msg.components.length; i++) {
      const deltas = msg.components[i].deltas;
      if (deltas.length < msg.indicesCount) {
        throw new Error(
          `Component ${msg.components[i].componentId} deltas length ${deltas.length} is less than indicesCount ${msg.indicesCount}`,
        );
      }
      allDeltas.set(deltas.subarray(0, msg.indicesCount), i * msg.indicesCount);
    }
    const [, compressedDeltas] = DeflateCompressor.varIntCompress(allDeltas, totalLength);
    writer.writeUVarintLengthPrefixedBytes(compressedDeltas);
  }

  // States encoding is unchanged from v0.1
  writer.writeUVarint(msg.states.length);
  for (const { stateId, values } of msg.states) {
    writer.writeUVarint(stateId);
    const [, stateBytes] = DeflateCompressor.varIntBytesCompress(values, msg.indicesCount);
    writer.writeUVarintLengthPrefixedBytes(stateBytes);
  }
  return writer;
}

/**
 * Decodes an initial checkout message encoded with v0.2 contiguous compression.
 * Assumes that the first byte (message type) has already been read.
 */
export function decodeInitialCheckoutV02(
  buffer: BufferReader,
  opts?: DecodeServerMessageOptions,
): DeltaNetInitialCheckoutMessage {
  let componentsByteLength = 0;
  let statesByteLength = 0;

  const serverTime = buffer.readUVarint();
  const indicesCount = buffer.readUVarint();

  // Read component count and all component IDs upfront
  const componentsLength = buffer.readUVarint();
  const componentIds: Array<number> = [];
  for (let i = 0; i < componentsLength; i++) {
    componentIds.push(buffer.readUVarint());
  }

  const components: Array<DeltaNetInitialCheckoutComponent> = [];
  if (componentsLength > 0 && indicesCount > 0) {
    const totalLength = componentsLength * indicesCount;

    if (totalLength > MAX_CONTIGUOUS_ELEMENTS) {
      throw new Error(
        `Decoded totalLength exceeds maximum: ${totalLength} elements (${componentsLength} components * ${indicesCount} indices)`,
      );
    }

    // Read and decompress values block
    const compressedValues = buffer.readUVarintPrefixedBytes();
    componentsByteLength += compressedValues.byteLength;

    // Read and decompress deltas block
    const compressedDeltas = buffer.readUVarintPrefixedBytes();
    componentsByteLength += compressedDeltas.byteLength;

    if (opts?.ignoreData) {
      for (let i = 0; i < componentsLength; i++) {
        components.push({
          componentId: componentIds[i],
          deltas: new BigInt64Array(indicesCount),
          values: new BigInt64Array(indicesCount),
        });
      }
    } else {
      const allValues = DeflateCompressor.varIntDecompress(compressedValues, totalLength);
      const allDeltas = DeflateCompressor.varIntDecompress(compressedDeltas, totalLength);
      for (let i = 0; i < componentsLength; i++) {
        components.push({
          componentId: componentIds[i],
          values: allValues.slice(i * indicesCount, (i + 1) * indicesCount),
          deltas: allDeltas.slice(i * indicesCount, (i + 1) * indicesCount),
        });
      }
    }
  } else if (componentsLength > 0) {
    // indicesCount is 0, so no compressed data was written — emit empty arrays
    for (let i = 0; i < componentsLength; i++) {
      components.push({
        componentId: componentIds[i],
        values: new BigInt64Array(0),
        deltas: new BigInt64Array(0),
      });
    }
  }

  // States decoding is unchanged from v0.1
  const statesLength = buffer.readUVarint();
  const states: Array<DeltaNetInitialCheckoutState> = [];
  for (let i = 0; i < statesLength; i++) {
    const stateId = buffer.readUVarint();
    const valuesBytes = buffer.readUVarintPrefixedBytes();
    statesByteLength += valuesBytes.byteLength;
    if (opts?.ignoreData) {
      const emptyValues = Array.from({ length: indicesCount }, () => new Uint8Array(0));
      states.push({ stateId, values: emptyValues });
    } else {
      const values = DeflateCompressor.varIntBytesDecompress(valuesBytes, indicesCount);
      states.push({ stateId, values });
    }
  }

  if (opts?.debugData) {
    opts.debugData.componentsByteLength += componentsByteLength;
    opts.debugData.statesByteLength += statesByteLength;
  }
  return {
    type: "initialCheckout",
    serverTime,
    indicesCount,
    components,
    states,
  };
}
