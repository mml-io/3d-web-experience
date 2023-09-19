import { useRef, useState, MouseEvent } from "react";
import { flushSync } from "react-dom";
import { createRoot, Root } from "react-dom/client";

import { SessionStatus } from "../../voice-chat-manager/VoiceChatManager";
import HeadSet from "../icons/Headset.svg";
import HourGlass from "../icons/Hourglass.svg";
import MicrophoneOff from "../icons/MicrophoneOff.svg";
import MicrophoneOn from "../icons/MicrophoneOn.svg";

import styles from "./voice-chat-ui.module.css";

type VoiceChatUIComponentProps = {
  activeSpeakers: number;
  speaking: boolean;
  status: SessionStatus;
  handleJoinClick: () => void;
};

const VoiceChatUIComponent = (props: VoiceChatUIComponentProps) => {
  const { activeSpeakers, speaking, status, handleJoinClick } = props;
  const joinVoiceChatRef = useRef<HTMLDivElement>(null);
  const voiceParticipantsRef = useRef<HTMLDivElement>(null);
  const [micHovered, setMicHovered] = useState(false);

  const handleMicClick = (e: MouseEvent) => {
    e.stopPropagation();
    handleJoinClick();
  };

  const renderIcon = () => {
    if (status === SessionStatus.Connecting) {
      return <img src={`data:image/svg+xml;utf8,${encodeURIComponent(HourGlass)}`} />;
    } else if (status === SessionStatus.Connected && speaking === false) {
      return <img src={`data:image/svg+xml;utf8,${encodeURIComponent(MicrophoneOn)}`} />;
    } else if (status === SessionStatus.Connected && speaking === true) {
      return <img src={`data:image/svg+xml;utf8,${encodeURIComponent(MicrophoneOff)}`} />;
    } else {
      return <img src={`data:image/svg+xml;utf8,${encodeURIComponent(HeadSet)}`} />;
    }
  };

  const getStatusString = (): string => {
    if (status === SessionStatus.Disconnected) {
      return "voice chat";
    }
    if (status === SessionStatus.Unavailable) {
      return "disabled";
    }
    if (status === SessionStatus.Connected) {
      return speaking ? "mute" : "unmute";
    }
    return "loading";
  };

  return (
    <div className={styles.voiceChat}>
      <div
        ref={joinVoiceChatRef}
        className={
          status === SessionStatus.Unavailable
            ? styles.unavailable
            : speaking
            ? styles.speaking
            : styles.connected
        }
        onClick={handleMicClick}
        onMouseEnter={() => setMicHovered(true)}
        onMouseLeave={() => setMicHovered(false)}
      >
        <span
          className={micHovered ? `${styles.tooltip} ${styles.tooltipVisible}` : styles.tooltip}
        >
          {getStatusString()}
        </span>
        {renderIcon()}
      </div>
      <div
        ref={voiceParticipantsRef}
        className={activeSpeakers > 0 ? styles.voiceParticipantsVisible : styles.voiceParticipants}
      >
        {activeSpeakers > 0 && activeSpeakers}
      </div>
    </div>
  );
};

export class VoiceChatUI {
  private root: Root;
  private container = document.getElementById("voice-chat-ui")!;

  private activeSpeakers: number = 0;
  private speaking: boolean = false;
  private status: SessionStatus = SessionStatus.Disconnected;

  constructor(private handleClickMic: () => void) {
    this.root = createRoot(this.container);
  }

  public setActiveSpeakers(activeSpeakers: number): void {
    if (this.activeSpeakers !== activeSpeakers) {
      this.activeSpeakers = activeSpeakers;
      this.render();
    }
  }

  public setSpeaking(speaking: boolean): void {
    if (this.speaking !== speaking) {
      this.speaking = speaking;
      this.render();
    }
  }

  public setStatus(status: SessionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.render();
    }
  }

  public render(): void {
    flushSync(() =>
      this.root.render(
        <VoiceChatUIComponent
          handleJoinClick={this.handleClickMic}
          activeSpeakers={this.activeSpeakers}
          speaking={this.speaking}
          status={this.status}
        />,
      ),
    );
  }
}
