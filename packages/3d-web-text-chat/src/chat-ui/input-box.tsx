import { forwardRef, KeyboardEvent, useImperativeHandle, useRef, useState } from "react";

import styles from "./input-box.module.css";
import SendButton from "./paper-plane-solid.svg";

type InputBoxProps = {
  onSendMessage: (message: string) => void;
  hide: () => void;
  setFocus: () => void;
};

const InputBox = forwardRef<{ focusInput: () => void } | null, InputBoxProps>(
  ({ onSendMessage, hide, setFocus }, ref) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [inputValue, setInputValue] = useState("");

    useImperativeHandle(ref, () => ({
      focusInput: () => {
        if (inputRef.current) inputRef.current.focus();
      },
    }));

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value);
    };

    const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        if (inputRef.current?.value.trim().length === 0) {
          if (buttonRef.current) buttonRef.current.focus();
          hide();
          return;
        }
        handleSendClick();
      }
    };

    const handleSendClick = () => {
      if (inputValue.trim() !== "") {
        onSendMessage(inputValue.trim());
        setInputValue("");
      }
    };

    return (
      <div className={styles.inputWrapper}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Type your message here..."
          value={inputValue}
          onChange={handleInputChange}
          className={styles.chatInput}
          onKeyDown={handleKeyPress}
          onFocus={setFocus}
        />
        <button ref={buttonRef} onClick={handleSendClick} className={styles.sendButton}>
          <div className={styles.svgIcon}>
            <SendButton />
          </div>
        </button>
      </div>
    );
  },
);
InputBox.displayName = "InputBox";

export default InputBox;
