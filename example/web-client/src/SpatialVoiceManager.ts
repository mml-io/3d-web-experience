import { CharacterState } from "@mml-io/3d-web-client-core/src";
import VoxeetSDK from "@voxeet/voxeet-web-sdk";
import type { SpatialAudioStyle } from "@voxeet/voxeet-web-sdk/types/models/SpatialAudio";

export class SpatialVoiceManager {
  private disposed = false;
  private pending = false;
  private hasJoinedAudio = false;
  private joinButton: HTMLButtonElement | null = null;
  private statusElement: HTMLDivElement | null = null;
  private conferenceAlias: string;
  private tickInterval: NodeJS.Timer | null = null;

  constructor(
    private userId: number,
    private remoteUserStates: Map<number, CharacterState>,
    private latestCharacterObj: {
      characterState: null | CharacterState;
    },
  ) {
    this.conferenceAlias = window.location.host;
    this.init();

    this.tickInterval = setInterval(() => {
      this.tick();
    }, 1000);
  }

  private tick() {
    if (!this.hasJoinedAudio) {
      return;
    }
    if (VoxeetSDK.conference.participants.size > 0) {
      this.statusElement!.textContent = `Connected. Participants: ${VoxeetSDK.conference.participants.size}`;
      this.statusElement!.style.backgroundColor = "green";

      for (const [, participant] of VoxeetSDK.conference.participants) {
        const parsed = parseInt(participant.info.name!, 10);
        console.log("parsed", parsed, "userId", this.userId);
        if (!parsed) {
          break;
        }
        if (parsed === this.userId) {
          if (this.latestCharacterObj.characterState) {
            const { position, rotation } = this.latestCharacterObj.characterState;
            console.log("Setting own position", parsed, position, rotation);
            VoxeetSDK.conference.setSpatialPosition(participant, position);
            // VoxeetSDK.conference.setSpatialDirection(participant, {
            //   x: rotation.x * (180 / Math.PI),
            //   y: rotation.y * (180 / Math.PI),
            //   z: rotation.z * (180 / Math.PI),
            // });
          }
        } else {
          const remoteUserState = this.remoteUserStates.get(parsed);
          if (remoteUserState) {
            const { position, rotation } = remoteUserState;
            console.log("Setting position", parsed, position, rotation);
            VoxeetSDK.conference.setSpatialPosition(participant, position);
            // VoxeetSDK.conference.setSpatialDirection(participant, {
            //   x: rotation.x * (180 / Math.PI),
            //   y: rotation.y * (180 / Math.PI),
            //   z: rotation.z * (180 / Math.PI),
            // });
          } else {
            console.log("No remote user state found for", parsed);
          }
        }
      }
    } else {
      this.statusElement!.textContent = "Not connected";
      this.statusElement!.style.backgroundColor = "black";
    }
  }

  private createElements() {
    const joinButton = document.createElement("button");
    joinButton.innerText = "Join Audio";
    joinButton.style.position = "fixed";
    joinButton.style.top = "0";
    joinButton.style.left = "0";
    joinButton.style.zIndex = "100";
    joinButton.style.width = "100px";
    joinButton.style.height = "100px";
    joinButton.style.backgroundColor = "gray";
    joinButton.style.color = "white";
    joinButton.style.fontSize = "20px";
    document.body.append(joinButton);
    this.joinButton = joinButton;

    joinButton.addEventListener("click", () => {
      this.joinClick();
    });

    const statusElement = document.createElement("div");
    statusElement.style.position = "fixed";
    statusElement.textContent = "Not connected";
    statusElement.style.top = "0";
    statusElement.style.left = "100px";
    statusElement.style.zIndex = "100";
    statusElement.style.padding = "20px";
    statusElement.style.backgroundColor = "black";
    statusElement.style.color = "white";
    statusElement.style.fontSize = "20px";
    document.body.append(statusElement);
    this.statusElement = statusElement;
  }

  private async init() {
    const accessToken = await fetch(`/voice-token/${this.userId.toString(10)}`)
      .then((res) => res.json())
      .then((res) => res.accessToken as string)
      .catch((err) => {
        console.error(err);
        return null;
      });
    if (!accessToken) {
      return;
    }
    VoxeetSDK.initializeToken(accessToken, (isExpired: boolean) => {
      return new Promise((resolve, reject) => {
        if (isExpired) {
          reject("The access token has expired.");
        } else {
          resolve(accessToken);
        }
      });
    });

    try {
      // Open the session
      await VoxeetSDK.session.open({ name: this.userId.toString(10) });
    } catch (e) {
      alert("Something went wrong : " + e);
    }

    this.createElements();
  }

  public dispose() {
    if (this.disposed) {
      return;
    }
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.leaveConference();
    if (VoxeetSDK.session.isOpen()) {
      VoxeetSDK.session.close();
    }
    if (this.joinButton) {
      this.joinButton.remove();
      this.joinButton = null;
    }
    if (this.statusElement) {
      this.statusElement.remove();
      this.statusElement = null;
    }
    this.disposed = true;
  }

  private leaveConference(): Promise<void> {
    return VoxeetSDK.conference
      .leave()
      .then(() => {
        this.joinButton!.textContent = "Join Audio";
        this.joinButton!.style.backgroundColor = "gray";
        this.hasJoinedAudio = false;
        this.statusElement!.textContent = `Not connected`;
        this.statusElement!.style.backgroundColor = "black";
        this.pending = false;
      })
      .catch((err) => console.error(err));
  }

  private joinConference() {
    VoxeetSDK.conference
      .create({
        alias: this.conferenceAlias,
        params: {
          audioOnly: true,
          dolbyVoice: true,
          liveRecording: true,
          spatialAudioStyle: "individual" as SpatialAudioStyle,
          stats: true,
          ttl: 0,
          videoCodec: "H264",
        },
      })
      // Join the conference using its ID received in the returned conference object
      .then((conference) =>
        VoxeetSDK.conference.join(conference, {
          constraints: {
            audio: true,
            video: false,
          },
          spatialAudio: true,
          // dvwc: true,
        }),
      )
      .then(() => {
        const scale = { x: 1, y: 1, z: 1 };
        const forward = { x: 0, y: -1, z: 0 };
        const up = { x: 0, y: 0, z: 1 };
        const right = { x: 1, y: 0, z: 0 };
        console.log("Setting spatial environment", scale, forward, up, right);
        VoxeetSDK.conference.setSpatialEnvironment(scale, forward, up, right);

        this.joinButton!.textContent = "Leave Audio";
        this.joinButton!.style.backgroundColor = "red";
        this.hasJoinedAudio = true;
        this.pending = false;
      })
      .catch((err) => console.error(err));
  }

  private joinClick() {
    if (this.pending) {
      return;
    }
    this.pending = true;
    // Create a conference room using an alias
    if (this.hasJoinedAudio) {
      this.leaveConference();
    } else {
      this.joinConference();
    }
  }
}
