


import {
  AnimationState,
  CharacterNetworkClientUpdate,
  CharacterNetworkCodec,
} from "./CharacterNetworkCodec";

export type Client = {
  socket: WebSocket;
  update: CharacterNetworkClientUpdate;
};

export class CharacterNetworkServer {
  private clients: Map<number, Client> = new Map();
  private clientLastPong: Map<number, number> = new Map();

















































      socket.send(CharacterNetworkCodec.encodeUpdate(update));




      update: {
        id,
        position: { x: 0, y: 0, z: 0 },
        rotation: { quaternionY: 0, quaternionW: 0 },
        state: AnimationState.idle,
      },







        update = CharacterNetworkCodec.decodeUpdate(arrayBuffer);







































    const updates: CharacterNetworkClientUpdate[] = [];





      const encodedUpdate = CharacterNetworkCodec.encodeUpdate(update);






