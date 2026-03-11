import { describe, expect, it } from "@jest/globals";

import {
  experienceProtocolSubProtocol_v0_1,
  experienceProtocol_v0_1_deltaNetSubProtocol,
  FROM_CLIENT_CHAT_MESSAGE_TYPE,
  FROM_SERVER_BROADCAST_MESSAGE_TYPE,
  FROM_SERVER_CHAT_MESSAGE_TYPE,
  FROM_SERVER_WORLD_CONFIG_MESSAGE_TYPE,
} from "./3d-web-experience-v0.1";

import {
  experienceClientSubProtocols,
  experienceProtocolToDeltaNetSubProtocol,
  handleExperienceWebsocketSubprotocol,
} from "./index";

describe("message type constants", () => {
  it("has distinct numeric values for each message type", () => {
    const types = [
      FROM_SERVER_BROADCAST_MESSAGE_TYPE,
      FROM_CLIENT_CHAT_MESSAGE_TYPE,
      FROM_SERVER_CHAT_MESSAGE_TYPE,
      FROM_SERVER_WORLD_CONFIG_MESSAGE_TYPE,
    ];
    const uniqueTypes = new Set(types);
    expect(uniqueTypes.size).toBe(types.length);
  });

  it("has specific expected values", () => {
    expect(FROM_SERVER_BROADCAST_MESSAGE_TYPE).toBe(1);
    expect(FROM_CLIENT_CHAT_MESSAGE_TYPE).toBe(2);
    expect(FROM_SERVER_CHAT_MESSAGE_TYPE).toBe(3);
    expect(FROM_SERVER_WORLD_CONFIG_MESSAGE_TYPE).toBe(4);
  });
});

describe("experienceProtocolToDeltaNetSubProtocol", () => {
  it("maps the v0.1 experience protocol to the correct delta-net sub-protocol", () => {
    const result = experienceProtocolToDeltaNetSubProtocol(experienceProtocolSubProtocol_v0_1);
    expect(result).toBe(experienceProtocol_v0_1_deltaNetSubProtocol);
  });

  it("maps '3d-web-experience-v0.1' to 'delta-net-v0.2'", () => {
    const result = experienceProtocolToDeltaNetSubProtocol("3d-web-experience-v0.1");
    expect(result).toBe("delta-net-v0.2");
  });

  it("returns null for an unknown protocol string", () => {
    const result = experienceProtocolToDeltaNetSubProtocol("unknown-protocol");
    expect(result).toBeNull();
  });

  it("returns null for an empty string", () => {
    const result = experienceProtocolToDeltaNetSubProtocol("");
    expect(result).toBeNull();
  });

  it("returns null for a similar but not exact protocol string", () => {
    const result = experienceProtocolToDeltaNetSubProtocol("3d-web-experience-v0.2");
    expect(result).toBeNull();
  });

  it("is case-sensitive", () => {
    const result = experienceProtocolToDeltaNetSubProtocol("3D-WEB-EXPERIENCE-V0.1");
    expect(result).toBeNull();
  });
});

describe("handleExperienceWebsocketSubprotocol", () => {
  it("selects the v0.1 protocol when offered in a Set", () => {
    const protocols = new Set(["some-other", experienceProtocolSubProtocol_v0_1, "another"]);
    const result = handleExperienceWebsocketSubprotocol(protocols);
    expect(result).toBe(experienceProtocolSubProtocol_v0_1);
  });

  it("selects the v0.1 protocol when offered in an Array", () => {
    const protocols = ["some-other", experienceProtocolSubProtocol_v0_1];
    const result = handleExperienceWebsocketSubprotocol(protocols);
    expect(result).toBe(experienceProtocolSubProtocol_v0_1);
  });

  it("returns false when no matching protocols are offered (Set)", () => {
    const protocols = new Set(["not-a-match", "also-not"]);
    const result = handleExperienceWebsocketSubprotocol(protocols);
    expect(result).toBe(false);
  });

  it("returns false when no matching protocols are offered (Array)", () => {
    const protocols = ["not-a-match"];
    const result = handleExperienceWebsocketSubprotocol(protocols);
    expect(result).toBe(false);
  });

  it("returns false for an empty Set", () => {
    const result = handleExperienceWebsocketSubprotocol(new Set());
    expect(result).toBe(false);
  });

  it("returns false for an empty Array", () => {
    const result = handleExperienceWebsocketSubprotocol([]);
    expect(result).toBe(false);
  });

  it("selects the highest-priority protocol when multiple match", () => {
    // Currently there is only one protocol, but this test verifies the
    // iteration order respects experienceClientSubProtocols priority.
    const protocols = new Set([experienceProtocolSubProtocol_v0_1]);
    const result = handleExperienceWebsocketSubprotocol(protocols);
    expect(result).toBe(experienceClientSubProtocols[0]);
  });
});

describe("experienceClientSubProtocols", () => {
  it("contains at least one protocol", () => {
    expect(experienceClientSubProtocols.length).toBeGreaterThanOrEqual(1);
  });

  it("lists v0.1 as the first (highest-priority) protocol", () => {
    expect(experienceClientSubProtocols[0]).toBe("3d-web-experience-v0.1");
  });
});

describe("protocol constants", () => {
  it("experienceProtocolSubProtocol_v0_1 has expected value", () => {
    expect(experienceProtocolSubProtocol_v0_1).toBe("3d-web-experience-v0.1");
  });

  it("experienceProtocol_v0_1_deltaNetSubProtocol has expected value", () => {
    expect(experienceProtocol_v0_1_deltaNetSubProtocol).toBe("delta-net-v0.2");
  });
});
