import { useEffect, useRef, useState, MouseEvent } from "react";
import { flushSync } from "react-dom";
import { createRoot, Root } from "react-dom/client";

import HourGlass from "../icons/Hourglass.svg";
import MicrophoneOn from "../icons/MicrophoneOn.svg";

import styles from "./voice-chat-ui.module.css";

const VoiceChatUIComponent = () => {
  const joinVoiceChatRef = useRef<HTMLDivElement>(null);
  const voiceParticipantsRef = useRef<HTMLDivElement>(null);
  const [participantsStyle, setParticipantsStyle] = useState(styles.voiceParticipants);
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

export class VoiceChatUI {
  private root: Root;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  private container = document.getElementById("voice-chat-ui")!;

  constructor() {
    this.root = createRoot(this.container);
  }

  init() {
    flushSync(() => this.root.render(<VoiceChatUIComponent />));
  }
}
