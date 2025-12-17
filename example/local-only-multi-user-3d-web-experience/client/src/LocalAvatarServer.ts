import { CharacterState } from "@mml-io/3d-web-client-core";

export class LocalAvatarServer {
  private callbacks = new Map<
    number,
    (clientId: number, userNetworkingClientUpdate: null | CharacterState) => void
  >();

  send(clientId: number, userNetworkingClientUpdate: null | CharacterState) {
    this.callbacks.forEach((callback, callbackClientId) => {
      if (callbackClientId !== clientId) {
        callback(clientId, userNetworkingClientUpdate);
      }
    });
  }

  addClient(
    clientId: number,
    callback: (clientId: number, userNetworkingClientUpdate: null | CharacterState) => void,
  ) {
    this.callbacks.set(clientId, callback);
  }

  removeClient(clientId: number) {
    // Notify all other clients that this client has been removed
    this.callbacks.forEach((callback, callbackClientId) => {
      if (callbackClientId !== clientId) {
        callback(clientId, null);
      }
    });
    // Remove the callback for the removed client
    this.callbacks.delete(clientId);
  }
}
