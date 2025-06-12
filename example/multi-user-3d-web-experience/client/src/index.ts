import { Networked3dWebExperienceClient } from "@mml-io/3d-web-experience-client";

import hdrUrl from "../../../assets/hdr/puresky_2k.hdr";
import loadingBackground from "../../../assets/images/loading-bg.jpg";
import airAnimationFileUrl from "../../../assets/models/anim_air_new.glb";
import doubleJumpAnimationFileUrl from "../../../assets/models/anim_double_jump_new.glb";
import idleAnimationFileUrl from "../../../assets/models/anim_idle_new.glb";
import jogAnimationFileUrl from "../../../assets/models/anim_jog_new.glb";
import sprintAnimationFileUrl from "../../../assets/models/anim_run_new.glb";

const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const host = window.location.host;
const userNetworkAddress = `${protocol}//${host}/network`;
const chatNetworkAddress = `${protocol}//${host}/chat-network`;

const holder = Networked3dWebExperienceClient.createFullscreenHolder();
const app = new Networked3dWebExperienceClient(holder, {
  sessionToken: (window as any).SESSION_TOKEN,
  userNetworkAddress,
  chatNetworkAddress,
  animationConfig: {
    airAnimationFileUrl,
    idleAnimationFileUrl,
    jogAnimationFileUrl,
    sprintAnimationFileUrl,
    doubleJumpAnimationFileUrl,
  },
  mmlDocuments: { example: { url: `${protocol}//${host}/mml-documents/example-mml.html` } },
  environmentConfiguration: {
    skybox: {
      hdrUrl: hdrUrl,
      // hdrJpgUrl: hdrJpgUrl,
    },
  },
  avatarConfiguration: {
    availableAvatars: [
      {
        name: "Low-poly A",
        meshFileUrl: "/assets/models/low_poly_male_a.glb",
        thumbnailUrl: "/assets/models/thumbs/low_poly_male_a.jpg",
      },
      {
        name: "Low-poly B",
        meshFileUrl: "/assets/models/low_poly_male_b.glb",
        thumbnailUrl: "/assets/models/thumbs/low_poly_male_b.jpg",
      },
      {
        name: "Low-poly C",
        meshFileUrl: "/assets/models/low_poly_male_c.glb",
        thumbnailUrl: "/assets/models/thumbs/low_poly_male_c.jpg",
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
