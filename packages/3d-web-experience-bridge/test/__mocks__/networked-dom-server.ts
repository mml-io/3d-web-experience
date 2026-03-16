// Stub for @mml-io/networked-dom-server — prevents loading jsdom/observable-dom
// which depends on ESM-only @exodus/bytes that Jest can't require().
export class EditableNetworkedDOM {}
export const LocalObservableDOMFactory = {};
export class NetworkedDOM {
  static handleWebsocketSubprotocol(protocols: Set<string>): string | false {
    return false;
  }
}
