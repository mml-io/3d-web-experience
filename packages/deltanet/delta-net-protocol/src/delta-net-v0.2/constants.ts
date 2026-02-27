export const deltaNetProtocolSubProtocol_v0_2 = "delta-net-v0.2";

/**
 * Maximum total number of elements (componentsLength * indicesCount) allowed
 * in contiguous encode/decode operations. Guards against allocation bombs from
 * malformed or malicious messages.
 */
export const MAX_CONTIGUOUS_ELEMENTS = 10_000_000;
