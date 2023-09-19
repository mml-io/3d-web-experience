import { CharacterState } from "@mml-io/3d-web-client-core/src";
import VoxeetSDK from "@voxeet/voxeet-web-sdk";
import Conference from "@voxeet/voxeet-web-sdk/types/models/Conference";
import type { SpatialAudioStyle } from "@voxeet/voxeet-web-sdk/types/models/SpatialAudio";

import { VoiceChatUI } from "../chat-ui/components/voice-chat-ui";

import { getEulerFromQuaternion, formatPos, formatDirection } from "./helpers";

export type Quaternion = { w: number; x: number; y: number; z: number };

export type Euler = { pitch: number; yaw: number; roll: number };

export type Position = { x: number; y: number; z: number };

export type Rotation = { quaternionY: number; quaternionW: number };

type Direction = { x: number; y: number; z: number };

type Vector3 = {
  x: number;
  y: number;
  z: number;
};

type ConferenceSettings = {
  scale: Vector3;
  forward: Vector3;
  up: Vector3;
  right: Vector3;
};

export enum SessionStatus {
  Connecting = "connecting",
  Connected = "connected",
  Unavailable = "unavailable",
}

export class VoiceChatManager {
  private debug = false;

  private disposed = false;
  private pending = false;
  private hasJoinedAudio = false;
  private speaking = false;

  private conferenceAlias: string;
  private participants = new Map<string, string>();
  private activeSpeakers: number = 0;

  private voiceChatUI: VoiceChatUI;

  private conference: Conference | null = null;

  private settings: ConferenceSettings = {
    scale: { x: 2, y: 2, z: 2 },
    forward: { x: 0, y: -1, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    right: { x: -1, y: 0, z: 0 },
  };

  private tickInterval: NodeJS.Timeout | null = null;

  constructor(
    private userId: number,
    private remoteUserStates: Map<number, CharacterState>,
    private latestCharacterObj: {
      characterState: null | CharacterState;
    },
  ) {
    this.conferenceAlias = window.location.host;
    this.voiceChatUI = new VoiceChatUI(this.handleJoinClick.bind(this));
    this.voiceChatUI.render();

    this.init();
    this.tickInterval = setInterval(() => this.tick(), 1000);
  }

  private tick() {
    if (!this.hasJoinedAudio) return;
    if (VoxeetSDK.conference.participants.size > 0) {
      let activeSpeakers = 0;
      for (const [, participant] of VoxeetSDK.conference.participants) {
        const parsed = parseInt(participant.info.name!, 10);
        if (this.debug === true) {
          console.log("parsed", parsed, "userId", this.userId);
        }
        if (!parsed) break;
        if (participant.status === "Connected" && participant.audioTransmitting === true) {
          activeSpeakers++;
        }
        if (parsed === this.userId) {
          if (this.latestCharacterObj.characterState) {
            const { position, rotation } = this.latestCharacterObj.characterState;
            const eulerRot = getEulerFromQuaternion(rotation);
            const direction: Direction = { x: eulerRot.pitch, y: eulerRot.yaw, z: eulerRot.roll };
            if (this.debug === true) {
              console.log(`ID ${parsed}: ${formatPos(position)}`);
              console.log(`ID ${parsed}: ${formatDirection(eulerRot)}`);
            }
            VoxeetSDK.conference.setSpatialPosition(participant, position);
            VoxeetSDK.conference.setSpatialDirection(participant, direction);
          }
        } else {
          const remoteUserState = this.remoteUserStates.get(parsed);
          if (remoteUserState) {
            const { position, rotation } = remoteUserState;
            if (this.debug === true) {
              console.log(`ID ${parsed}: ${formatPos(position)}`);
            }
            VoxeetSDK.conference.setSpatialPosition(participant, position);
          } else {
            if (this.debug === true) {
              console.log("No remote user state found for", parsed);
            }
            VoxeetSDK.conference.kick(participant);
          }
        }
      }
      this.activeSpeakers = activeSpeakers;
      this.voiceChatUI.setActiveSpeakers(this.activeSpeakers);
    } else {
      this.voiceChatUI.setActiveSpeakers(0);
    }
  }

  private async init() {
    try {
      this.voiceChatUI.setStatus(SessionStatus.Connecting);
      const accessToken = await fetch(`/voice-token/${this.userId.toString(10)}`)
        .then((res) => res.json())
        .then((res) => res.accessToken as string)
        .catch((err) => {
          console.error(err);
          this.voiceChatUI.setStatus(SessionStatus.Unavailable);
        });
      if (!accessToken) {
        this.voiceChatUI.setStatus(SessionStatus.Unavailable);
        return;
      }
      VoxeetSDK.initializeToken(accessToken, (isExpired: boolean) => {
        return new Promise((resolve, reject) => {
          if (isExpired) {
            this.voiceChatUI.setStatus(SessionStatus.Unavailable);
            reject("The access token has expired.");
          } else {
            resolve(accessToken);
          }
        });
      });
      // Open the session
      await VoxeetSDK.session.open({ name: this.userId.toString(10) });
      this.createAndJoinConference();
      // this.conference = await this.createConference();
    } catch (err) {
      alert("Something went wrong : " + err);
    }
  }

  public dispose() {
    if (this.disposed) return;

    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.leaveConference();
    if (VoxeetSDK.session.isOpen()) {
      VoxeetSDK.session.close();
    }
    this.disposed = true;
  }

  private async leaveConference(): Promise<void> {
    try {
      await VoxeetSDK.conference.leave({
        reason: "leave",
        leaveRoom: true,
        keepAlive: false,
      });
      this.hasJoinedAudio = false;
      this.pending = false;
    } catch (err) {
      return console.error(err);
    }
  }

  private async createConference(): Promise<Conference | null> {
    try {
      return await VoxeetSDK.conference.create({
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
      });
    } catch (err) {
      console.error(`Failed to create the conference: ${err}`);
      return null;
    }
  }

  private async createAndJoinConference(): Promise<void> {
    try {
      this.conference = await this.createConference();
      if (this.conference) {
        await VoxeetSDK.conference.join(this.conference, {
          constraints: {
            audio: false,
            video: false,
          },
          spatialAudio: true,
          dvwc: false,
        });

        VoxeetSDK.conference.setSpatialEnvironment(
          this.settings.scale,
          this.settings.forward,
          this.settings.up,
          this.settings.right,
        );

        VoxeetSDK.conference.on("participantUpdated", (participant) => {
          if (participant.status === "Connected") {
            if (!this.participants.has(participant.id)) {
              this.participants.set(participant.id, participant.info.externalId);
            }
          } else if (participant.status === "Left") {
            if (this.participants.has(participant.id)) {
              this.participants.delete(participant.id);
            }
          }
        });

        this.hasJoinedAudio = true;
        this.pending = false;
        console.log("connected");
        this.voiceChatUI.setStatus(SessionStatus.Connected);
      }
    } catch (err) {
      /* TODO:
      write the logic for err === "ServerError: Expired or invalid token"
      to re-fetch a valid token. Alternatively, only fetch and initialize
      the accessToken when the user really intends to join the voice chat
       */
      try {
        if (
          err.data.type === "ErrorResponse" &&
          err.data.error_code === 100 &&
          err.data.error_reason === "conference_not_found"
        ) {
          this.conference = await this.createConference();
          if (this.conference) {
            this.createAndJoinConference();
          }
        }
      } catch (error) {
        console.error(`Error! Failed re-creating conference: ${error}`);
        console.error(JSON.stringify(error));
      }

      console.error(`Error! Failed joining conference: ${err}`);
      console.error(JSON.stringify(err));
    }
  }

  private async handleJoinClick() {
    if (this.pending) return;
    this.pending = true;

    if (this.hasJoinedAudio && this.speaking) {
      await VoxeetSDK.audio.local.stop();
      this.speaking = false;
      this.pending = false;
      this.voiceChatUI.setSpeaking(false);
    } else if (this.hasJoinedAudio && !this.speaking) {
      await VoxeetSDK.audio.local.start();
      this.speaking = true;
      this.pending = false;
      this.voiceChatUI.setSpeaking(true);
    }
  }
}
