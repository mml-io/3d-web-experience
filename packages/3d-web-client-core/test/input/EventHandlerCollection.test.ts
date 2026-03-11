import { jest } from "@jest/globals";

import { EventHandlerCollection } from "../../src/input/EventHandlerCollection";

describe("EventHandlerCollection", () => {
  it("add registers listener and clear removes it", () => {
    const target = new EventTarget();
    const listener = jest.fn();

    const collection = new EventHandlerCollection();
    collection.add(target, "click", listener);
    target.dispatchEvent(new Event("click"));
    expect(listener).toHaveBeenCalledTimes(1);

    collection.clear();
    target.dispatchEvent(new Event("click"));
    expect(listener).toHaveBeenCalledTimes(1); // Not called again
  });

  it("multiple listeners on same target and key", () => {
    const target = new EventTarget();
    const listener1 = jest.fn();
    const listener2 = jest.fn();

    const collection = new EventHandlerCollection();
    collection.add(target, "click", listener1);
    collection.add(target, "click", listener2);

    target.dispatchEvent(new Event("click"));
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);

    collection.clear();
    target.dispatchEvent(new Event("click"));
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it("multiple targets", () => {
    const target1 = new EventTarget();
    const target2 = new EventTarget();
    const listener1 = jest.fn();
    const listener2 = jest.fn();

    const collection = new EventHandlerCollection();
    collection.add(target1, "click", listener1);
    collection.add(target2, "custom", listener2);

    target1.dispatchEvent(new Event("click"));
    target2.dispatchEvent(new Event("custom"));

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);

    collection.clear();
    target1.dispatchEvent(new Event("click"));
    target2.dispatchEvent(new Event("custom"));
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it("static create() factory", () => {
    const target = new EventTarget();
    const listener = jest.fn();

    const collection = EventHandlerCollection.create([[target, "click", listener]]);
    target.dispatchEvent(new Event("click"));
    expect(listener).toHaveBeenCalledTimes(1);

    collection.clear();
  });

  it("static create() without initial array", () => {
    const collection = EventHandlerCollection.create();
    // Should not throw
    collection.clear();
  });

  it("add returns this for chaining", () => {
    const target = new EventTarget();
    const collection = new EventHandlerCollection();
    const result = collection.add(target, "click", jest.fn());
    expect(result).toBe(collection);
    collection.clear();
  });
});
