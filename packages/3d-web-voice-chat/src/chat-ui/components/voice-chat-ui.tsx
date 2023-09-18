import { createRef, forwardRef, useEffect, useRef, useState, MouseEvent } from "react";
import { flushSync } from "react-dom";
import { createRoot, Root } from "react-dom/client";

import HourGlass from "../icons/Hourglass.svg";
import MicrophoneOff from "../icons/MicrophoneOff.svg";
import MicrophoneOn from "../icons/MicrophoneOn.svg";

import styles from "./voice-chat-ui.module.css";

type ChatUIInstance = {
  addMessage: (username: string, message: string) => void;
};

type ChatUIProps = {
  clientName: string;
  sendMessageToServer: (message: string) => void;
};

const VoiceChatUIComponent: React.ForwardRefRenderFunction<ChatUIInstance, ChatUIProps> = (
  props: ChatUIProps,
  ref,
) => {
  const joinVoiceChatRef = useRef<HTMLDivElement>(null);
  const voiceParticipantsRef = useRef<HTMLDivElement>(null);
  const [participantsStyle, setParticipantsStyle] = useState(styles.voiceParticipants);
  const micOn = `<img src="data:image/svg+xml;utf8,${encodeURIComponent(MicrophoneOn)}" />`;
  const micOff = `<img src="data:image/svg+xml;utf8,${encodeURIComponent(MicrophoneOff)}" />`;
  const hourGlass = `<img src="data:image/svg+xml;utf8,${encodeURIComponent(HourGlass)}" />`;

  const joining = useRef<boolean>(false);

  useEffect(() => {
    const targetNode = voiceParticipantsRef.current;
    if (targetNode) {
      const observerOptions = { childList: true, subtree: true, characterData: true };
      const callback = (mutationsList: MutationRecord[], observer: MutationObserver) => {
        for (const mutation of mutationsList) {
          if (mutation.type === "characterData" || mutation.type === "childList") {
            if (joinVoiceChatRef.current) {
              const participants = parseInt(targetNode.innerText);
              if (!isNaN(participants)) {
                setParticipantsStyle(
                  participants > 0 ? styles.voiceParticipantsVisible : styles.voiceParticipants,
                );
              } else {
                setParticipantsStyle(styles.voiceParticipants);
              }
            }
          }
        }
      };

      const observer = new MutationObserver(callback);
      observer.observe(targetNode, observerOptions);
      return () => observer.disconnect();
    }
  }, [voiceParticipantsRef]);

  const handleJoinClick = (e: MouseEvent) => {
    if (joinVoiceChatRef.current) {
      joinVoiceChatRef.current.innerHTML = hourGlass;
    }
  };

  return (
    <div id="voice-chat-wrapper" className={styles.voiceChat}>
      <div
        id="voice-join-button"
        ref={joinVoiceChatRef}
        className={styles.joinVoiceChat}
        onClick={handleJoinClick}
      >
        <img src={`data:image/svg+xml;utf8,${encodeURIComponent(MicrophoneOn)}`} />
      </div>
      <div
        ref={voiceParticipantsRef}
        id="voice-participants-count"
        className={participantsStyle}
      ></div>
    </div>
  );
};

const ForwardedVoiceChatUIComponent = forwardRef(VoiceChatUIComponent);

export class VoiceChatUI {
  private root: Root;
  private appRef: React.RefObject<ChatUIInstance> = createRef<ChatUIInstance>();

  public addTextMessage(username: string, message: string) {
    if (this.appRef.current) this.appRef.current.addMessage(username, message);
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  private container = document.getElementById("voice-chat-ui")!;

  constructor(
    private clientname: string,
    private sendMessageToServerMethod: (message: string) => void,
  ) {
    this.root = createRoot(this.container);
    this.sendMessageToServerMethod = sendMessageToServerMethod;
  }

  init() {
    flushSync(() =>
      this.root.render(
        <ForwardedVoiceChatUIComponent
          ref={this.appRef}
          clientName={this.clientname}
          sendMessageToServer={this.sendMessageToServerMethod}
        />,
      ),
    );
  }
}
