import {
  decodeServerMessagesV02,
  deltaNetProtocolSubProtocol_v0_2,
} from "@mml-io/delta-net-protocol";

import { MockWebsocket } from "../mock.websocket";

export class MockWebsocketV02 extends MockWebsocket {
  constructor() {
    super(deltaNetProtocolSubProtocol_v0_2, decodeServerMessagesV02);
  }
}
