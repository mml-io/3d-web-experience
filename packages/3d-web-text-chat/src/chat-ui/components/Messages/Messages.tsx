import { FC, useEffect, useRef } from "react";

import { StringToHslOptions } from "../../TextChatUI";
import Message from "../Message/Message";

import styles from "./Messages.module.css";

type MessagesProps = {
  messages: Array<{ username: string; message: string }>;
  stringToHslOptions?: StringToHslOptions;
};

export const Messages: FC<MessagesProps> = ({ messages, stringToHslOptions }) => {
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  return (
    <div className={styles.messagesContainer}>
      {" "}
      {messages.map((msg, index) => (
        <Message
          key={index}
          username={msg.username}
          message={msg.message}
          stringToHslOptions={stringToHslOptions}
        />
      ))}
      <div ref={messagesEndRef}></div>
    </div>
  );
};
