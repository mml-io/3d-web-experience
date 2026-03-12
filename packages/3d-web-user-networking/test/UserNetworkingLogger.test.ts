import { jest, describe, expect, test } from "@jest/globals";

import { UserNetworkingConsoleLogger } from "../src/UserNetworkingLogger";

describe("UserNetworkingConsoleLogger", () => {
  test("trace delegates to console.trace", () => {
    const spy = jest.spyOn(console, "trace").mockImplementation(() => {});
    const logger = new UserNetworkingConsoleLogger();
    logger.trace("hello", 42);
    expect(spy).toHaveBeenCalledWith("hello", 42);
    spy.mockRestore();
  });

  test("debug delegates to console.debug", () => {
    const spy = jest.spyOn(console, "debug").mockImplementation(() => {});
    const logger = new UserNetworkingConsoleLogger();
    logger.debug("msg");
    expect(spy).toHaveBeenCalledWith("msg");
    spy.mockRestore();
  });

  test("info delegates to console.info", () => {
    const spy = jest.spyOn(console, "info").mockImplementation(() => {});
    const logger = new UserNetworkingConsoleLogger();
    logger.info("info msg");
    expect(spy).toHaveBeenCalledWith("info msg");
    spy.mockRestore();
  });

  test("warn delegates to console.warn", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const logger = new UserNetworkingConsoleLogger();
    logger.warn("warning");
    expect(spy).toHaveBeenCalledWith("warning");
    spy.mockRestore();
  });

  test("error delegates to console.error", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const logger = new UserNetworkingConsoleLogger();
    logger.error("err", new Error("test"));
    expect(spy).toHaveBeenCalledWith("err", expect.any(Error));
    spy.mockRestore();
  });
});
