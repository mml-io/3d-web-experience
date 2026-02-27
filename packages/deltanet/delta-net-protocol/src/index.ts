export * from "./BufferReader";
export * from "./BufferWriter";
export * from "./decodeOptions";
export * from "./DeflateCompressor";
export * from "./delta-net-v0.1";
export * from "./delta-net-v0.2";

import { deltaNetProtocolSubProtocol_v0_1 } from "./delta-net-v0.1";
import { deltaNetProtocolSubProtocol_v0_2 } from "./delta-net-v0.2";

/**
 * Version-neutral aliases — today all protocol versions share the same decoded
 * message shapes and error types. Code that is not version-specific should
 * prefer these over the DeltaNetV01* originals.
 */

// Server → client message types
export type { DeltaNetV01ServerMessage as DeltaNetServerMessage } from "./delta-net-v0.1";
export type { DeltaNetV01Tick as DeltaNetTick } from "./delta-net-v0.1";
export type { DeltaNetV01ComponentTick as DeltaNetComponentTick } from "./delta-net-v0.1";
export type { DeltaNetV01StateUpdates as DeltaNetStateUpdates } from "./delta-net-v0.1";
export type { DeltaNetV01InitialCheckoutMessage as DeltaNetInitialCheckoutMessage } from "./delta-net-v0.1";
export type { DeltaNetV01InitialCheckoutComponent as DeltaNetInitialCheckoutComponent } from "./delta-net-v0.1";
export type { DeltaNetV01InitialCheckoutState as DeltaNetInitialCheckoutState } from "./delta-net-v0.1";
export type { DeltaNetV01ErrorMessage as DeltaNetErrorMessage } from "./delta-net-v0.1";
export type { DeltaNetV01ServerErrorType as DeltaNetServerErrorType } from "./delta-net-v0.1";
export type { DeltaNetV01UserIndexMessage as DeltaNetUserIndexMessage } from "./delta-net-v0.1";
export type { DeltaNetV01PingMessage as DeltaNetPingMessage } from "./delta-net-v0.1";
export type { DeltaNetV01ServerCustomMessage as DeltaNetServerCustomMessage } from "./delta-net-v0.1";
export type { DeltaNetV01WarningMessage as DeltaNetWarningMessage } from "./delta-net-v0.1";

// Client → server message types
export type { DeltaNetV01ClientMessage as DeltaNetClientMessage } from "./delta-net-v0.1";
export type { DeltaNetV01ConnectUserMessage as DeltaNetConnectUserMessage } from "./delta-net-v0.1";
export type { DeltaNetV01SetUserComponentsMessage as DeltaNetSetUserComponentsMessage } from "./delta-net-v0.1";
export type { DeltaNetV01ClientCustomMessage as DeltaNetClientCustomMessage } from "./delta-net-v0.1";
export type { DeltaNetV01PongMessage as DeltaNetPongMessage } from "./delta-net-v0.1";

// Error constants
export { DeltaNetV01ServerErrors as DeltaNetServerErrors } from "./delta-net-v0.1";

/** Supported sub-protocols in preference order (newest first). */
export const deltaNetSupportedSubProtocols = [
  deltaNetProtocolSubProtocol_v0_2,
  deltaNetProtocolSubProtocol_v0_1,
] as const;
