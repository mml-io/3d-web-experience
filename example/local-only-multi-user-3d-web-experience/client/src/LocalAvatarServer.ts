import { CharacterState } from "@mml-io/3d-web-client-core";

export class LocalAvatarServer {
  private callbacks = new Map<
    number,
    (connectionId: number, userNetworkingClientUpdate: null | CharacterState) => void
  >();

  send(connectionId: number, userNetworkingClientUpdate: null | CharacterState) {
    this.callbacks.forEach((callback, callbackConnectionId) => {
      if (callbackConnectionId !== connectionId) {
        callback(connectionId, userNetworkingClientUpdate);
      }
    });
  }

  addClient(
    connectionId: number,
    callback: (connectionId: number, userNetworkingClientUpdate: null | CharacterState) => void,
  ) {
    this.callbacks.set(connectionId, callback);
  }

  removeClient(connectionId: number) {
    // Notify all other clients that this client has been removed
    this.callbacks.forEach((callback, callbackConnectionId) => {
      if (callbackConnectionId !== connectionId) {
        callback(connectionId, null);
      }
    });
    // Remove the callback for the removed client
    this.callbacks.delete(connectionId);
  }
}
