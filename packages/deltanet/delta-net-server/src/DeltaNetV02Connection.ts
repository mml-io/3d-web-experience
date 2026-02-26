import {
  deltaNetProtocolSubProtocol_v0_2,
  DeltaNetServerMessage,
  encodeServerMessageV02,
} from "@mml-io/delta-net-protocol";

import { DeltaNetConnection } from "./DeltaNetConnection";

export class DeltaNetV02Connection extends DeltaNetConnection {
  public readonly protocolVersion = deltaNetProtocolSubProtocol_v0_2;

  public override sendMessage(message: DeltaNetServerMessage): boolean {
    return this.sendEncodedBytes(encodeServerMessageV02(message).getBuffer());
  }
}
