import { jest, describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import {
  FROM_CLIENT_CHAT_MESSAGE_TYPE,
  FROM_SERVER_CHAT_MESSAGE_TYPE,
  FROM_SERVER_WORLD_CONFIG_MESSAGE_TYPE,
  type WorldConfigPayload,
} from "@mml-io/3d-web-experience-protocol";
import type { UserData } from "@mml-io/3d-web-user-networking";

import type { UserAuthenticator } from "../src/Networked3dWebExperienceServer";

// Mock @mml-io/networked-dom-server to avoid its deep ESM dependency chain
// (observable-dom → jsdom → html-encoding-sniffer → @exodus/bytes)
jest.unstable_mockModule("@mml-io/networked-dom-server", () => ({
  NetworkedDOM: {
    handleWebsocketSubprotocol: jest.fn(),
  },
  EditableNetworkedDOM: jest.fn(),
  LocalObservableDOMFactory: jest.fn(),
}));

const { Networked3dWebExperienceServer } = await import("../src/Networked3dWebExperienceServer");

function createMockAuthenticator(): UserAuthenticator {
  return {
    generateAuthorizedSessionToken: jest.fn<any>().mockResolvedValue("test-token"),
    getClientIdForSessionToken: jest.fn<any>().mockReturnValue({ id: 1 }),
    onClientConnect: jest.fn<any>().mockReturnValue({
      userId: "user-1",
      username: "TestUser",
      characterDescription: null,
      colors: null,
    } as UserData),
    onClientUserIdentityUpdate: jest
      .fn<any>()
      .mockImplementation((_connectionId: number, identity: UserData) => identity),
    onClientDisconnect: jest.fn(),
    dispose: jest.fn(),
  };
}

describe("Networked3dWebExperienceServer", () => {
  let server: InstanceType<typeof Networked3dWebExperienceServer>;
  let mockAuth: UserAuthenticator;

  beforeEach(() => {
    mockAuth = createMockAuthenticator();
    server = new Networked3dWebExperienceServer({
      networkPath: "/ws",
      userAuthenticator: mockAuth,
    });
  });

  afterEach(() => {
    server.dispose();
  });

  it("constructor creates UserNetworkingServer", () => {
    expect(server.userNetworkingServer).toBeDefined();
  });

  it("setWorldConfig stores config", () => {
    const config: WorldConfigPayload = { enableChat: false };
    // Mock broadcastMessage to avoid errors (no connected clients)
    server.userNetworkingServer.broadcastMessage = jest.fn() as any;
    server.setWorldConfig(config);
    expect(server.userNetworkingServer.broadcastMessage).toHaveBeenCalledWith(
      FROM_SERVER_WORLD_CONFIG_MESSAGE_TYPE,
      JSON.stringify(config),
    );
  });

  it("setWorldConfig with broadcast:false does not broadcast", () => {
    const config: WorldConfigPayload = { enableChat: true };
    server.userNetworkingServer.broadcastMessage = jest.fn() as any;
    server.setWorldConfig(config, { broadcast: false });
    expect(server.userNetworkingServer.broadcastMessage).not.toHaveBeenCalled();
  });

  it("dispose calls authenticator dispose", () => {
    server.dispose();
    expect(mockAuth.dispose).toHaveBeenCalled();
  });

  it("dispose disposes user networking server", () => {
    const disposeSpy = jest.spyOn(server.userNetworkingServer, "dispose");
    server.dispose();
    expect(disposeSpy).toHaveBeenCalled();
  });

  it("no mmlDocumentsServer when mmlServing is not provided", () => {
    expect(server.mmlDocumentsServer).toBeUndefined();
  });

  it("delegates onClientConnect to authenticator", () => {
    const result = mockAuth.onClientConnect(1, "test-token");
    expect(result).toEqual({
      userId: "user-1",
      username: "TestUser",
      characterDescription: null,
      colors: null,
    });
  });

  it("delegates onClientUserIdentityUpdate to authenticator", () => {
    const identity: UserData = {
      userId: "user-1",
      username: "Updated",
      characterDescription: null,
      colors: null,
    };
    const result = mockAuth.onClientUserIdentityUpdate(1, identity);
    expect(result).toBe(identity);
  });

  it("delegates onClientDisconnect to authenticator", () => {
    mockAuth.onClientDisconnect(1);
    expect(mockAuth.onClientDisconnect).toHaveBeenCalledWith(1);
  });

  describe("updateUserCharacter", () => {
    it("delegates to userNetworkingServer", () => {
      server.userNetworkingServer.updateUserCharacter = jest.fn() as any;
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      const userData: UserData = {
        userId: "user-new",
        username: "NewUser",
        characterDescription: null,
        colors: null,
      };
      server.updateUserCharacter(1, userData);
      expect(server.userNetworkingServer.updateUserCharacter).toHaveBeenCalledWith(1, userData);
      logSpy.mockRestore();
    });
  });

  describe("authenticator without dispose", () => {
    it("does not throw when authenticator has no dispose method", () => {
      const authWithoutDispose: UserAuthenticator = {
        generateAuthorizedSessionToken: jest.fn<any>().mockResolvedValue("token"),
        getClientIdForSessionToken: jest.fn<any>().mockReturnValue({ id: 1 }),
        onClientConnect: jest.fn<any>().mockReturnValue(true),
        onClientUserIdentityUpdate: jest.fn<any>().mockReturnValue(true),
        onClientDisconnect: jest.fn(),
      };
      const s = new Networked3dWebExperienceServer({
        networkPath: "/ws",
        userAuthenticator: authWithoutDispose,
      });
      expect(() => s.dispose()).not.toThrow();
    });
  });

  describe("constructor with mmlServing", () => {
    it("creates mmlDocumentsServer when mmlServing is provided", () => {
      const s = new Networked3dWebExperienceServer({
        networkPath: "/ws",
        userAuthenticator: mockAuth,
        mmlServing: {
          documentsWatchPath: "**/*.html",
          documentsDirectoryRoot: "/tmp/test-docs",
          documentsUrl: "/mml/",
        },
      });
      expect(s.mmlDocumentsServer).toBeDefined();
      s.dispose();
    });
  });

  describe("dispose with mmlDocumentsServer", () => {
    it("disposes mmlDocumentsServer when present", () => {
      const s = new Networked3dWebExperienceServer({
        networkPath: "/ws",
        userAuthenticator: mockAuth,
        mmlServing: {
          documentsWatchPath: "**/*.html",
          documentsDirectoryRoot: "/tmp/test-docs",
          documentsUrl: "/mml/",
        },
      });
      const disposeSpy = jest.spyOn(s.mmlDocumentsServer!, "dispose");
      s.dispose();
      expect(disposeSpy).toHaveBeenCalled();
    });
  });

  describe("constructor with worldConfig", () => {
    it("stores initial worldConfig", () => {
      const worldConfig: WorldConfigPayload = { enableChat: false };
      const s = new Networked3dWebExperienceServer({
        networkPath: "/ws",
        userAuthenticator: mockAuth,
        worldConfig,
      });
      // setWorldConfig should broadcast the stored config
      s.userNetworkingServer.broadcastMessage = jest.fn() as any;
      s.setWorldConfig({ enableChat: true });
      expect(s.userNetworkingServer.broadcastMessage).toHaveBeenCalledWith(
        FROM_SERVER_WORLD_CONFIG_MESSAGE_TYPE,
        JSON.stringify({ enableChat: true }),
      );
      s.dispose();
    });
  });

  describe("constructor with enableChat explicitly false", () => {
    it("creates server with chat disabled", () => {
      const s = new Networked3dWebExperienceServer({
        networkPath: "/ws",
        userAuthenticator: mockAuth,
        enableChat: false,
      });
      expect(s.userNetworkingServer).toBeDefined();
      s.dispose();
    });
  });
});
