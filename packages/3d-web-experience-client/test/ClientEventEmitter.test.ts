import { jest } from "@jest/globals";

import { ClientEventEmitter } from "../src/ClientEventEmitter";

// ClientEventEmitter has `emit` as protected, so we need a test subclass
class TestEmitter extends ClientEventEmitter {
  public testEmit<K extends Parameters<ClientEventEmitter["emit"]>[0]>(
    ...args: Parameters<ClientEventEmitter["emit"]>
  ): void {
    this.emit(...args);
  }
}

describe("ClientEventEmitter", () => {
  let emitter: TestEmitter;

  beforeEach(() => {
    emitter = new TestEmitter();
  });

  it("on/off subscribe/unsubscribe", () => {
    const handler = jest.fn();
    emitter.on("chat", handler);
    emitter.testEmit("chat", {
      username: "TestUser",
      message: "hello",
      fromConnectionId: 1,
      userId: "user-1",
      isLocal: false,
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      username: "TestUser",
      message: "hello",
      fromConnectionId: 1,
      userId: "user-1",
      isLocal: false,
    });

    emitter.off("chat", handler);
    emitter.testEmit("chat", {
      username: "TestUser",
      message: "world",
      fromConnectionId: 1,
      userId: "user-1",
      isLocal: false,
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("emit delivers to all handlers", () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();
    emitter.on("chat", handler1);
    emitter.on("chat", handler2);
    emitter.testEmit("chat", {
      username: "A",
      message: "hi",
      fromConnectionId: 1,
      userId: "user-1",
      isLocal: false,
    });
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it("emit with no handlers does not throw", () => {
    expect(() => {
      emitter.testEmit("chat", {
        username: "A",
        message: "hi",
        fromConnectionId: 1,
        userId: "user-1",
        isLocal: false,
      });
    }).not.toThrow();
  });

  it("off for non-existent handler is safe", () => {
    const handler = jest.fn();
    expect(() => {
      emitter.off("chat", handler);
    }).not.toThrow();
  });

  it("multiple events on different keys", () => {
    const chatHandler = jest.fn();
    const joinHandler = jest.fn();
    emitter.on("chat", chatHandler);
    emitter.on("userJoined", joinHandler);

    emitter.testEmit("chat", {
      username: "A",
      message: "hi",
      fromConnectionId: 1,
      userId: "user-1",
      isLocal: false,
    });
    emitter.testEmit("userJoined", { connectionId: 2, userId: "user-2", username: "B" });

    expect(chatHandler).toHaveBeenCalledTimes(1);
    expect(joinHandler).toHaveBeenCalledTimes(1);
    expect(joinHandler).toHaveBeenCalledWith({
      connectionId: 2,
      userId: "user-2",
      username: "B",
    });
  });

  it("void-typed events (ready, disposed)", () => {
    const readyHandler = jest.fn();
    const disposedHandler = jest.fn();
    emitter.on("ready", readyHandler);
    emitter.on("disposed", disposedHandler);

    emitter.testEmit("ready");
    emitter.testEmit("disposed");

    expect(readyHandler).toHaveBeenCalledTimes(1);
    expect(disposedHandler).toHaveBeenCalledTimes(1);
  });

  it("userLeft event", () => {
    const handler = jest.fn();
    emitter.on("userLeft", handler);
    emitter.testEmit("userLeft", { connectionId: 5, userId: "user-5", username: "Leaver" });
    expect(handler).toHaveBeenCalledWith({
      connectionId: 5,
      userId: "user-5",
      username: "Leaver",
    });
  });
});
