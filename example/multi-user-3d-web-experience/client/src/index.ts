import { Networked3dWebExperienceClient } from "@mml-io/3d-web-experience-client";

import hdrJpgUrl from "../../../assets/hdr/puresky_2k.jpg";
import loadingBackground from "../../../assets/images/loading-bg.jpg";
import airAnimationFileUrl from "../../../assets/models/anim_air_new.glb";
import doubleJumpAnimationFileUrl from "../../../assets/models/anim_double_jump_new.glb";
import idleAnimationFileUrl from "../../../assets/models/anim_idle_new.glb";
import jogAnimationFileUrl from "../../../assets/models/anim_jog_new.glb";
import sprintAnimationFileUrl from "../../../assets/models/anim_run_new.glb";

const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const host = window.location.host;
const userNetworkAddress = `${protocol}//${host}/network`;

const useSkybox = false;

const holder = Networked3dWebExperienceClient.createFullscreenHolder();
const app = new Networked3dWebExperienceClient(holder, {
  sessionToken: (window as any).SESSION_TOKEN,
  userNetworkAddress,
  enableChat: true,
  animationConfig: {
    airAnimationFileUrl,
    idleAnimationFileUrl,
    jogAnimationFileUrl,
    sprintAnimationFileUrl,
    doubleJumpAnimationFileUrl,
  },
  mmlDocuments: { example: { url: `${protocol}//${host}/mml-documents/example-mml.html` } },
  environmentConfiguration: {
    skybox: useSkybox
      ? {
          hdrJpgUrl,
        }
      : undefined,
  },
  avatarConfiguration: {
    availableAvatars: [
      {
        name: "bot",
        meshFileUrl: "/assets/models/bot.glb",
      },
    ],
  },
  allowOrbitalCamera: false,
  loadingScreen: {
    background: "#424242",
    color: "#ffffff",
    backgroundImageUrl: loadingBackground,
    backgroundBlurAmount: 12,
    title: "3D Web Experience",
    subtitle: "Powered by Metaverse Markup Language",
  },
  spawnConfiguration: {
    enableRespawnButton: true,
  },
});

app.update();
