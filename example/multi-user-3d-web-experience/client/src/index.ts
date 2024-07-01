import { Networked3dWebExperienceClient } from "@mml-io/3d-web-experience-client";

import hdrJpgUrl from "../../../assets/hdr/puresky_2k.jpg";
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
  mmlDocuments: [{ url: `${protocol}//${host}/mml-documents/example-mml.html` }],
  environmentConfiguration: {},
  avatarConfig: {
    availableAvatars: [
      {
        thumbnailUrl:"https://e7.pngegg.com/pngimages/799/987/png-clipart-computer-icons-avatar-icon-design-avatar-heroes-computer-wallpaper-thumbnail.png",
        mmlCharacterUrl: "https://mmlstorage.com/eYIAFx/1706889930376.html",
        name: "Avatar 1ahlishdflkjhaskjdfhlakj;shdfijlkhakjsdhfghjkabhsdyhuifbglakjhsdbfkjhabnsdkjfhnbsakjdhnbfjkws",
        isDefaultAvatar: false,
      },
      {
        thumbnailUrl: "https://models.readyplayer.me/65a8dba831b23abb4f401bae.png",
        meshFileUrl: "https://models.readyplayer.me/65a8dba831b23abb4f401bae.glb",
        name: "Avatar 2",
        isDefaultAvatar: true,
      },
      {
        thumbnailUrl: "https://static.vecteezy.com/system/resources/previews/019/896/008/original/male-user-avatar-icon-in-flat-design-style-person-signs-illustration-png.png",
        mmlCharacterString: "<m-character src=\"https://mmlstorage.com/fca2e81688f8c26b1671b701e399f0a5c9756307607d78c11739293d2e530e78\">\n" +
          "</m-character>",
        name: "Avatar 3",
        isDefaultAvatar: false,
      },
      {
        thumbnailUrl:"https://e7.pngegg.com/pngimages/799/987/png-clipart-computer-icons-avatar-icon-design-avatar-heroes-computer-wallpaper-thumbnail.png",
        mmlCharacterUrl: "https://mmlstorage.com/eYIAFx/1706889930376.html",
        name: "Avatar 1",
        isDefaultAvatar: false,
      },
      {
        thumbnailUrl: "https://models.readyplayer.me/65a8dba831b23abb4f401bae.png",
        meshFileUrl: "https://models.readyplayer.me/65a8dba831b23abb4f401bae.glb",
        name: "Avatar 2",
        isDefaultAvatar: true,
      },
      {
        thumbnailUrl: "https://static.vecteezy.com/system/resources/previews/019/896/008/original/male-user-avatar-icon-in-flat-design-style-person-signs-illustration-png.png",
        mmlCharacterString: "<m-character src=\"https://mmlstorage.com/fca2e81688f8c26b1671b701e399f0a5c9756307607d78c11739293d2e530e78\">\n" +
          "</m-character>",
        name: "Avatar 3",
        isDefaultAvatar: false,
      },
      {
        thumbnailUrl:"https://e7.pngegg.com/pngimages/799/987/png-clipart-computer-icons-avatar-icon-design-avatar-heroes-computer-wallpaper-thumbnail.png",
        mmlCharacterUrl: "https://mmlstorage.com/eYIAFx/1706889930376.html",
        name: "Avatar 1",
        isDefaultAvatar: false,
      },
      {
        thumbnailUrl: "https://models.readyplayer.me/65a8dba831b23abb4f401bae.png",
        meshFileUrl: "https://models.readyplayer.me/65a8dba831b23abb4f401bae.glb",
        name: "Avatar 2",
        isDefaultAvatar: true,
      },
      {
        thumbnailUrl: "https://static.vecteezy.com/system/resources/previews/019/896/008/original/male-user-avatar-icon-in-flat-design-style-person-signs-illustration-png.png",
        mmlCharacterString: "<m-character src=\"https://mmlstorage.com/fca2e81688f8c26b1671b701e399f0a5c9756307607d78c11739293d2e530e78\">\n" +
          "</m-character>",
        name: "Avatar 3",
        isDefaultAvatar: false,
      },
      {
        thumbnailUrl:"https://e7.pngegg.com/pngimages/799/987/png-clipart-computer-icons-avatar-icon-design-avatar-heroes-computer-wallpaper-thumbnail.png",
        mmlCharacterUrl: "https://mmlstorage.com/eYIAFx/1706889930376.html",
        name: "Avatar 1",
        isDefaultAvatar: false,
      },
      {
        thumbnailUrl: "https://models.readyplayer.me/65a8dba831b23abb4f401bae.png",
        meshFileUrl: "https://models.readyplayer.me/65a8dba831b23abb4f401bae.glb",
        name: "Avatar 2",
        isDefaultAvatar: true,
      },
      {
        thumbnailUrl: "https://static.vecteezy.com/system/resources/previews/019/896/008/original/male-user-avatar-icon-in-flat-design-style-person-signs-illustration-png.png",
        mmlCharacterString: "<m-character src=\"https://mmlstorage.com/fca2e81688f8c26b1671b701e399f0a5c9756307607d78c11739293d2e530e78\">\n" +
          "</m-character>",
        name: "Avatar 3",
        isDefaultAvatar: false,
      },
      {
        thumbnailUrl:"https://e7.pngegg.com/pngimages/799/987/png-clipart-computer-icons-avatar-icon-design-avatar-heroes-computer-wallpaper-thumbnail.png",
        mmlCharacterUrl: "https://mmlstorage.com/eYIAFx/1706889930376.html",
        name: "Avatar 1",
        isDefaultAvatar: false,
      },
      {
        thumbnailUrl: "https://models.readyplayer.me/65a8dba831b23abb4f401bae.png",
        meshFileUrl: "https://models.readyplayer.me/65a8dba831b23abb4f401bae.glb",
        name: "Avatar 2",
        isDefaultAvatar: true,
      },
      {
        thumbnailUrl: "https://static.vecteezy.com/system/resources/previews/019/896/008/original/male-user-avatar-icon-in-flat-design-style-person-signs-illustration-png.png",
        mmlCharacterString: "<m-character src=\"https://mmlstorage.com/fca2e81688f8c26b1671b701e399f0a5c9756307607d78c11739293d2e530e78\">\n" +
          "</m-character>",
        name: "Avatar 3",
        isDefaultAvatar: false,
      },
    ],
    // allowCustomAvatars: true,
  }
});

app.update();
