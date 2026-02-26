import { BufferReader } from "../../../BufferReader";
import { BufferWriter } from "../../../BufferWriter";
import type { DecodeServerMessageOptions } from "../../../decodeOptions";
import { DeflateCompressor } from "../../../DeflateCompressor";
import type {
  DeltaNetV01ComponentTick as DeltaNetComponentTick,
  DeltaNetV01StateUpdates as DeltaNetStateUpdates,
  DeltaNetV01Tick as DeltaNetTick,
} from "../../../delta-net-v0.1";
import { TickMessageType } from "../../../delta-net-v0.1";
import { MAX_CONTIGUOUS_ELEMENTS } from "../../constants";

/**
 * Encodes a tick message using v0.2 contiguous compression.
 * All component delta-deltas are concatenated into a single block before compression,
 * reducing deflate framing overhead from O(componentCount) to O(1).
 */
export function encodeTickV02(
  msg: DeltaNetTick,
  writer: BufferWriter = new BufferWriter(64),
): BufferWriter {
  writer.writeUint8(TickMessageType);

  writer.writeUVarint(msg.serverTime);

  writer.writeUVarint(msg.removedIndices.length);
  for (const index of msg.removedIndices) {
    writer.writeUVarint(index);
  }
  writer.writeUVarint(msg.indicesCount);

  // Write component count and all component IDs upfront
  writer.writeUVarint(msg.componentDeltaDeltas.length);
  for (const componentTick of msg.componentDeltaDeltas) {
    writer.writeUVarint(componentTick.componentId);
  }

  // Concatenate all delta-deltas into a single contiguous array
  if (msg.componentDeltaDeltas.length > 0 && msg.indicesCount > 0) {
    const totalLength = msg.componentDeltaDeltas.length * msg.indicesCount;
    if (totalLength > MAX_CONTIGUOUS_ELEMENTS) {
      throw new Error(
        `Encoded totalLength exceeds maximum: ${totalLength} elements (${msg.componentDeltaDeltas.length} components * ${msg.indicesCount} indices)`,
      );
    }
    const allDeltaDeltas = new BigInt64Array(totalLength);
    for (let i = 0; i < msg.componentDeltaDeltas.length; i++) {
      const deltaDeltas = msg.componentDeltaDeltas[i].deltaDeltas;
      if (deltaDeltas.length < msg.indicesCount) {
        throw new Error(
          `Component ${msg.componentDeltaDeltas[i].componentId} deltaDeltas length ${deltaDeltas.length} is less than indicesCount ${msg.indicesCount}`,
        );
      }
      allDeltaDeltas.set(deltaDeltas.subarray(0, msg.indicesCount), i * msg.indicesCount);
    }

    // Single compression call for all component data
    const [, compressedBytes] = DeflateCompressor.varIntCompress(allDeltaDeltas, totalLength);
    writer.writeUVarintLengthPrefixedBytes(compressedBytes);
  }

  // States encoding is unchanged from v0.1
  writer.writeUVarint(msg.states.length);
  for (const state of msg.states) {
    writer.writeUVarint(state.stateId);
    writer.writeUVarint(state.updatedStates.length);

    const indices = new BigInt64Array(state.updatedStates.length);
    const values = new Array<Uint8Array>(state.updatedStates.length);

    for (let i = 0; i < state.updatedStates.length; i++) {
      const [index, value] = state.updatedStates[i];
      indices[i] = BigInt(index);
      values[i] = value;
    }

    const [, compressedIndices] = DeflateCompressor.varIntCompress(indices, indices.length);
    writer.writeUVarintLengthPrefixedBytes(compressedIndices);

    const [, compressedValues] = DeflateCompressor.varIntBytesCompress(values, values.length);
    writer.writeUVarintLengthPrefixedBytes(compressedValues);
  }
  return writer;
}

/**
 * Decodes a tick message encoded with v0.2 contiguous compression.
 * Assumes that the first byte (message type) has already been read.
 */
export function decodeTickV02(
  buffer: BufferReader,
  opts?: DecodeServerMessageOptions,
): DeltaNetTick {
  let componentsByteLength = 0;
  let statesByteLength = 0;

  const serverTime = buffer.readUVarint();
  const removedIndicesLength = buffer.readUVarint();
  const removedIndices: Array<number> = [];
  for (let i = 0; i < removedIndicesLength; i++) {
    removedIndices.push(buffer.readUVarint());
  }
  const indicesCount = buffer.readUVarint();

  // Read component count and all component IDs upfront
  const componentsLength = buffer.readUVarint();
  const componentIds: Array<number> = [];
  for (let i = 0; i < componentsLength; i++) {
    componentIds.push(buffer.readUVarint());
  }

  // Read and decompress the single contiguous block
  const components: Array<DeltaNetComponentTick> = [];
  if (componentsLength > 0 && indicesCount > 0) {
    const totalLength = componentsLength * indicesCount;
    if (totalLength > MAX_CONTIGUOUS_ELEMENTS) {
      throw new Error(
        `Decoded totalLength exceeds maximum: ${totalLength} elements (${componentsLength} components * ${indicesCount} indices)`,
      );
    }

    const compressedBlock = buffer.readUVarintPrefixedBytes();
    componentsByteLength += compressedBlock.byteLength;
    if (opts?.ignoreData) {
      for (let i = 0; i < componentsLength; i++) {
        components.push({
          componentId: componentIds[i],
          deltaDeltas: new BigInt64Array(indicesCount),
        });
      }
    } else {
      const allDeltaDeltas = DeflateCompressor.varIntDecompress(compressedBlock, totalLength);

      // Slice into per-component arrays
      for (let i = 0; i < componentsLength; i++) {
        components.push({
          componentId: componentIds[i],
          deltaDeltas: allDeltaDeltas.slice(i * indicesCount, (i + 1) * indicesCount),
        });
      }
    }
  } else if (componentsLength > 0) {
    // indicesCount is 0, so no compressed data was written — emit empty arrays
    for (let i = 0; i < componentsLength; i++) {
      components.push({
        componentId: componentIds[i],
        deltaDeltas: new BigInt64Array(0),
      });
    }
  }

  // States decoding is unchanged from v0.1
  const statesLength = buffer.readUVarint();
  const states: Array<DeltaNetStateUpdates> = [];
  for (let i = 0; i < statesLength; i++) {
    const stateId = buffer.readUVarint();
    const stateCount = buffer.readUVarint();
    const state: DeltaNetStateUpdates = {
      stateId,
      updatedStates: [],
    };

    const compressedIndices = buffer.readUVarintPrefixedBytes();
    const compressedValues = buffer.readUVarintPrefixedBytes();
    statesByteLength += compressedIndices.byteLength;
    statesByteLength += compressedValues.byteLength;

    if (stateCount > 0 && !opts?.ignoreData) {
      const indices = DeflateCompressor.varIntDecompress(compressedIndices, stateCount);
      const values = DeflateCompressor.varIntBytesDecompress(compressedValues, stateCount);

      for (let j = 0; j < stateCount; j++) {
        const index = Number(indices[j]);
        const value = values[j];
        state.updatedStates.push([index, value]);
      }
    }

    states.push(state);
  }

  if (opts?.debugData) {
    opts.debugData.componentsByteLength += componentsByteLength;
    opts.debugData.statesByteLength += statesByteLength;
  }
  return {
    type: "tick",
    serverTime,
    removedIndices,
    indicesCount,
    componentDeltaDeltas: components,
    states,
  };
}
