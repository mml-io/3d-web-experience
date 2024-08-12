import { Networked3dWebExperienceClient } from "@mml-io/3d-web-experience-client";

import hdrJpgUrl from "../../../assets/hdr/sunset_2k.jpg";
import airAnimationFileUrl from "../../../assets/models/anim_air.glb";
import doubleJumpAnimationFileUrl from "../../../assets/models/anim_double_jump.glb";
import idleAnimationFileUrl from "../../../assets/models/anim_idle.glb";
import jogAnimationFileUrl from "../../../assets/models/anim_jog.glb";
import sprintAnimationFileUrl from "../../../assets/models/anim_run.glb";

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
  skyboxHdrJpgUrl: hdrJpgUrl,
  mmlDocuments: [{ url: `${protocol}//${host}/mml-documents/guided-tour.html` }],
  environmentConfiguration: {
    groundPlane: false,
  },
  avatarConfiguration: {
    availableAvatars: [
      {
        name: "Bot",
        meshFileUrl: "/assets/models/bot.glb",
        thumbnailUrl: "/assets/models/thumbs/bot.jpg",
      },
      {
        name: "Hat Bot",
        mmlCharacterString: `
          <m-character src="/assets/models/bot.glb">
            <m-model rz="-90" sx="1.01" sy="1.01" sz="1.01" x="0.025" z="-0.01" socket="head" src="/assets/models/hat.glb"></m-model>
          </m-character>
        `,
        thumbnailUrl: "/assets/models/thumbs/hat_bot.jpg",
      },
      {
        name: "Ninja",
        meshFileUrl: "/assets/models/ninja.glb",
        thumbnailUrl: "/assets/models/thumbs/ninja.jpg",
      },
      {
        name: "Toon Boy",
        meshFileUrl: "/assets/models/cartoon_boy.glb",
        thumbnailUrl: "/assets/models/thumbs/cartoon_boy.jpg",
      },
    ],
  },
});

app.update();
