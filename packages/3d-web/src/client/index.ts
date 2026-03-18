import {
  EnvironmentConfiguration,
  LoadingScreenConfig,
  SpawnConfiguration,
} from "@mml-io/3d-web-client-core";
import {
  DefaultAvatarSelectionPlugin,
  DefaultChatPlugin,
  DefaultHUDPlugin,
  Networked3dWebExperienceClient,
  Networked3dWebExperienceClientConfig,
} from "@mml-io/3d-web-experience-client";
import {
  ServerBroadcastMessage,
  WorldConfigPayload,
  parseWorldConfigPayload,
} from "@mml-io/3d-web-experience-protocol";

import airAnimationFileUrl from "../../assets/models/anim_air.glb";
import doubleJumpAnimationFileUrl from "../../assets/models/anim_double_jump.glb";
import idleAnimationFileUrl from "../../assets/models/anim_idle.glb";
import jogAnimationFileUrl from "../../assets/models/anim_jog.glb";
import sprintAnimationFileUrl from "../../assets/models/anim_run.glb";
import type { PageConfig } from "../config";
import { WORLD_CONFIG_UPDATE_BROADCAST_TYPE } from "../constants";
import { normalizeDocumentProtocols } from "../normalizeDocumentProtocols";

// ---------------------------------------------------------------------------
// window.experience — public API for injected client scripts
// ---------------------------------------------------------------------------
type ExperienceEventMap = {
  ready: undefined;
  chat: {
    username: string;
    message: string;
    fromConnectionId: number;
    userId: string;
    isLocal: boolean;
  };
  "player-join": { connectionId: number; userId: string; username: string };
  "player-leave": { connectionId: number; userId: string; username: string };
};

type ExperienceEventHandler<K extends keyof ExperienceEventMap = keyof ExperienceEventMap> = (
  data: ExperienceEventMap[K],
) => void;

type ExperienceApi = {
  getCharacterStates(): Map<
    number,
    {
      connectionId: number;
      userId: string;
      position: { x: number; y: number; z: number };
      username: string;
      isLocal: boolean;
    }
  > | null;
  getLocalPlayer(): {
    connectionId: number;
    userId: string;
    position: { x: number; y: number; z: number };
    username: string;
  } | null;
  selectAvatar(avatar: {
    meshFileUrl?: string;
    mmlCharacterUrl?: string;
    mmlCharacterString?: string;
  }): void;
  setDisplayName(name: string): void;
  sendChatMessage(message: string): void;
  respawn(): void;
  on<K extends keyof ExperienceEventMap>(event: K, handler: ExperienceEventHandler<K>): void;
  off<K extends keyof ExperienceEventMap>(event: K, handler: ExperienceEventHandler<K>): void;
};

declare global {
  interface Window {
    experience?: ExperienceApi;
    SESSION_TOKEN?: string;
    CONFIG?: PageConfig;
  }
}

function createExperienceApi(app: Networked3dWebExperienceClient): ExperienceApi {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerJoinWrappers = new WeakMap<(...args: any[]) => void, (...args: any[]) => void>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerLeaveWrappers = new WeakMap<(...args: any[]) => void, (...args: any[]) => void>();

  const api: ExperienceApi = {
    getCharacterStates() {
      return app.getCharacterStates();
    },
    getLocalPlayer() {
      return app.getLocalCharacterState();
    },
    selectAvatar(avatar) {
      app.selectAvatar(avatar as any);
    },
    setDisplayName(name) {
      app.setDisplayName(name);
    },
    sendChatMessage(message) {
      app.sendChatMessage(message);
    },
    respawn() {
      app.respawn();
    },
    on(event, handler) {
      if (event === "ready") {
        app.on("ready", handler as () => void);
      } else if (event === "chat") {
        app.on("chat", handler as any);
      } else if (event === "player-join") {
        // Skip if this handler is already registered to prevent listener leaks
        if (playerJoinWrappers.has(handler)) return;
        const wrapper = (data: {
          connectionId: number;
          userId: string;
          username: string | null;
        }) => {
          (handler as ExperienceEventHandler<"player-join">)({
            connectionId: data.connectionId,
            userId: data.userId,
            username: data.username ?? "",
          });
        };
        playerJoinWrappers.set(handler, wrapper);
        app.on("userJoined", wrapper);
      } else if (event === "player-leave") {
        // Skip if this handler is already registered to prevent listener leaks
        if (playerLeaveWrappers.has(handler)) return;
        const wrapper = (data: {
          connectionId: number;
          userId: string;
          username: string | null;
        }) => {
          (handler as ExperienceEventHandler<"player-leave">)({
            connectionId: data.connectionId,
            userId: data.userId,
            username: data.username ?? "",
          });
        };
        playerLeaveWrappers.set(handler, wrapper);
        app.on("userLeft", wrapper);
      }
    },
    off(event, handler) {
      if (event === "ready") {
        app.off("ready", handler as () => void);
      } else if (event === "chat") {
        app.off("chat", handler as any);
      } else if (event === "player-join") {
        const wrapper = playerJoinWrappers.get(handler);
        if (wrapper) app.off("userJoined", wrapper as any);
      } else if (event === "player-leave") {
        const wrapper = playerLeaveWrappers.get(handler);
        if (wrapper) app.off("userLeft", wrapper as any);
      }
    },
  };

  return api;
}

function main() {
  const sessionToken = window.SESSION_TOKEN;
  if (!sessionToken) {
    throw new Error("Session token not found — the page was not served correctly");
  }

  const pageConfig = window.CONFIG ?? {};

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;

  const holder = Networked3dWebExperienceClient.createFullscreenHolder();

  const clientConfig: Networked3dWebExperienceClientConfig = {
    sessionToken,
    userNetworkAddress: `${protocol}//${host}/network`,
    waitForWorldConfig: true,
    animationConfig: {
      airAnimationFileUrl,
      idleAnimationFileUrl,
      jogAnimationFileUrl,
      sprintAnimationFileUrl,
      doubleJumpAnimationFileUrl,
    },
    loadingScreen: pageConfig.loadingScreen as LoadingScreenConfig | undefined,
    plugins: [new DefaultChatPlugin(), new DefaultAvatarSelectionPlugin(), new DefaultHUDPlugin()],
    // Live-reload config updates are delivered via a broadcast channel so
    // that this handler can apply normalizeDocumentProtocols. The built-in
    // world_config handler in Networked3dWebExperienceClient handles the
    // initial config on connect. Both handlers map the same fields — keep
    // them in sync.
    onServerBroadcast: (broadcast: ServerBroadcastMessage) => {
      if (broadcast.broadcastType === WORLD_CONFIG_UPDATE_BROADCAST_TYPE) {
        const parsed = parseWorldConfigPayload(JSON.stringify(broadcast.payload));
        if (parsed instanceof Error) {
          console.error("Invalid world config broadcast payload:", parsed.message);
          return;
        }

        app.updateConfig({
          enableChat: parsed.enableChat,
          mmlDocuments: normalizeDocumentProtocols(parsed.mmlDocuments, window.location.protocol),
          environmentConfiguration: parsed.environmentConfiguration as
            | EnvironmentConfiguration
            | undefined,
          spawnConfiguration: parsed.spawnConfiguration as SpawnConfiguration | undefined,
          avatarConfiguration: parsed.avatarConfiguration as
            | Networked3dWebExperienceClientConfig["avatarConfiguration"]
            | undefined,
          allowOrbitalCamera: parsed.allowOrbitalCamera,
          allowCustomDisplayName: parsed.allowCustomDisplayName,
          enableTweakPane: parsed.enableTweakPane,
          postProcessingEnabled: parsed.postProcessingEnabled,
          hud: parsed.hud,
        });
      }
    },
  };

  const app = new Networked3dWebExperienceClient(holder, clientConfig);

  // Expose public API for injected scripts
  window.experience = createExperienceApi(app);
  app.update();
  window.dispatchEvent(new CustomEvent("experience:ready"));
}

main();
