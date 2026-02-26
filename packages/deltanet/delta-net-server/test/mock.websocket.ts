import {
  BufferReader,
  BufferWriter,
  DecodeServerMessageOptions,
  DeltaNetServerMessage,
  DeltaNetClientMessage,
  encodeClientMessage,
} from "@mml-io/delta-net-protocol";

export type MockServerMessageDecoder = (
  buffer: BufferReader,
  opts?: DecodeServerMessageOptions,
) => Array<DeltaNetServerMessage>;

export class MockWebsocket {
  private allMessages: Array<DeltaNetServerMessage> = [];
  private messageTriggers = new Set<() => void>();
  private serverMessageListeners = new Set<(message: MessageEvent) => void>();
  private serverCloseListeners = new Set<() => void>();
  private isClosed = false;
  public readyState = 1; // WebSocket.OPEN

  constructor(
    public readonly protocol: string,
    private readonly decoder: MockServerMessageDecoder,
  ) {}

  send(data: Uint8Array) {
    const reader = new BufferReader(data);
    const messages = this.decoder(reader);
    this.allMessages.push(...messages);
    this.messageTriggers.forEach((trigger) => {
      trigger();
    });
  }

  public close() {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.readyState = 3; // WebSocket.CLOSED

    // Trigger close event listeners
    this.serverCloseListeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.warn("Error in close listener:", error);
      }
    });

    // Clear all listeners and triggers
    this.serverMessageListeners.clear();
    this.serverCloseListeners.clear();
    this.messageTriggers.clear();
  }

  async waitForTotalMessageCount(
    totalMessageCount: number,
    startFrom = 0,
  ): Promise<Array<DeltaNetServerMessage>> {
    let resolveProm: (value: Array<DeltaNetServerMessage>) => void;
    const promise = new Promise<Array<DeltaNetServerMessage>>((resolve) => {
      resolveProm = resolve;
    });

    if (this.allMessages.length >= totalMessageCount) {
      return this.allMessages.slice(startFrom, totalMessageCount);
    }

    const trigger = () => {
      if (this.allMessages.length >= totalMessageCount) {
        this.messageTriggers.delete(trigger);
        resolveProm(this.allMessages.slice(startFrom, totalMessageCount));
      }
    };
    this.messageTriggers.add(trigger);
    return promise;
  }

  addEventListener(eventType: string, listener: () => void) {
    if (eventType === "message") {
      this.serverMessageListeners.add(listener);
    } else if (eventType === "close") {
      this.serverCloseListeners.add(listener);
    }
  }

  removeEventListener(eventType: string, listener: () => void) {
    if (eventType === "message") {
      this.serverMessageListeners.delete(listener);
    } else if (eventType === "close") {
      this.serverCloseListeners.delete(listener);
    }
  }

  sendToServer(toSend: DeltaNetClientMessage) {
    if (this.isClosed) {
      throw new Error("Cannot send message on closed WebSocket");
    }

    const writer = new BufferWriter(32);
    encodeClientMessage(toSend, writer);
    this.serverMessageListeners.forEach((listener) => {
      listener(
        new MessageEvent("message", {
          data: writer.getBuffer(),
        }),
      );
    });
  }

  getMessage(number: number) {
    return this.allMessages[number] as DeltaNetServerMessage;
  }

  get closed(): boolean {
    return this.isClosed;
  }
}
