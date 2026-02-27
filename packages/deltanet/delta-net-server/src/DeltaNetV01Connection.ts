import {
  deltaNetProtocolSubProtocol_v0_1,
  DeltaNetServerMessage,
  encodeServerMessage,
} from "@mml-io/delta-net-protocol";

import { DeltaNetConnection } from "./DeltaNetConnection";

export class DeltaNetV01Connection extends DeltaNetConnection {
  public readonly protocolVersion = deltaNetProtocolSubProtocol_v0_1;

  public override sendMessage(message: DeltaNetServerMessage): boolean {
    return this.sendEncodedBytes(encodeServerMessage(message).getBuffer());
  }
}
