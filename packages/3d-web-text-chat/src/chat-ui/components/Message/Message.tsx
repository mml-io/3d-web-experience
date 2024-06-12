import { FC, useState, useEffect, useCallback } from "react";

import styles from "./Message.module.css";

type MessageProps = {
  username: string;
  message: string;
};

const Message: FC<MessageProps> = ({ username, message }) => {
  const [userColors, setUserColors] = useState<Map<string, string>>(new Map());

  const hashStringToHue = (str: string): number => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash % 360);
  };

  const generateColorForUsername = useCallback(
    (name: string): string => {
      const numPart = name.match(/\d+$/);
      let hue;
      if (numPart) {
        hue = (parseInt(numPart[0], 10) * 137) % 360;
      } else {
        hue = hashStringToHue(username);
      }
      return `hsl(${hue}, 70%, 70%)`;
    },
    [username],
  );

  useEffect(() => {
    if (!userColors.has(username)) {
      const color = generateColorForUsername(username);
      setUserColors(new Map(userColors).set(username, color));
    }
  }, [username, userColors, generateColorForUsername]);

  const userColor = userColors.get(username) || "hsl(0, 0%, 0%)";

  return (
    <div className={styles.messageContainer}>
      <span className={styles.userName} style={{ color: userColor }}>
        {username}
      </span>
      : {message}
    </div>
  );
};

export default Message;
