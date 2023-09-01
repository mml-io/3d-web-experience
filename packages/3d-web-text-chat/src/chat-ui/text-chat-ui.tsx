import {
  createRef,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { createRoot, Root } from "react-dom/client";

import ChatIcon from "./chat.svg";
import InputBox from "./input-box";
import Messages from "./messages";
import PinButton from "./pin.svg";
import styles from "./text-chat-ui.module.css";

const MAX_MESSAGES = 50;
const SECONDS_TO_FADE_OUT = 6;

type ChatUIInstance = {
  addMessage: (username: string, message: string) => void;
};

type ChatUIProps = {
  clientName: string;
  sendMessageToServer: (clientname: string, message: string) => void;
};

const ChatUIComponent: React.ForwardRefRenderFunction<ChatUIInstance, ChatUIProps> = (
  props,
  ref,
) => {
  const [messages, setMessages] = useState<Array<{ username: string; message: string }>>([]);

  const [isVisible, setIsVisible] = useState(false);
  const [isSticky, setSticky] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const [panelStyle, setPanelStyle] = useState(styles.fadeOut);
  const [stickyStyle, setStickyStyle] = useState(styles.stickyButton);

  const chatPanelRef = useRef<HTMLDivElement>(null);
  const stickyButtonRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputBoxRef = useRef<{ focusInput: () => void } | null>(null);

  const startHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => {
      if (isVisible) setIsVisible(false);
    }, SECONDS_TO_FADE_OUT * 1000);
  }, [isVisible]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        if (!isVisible) setIsVisible(true);
        setIsFocused(true);
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        if (inputBoxRef.current) inputBoxRef.current.focusInput();
      }
    },
    [isVisible],
  );

  const handleBlur = useCallback(() => {
    if (isFocused) setIsFocused(false);
    startHideTimeout();
    if (closeButtonRef.current) closeButtonRef.current.focus();
  }, [isFocused, startHideTimeout]);

  const hide = () => {
    setIsVisible(false);
    setIsFocused(false);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
  };

  const handleStickyButton = () => {
    setSticky(!isSticky);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
  };

  const handleMouseLeave = () => {
    if (!isFocused && !isSticky && isVisible) {
      startHideTimeout();
    }
  };

  useEffect(() => {
    setPanelStyle(isVisible || isFocused || isSticky ? styles.fadeIn : styles.fadeOut);
    setStickyStyle(isSticky ? styles.stickyButtonEnabled : styles.stickyButton);
    if (chatPanelRef.current && chatPanelRef.current.style.zIndex !== "100") {
      // we just want to change the z-index after the browser has the chance
      // to apply the CSS to the SVG icons
      setTimeout(() => {
        if (chatPanelRef.current) chatPanelRef.current.style.zIndex = "100";
      }, 2000);
    }
  }, [isVisible, isSticky, isFocused]);

  const appendMessages = (username: string, message: string) => {
    setMessages((prev) => {
      const newMessages = [...prev, { username, message }];
      return newMessages.length > MAX_MESSAGES ? newMessages.slice(-MAX_MESSAGES) : newMessages;
    });
  };

  useImperativeHandle(ref, () => ({
    addMessage: (username: string, message: string) => {
      appendMessages(username, message);
      if (!isVisible) setIsVisible(true);
      startHideTimeout();
    },
  }));

  const handleSendMessage = (message: string) => {
    props.sendMessageToServer(props.clientName, message);
    appendMessages(props.clientName, message);
  };

  const setFocus = () => setIsFocused(true);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown, false);
    window.addEventListener("blur", handleBlur, false);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, false);
      window.removeEventListener("blur", handleBlur, false);
    };
  }, [handleBlur, handleKeyDown]);

  return (
    <div
      ref={chatPanelRef}
      style={{ position: "fixed", zIndex: -1 }}
      id="text-chat-wrapper"
      className={`${styles.textChat} ${panelStyle}`}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
    >
      <div className={styles.controls}>
        <div
          className={styles.openTab}
          onMouseEnter={() => {
            if (!isVisible) setIsVisible(true);
          }}
          onClick={hide}
        >
          <ChatIcon />
        </div>
        <div ref={stickyButtonRef} className={stickyStyle} onClick={handleStickyButton}>
          <PinButton />
        </div>
        <div
          ref={closeButtonRef}
          className={styles.closeButton}
          onClick={() => {
            if (isSticky) setSticky(false);
            hide();
          }}
        >
          X
        </div>
      </div>
      <Messages messages={messages} />
      <InputBox
        ref={inputBoxRef}
        onSendMessage={handleSendMessage}
        hide={hide}
        setFocus={setFocus}
      />
    </div>
  );
};

const ForwardedChatUIComponent = forwardRef(ChatUIComponent);

export class TextChatUI {
  private root: Root;
  private appRef: React.RefObject<ChatUIInstance> = createRef<ChatUIInstance>();

  public addTextMessage(username: string, message: string) {
    if (this.appRef.current) this.appRef.current.addMessage(username, message);
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  private container = document.getElementById("text-chat-ui")!;

  constructor(
    private clientname: string,
    private sendMessageToServerMethod: (clientname: string, message: string) => void,
  ) {
    this.root = createRoot(this.container);
    this.sendMessageToServerMethod = sendMessageToServerMethod;
  }

  init() {
    flushSync(() =>
      this.root.render(
        <ForwardedChatUIComponent
          ref={this.appRef}
          clientName={this.clientname}
          sendMessageToServer={this.sendMessageToServerMethod}
        />,
      ),
    );
  }
}
