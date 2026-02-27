import { decodeServerMessages, deltaNetProtocolSubProtocol_v0_1 } from "@mml-io/delta-net-protocol";

import { MockWebsocket } from "../mock.websocket";

export class MockWebsocketV01 extends MockWebsocket {
  constructor() {
    super(deltaNetProtocolSubProtocol_v0_1, decodeServerMessages);
  }
}
