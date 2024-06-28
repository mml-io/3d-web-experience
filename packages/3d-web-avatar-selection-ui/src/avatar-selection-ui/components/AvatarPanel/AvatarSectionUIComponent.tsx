import { Avatar } from "@mml-io/3d-web-experience-client";
import React, {
  KeyboardEvent,
  useRef,
  useState,
  ForwardRefRenderFunction,
  MouseEvent,
} from "react";

import { CustomAvatar } from "../../AvatarSelectionUI";
import AvatarIcon from "../../icons/Avatar.svg";

import styles from "./AvatarSelectionUIComponent.module.css";

type AvatarSelectionUIProps = {
  onUpdateUserAvatar: (avatar: Avatar) => void;
  visibleByDefault?: boolean;
  availableAvatars: Avatar[];
  enableCustomAvatar?: boolean;
};

type CustomAvatarType = "glb" | "html" | "mml";

export const AvatarSelectionUIComponent: ForwardRefRenderFunction<any, AvatarSelectionUIProps> = (
  props: AvatarSelectionUIProps,
) => {
  const visibleByDefault: boolean = props.visibleByDefault ?? false;
  const [isVisible, setIsVisible] = useState<boolean>(visibleByDefault);
  const [selectedAvatar, setSelectedAvatar] = useState<CustomAvatar | undefined>(undefined);
  const [customAvatarType, setCustomAvatarType] = useState<CustomAvatarType>("glb");
  const [customAvatarValue, setCustomAvatarValue] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleRootClick = (e: MouseEvent) => {
    e.stopPropagation();
  };

  const selectAvatar = (avatar: CustomAvatar) => {
    setSelectedAvatar(avatar);
    props.onUpdateUserAvatar(avatar);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setCustomAvatarValue(e.target.value);
  };

  const addCustomAvatar = () => {
    if (!customAvatarValue) {
      return;
    }

    const newSelectedAvatar = {
      mmlCharacterString: customAvatarType === "mml" ? customAvatarValue : undefined,
      mmlCharacterUrl: customAvatarType === "html" ? customAvatarValue : undefined,
      meshFileUrl: customAvatarType === "glb" ? customAvatarValue : undefined,
      isCustomAvatar: true,
    } as CustomAvatar;

    setSelectedAvatar(newSelectedAvatar);
    props.onUpdateUserAvatar(newSelectedAvatar);
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.stopPropagation();
  };

  const handleTypeSwitch = (type: CustomAvatarType) => {
    setCustomAvatarType(type);
    setCustomAvatarValue("");
  }

  const getPlaceholderByType = (type: CustomAvatarType) => {
    switch (type) {
      case "glb":
        return "https://.../avatar.glb";
      case "html":
        return "https://.../avatar.html";
      case "mml":
        return '<m-character src="https://link-to-avatar">\n</m-character';
    }
  };

  return (
    <>
      <div className={styles.menuButton} onClick={handleRootClick}>
        {!isVisible && (
          <div className={styles.openTab} onClick={() => setIsVisible(true)}>
            <img src={`data:image/svg+xml;utf8,${encodeURIComponent(AvatarIcon)}`} />
          </div>
        )}
      </div>
      {isVisible && (
        <div className={`${styles.avatarSelectionContainer}`}>
          <div className={styles.avatarSelectionUi}>
            <div className={styles.avatarSelectionUiHeader}>
              <h2>Choose your avatar</h2>
              <button className={styles.closeButton} onClick={(e) => setIsVisible(false)}>
                X
              </button>
            </div>
            <div className={styles.avatarSelectionUiContent}>
              {props.availableAvatars.map((avatar, index) => {
                const isSelected =
                  !selectedAvatar?.isCustomAvatar &&
                  ((selectedAvatar?.meshFileUrl &&
                    selectedAvatar?.meshFileUrl === avatar.meshFileUrl) ||
                    (selectedAvatar?.mmlCharacterUrl &&
                      selectedAvatar?.mmlCharacterUrl === avatar.mmlCharacterUrl) ||
                    (selectedAvatar?.mmlCharacterString &&
                      selectedAvatar?.mmlCharacterString === avatar.mmlCharacterString));

                return (
                  <div
                    key={index}
                    className={styles.avatarSelectionUiAvatar}
                    onClick={() => selectAvatar(avatar)}
                  >
                    <img
                      className={isSelected ? styles.selectedAvatar : ""}
                      src={avatar.thumbnailUrl}
                      alt={avatar.name}
                    />
                    <h2>{avatar.name}</h2>
                  </div>
                );
              })}
            </div>
          </div>
          {props.enableCustomAvatar && (
            <div className={styles.customAvatarSection}>
              <h2>Custom Avatar Section</h2>
              <input
                type="radio"
                id="glb"
                name="customAvatarType"
                onChange={() => handleTypeSwitch("glb")}
                defaultChecked={customAvatarType === "glb"}
                checked={customAvatarType === "glb"}
              />
              <label htmlFor="glb">GLB</label>
              <input
                type="radio"
                id="html"
                name="customAvatarType"
                onChange={() => handleTypeSwitch("html")}
                defaultChecked={customAvatarType === "html"}
                checked={customAvatarType === "html"}
              />
              <label htmlFor="html">HTML</label>
              <input
                type="radio"
                id="mml"
                name="customAvatarType"
                onChange={() => handleTypeSwitch("mml")}
                defaultChecked={customAvatarType === "mml"}
                checked={customAvatarType === "mml"}
              />
              <label htmlFor="mml">MML</label>
              <div className={styles.customAvatarInputSection}>
                {customAvatarType === "mml" ? (
                  <textarea
                    ref={textareaRef}
                    className={styles.customAvatarInput}
                    value={customAvatarValue}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyPress}
                    placeholder={getPlaceholderByType(customAvatarType)}
                    rows={4}
                  />
                ) : (
                  <input
                    ref={inputRef}
                    className={styles.customAvatarInput}
                    value={customAvatarValue}
                    onKeyDown={handleKeyPress}
                    onChange={handleInputChange}
                    placeholder={getPlaceholderByType(customAvatarType)}
                  />
                )}
                <button disabled={!customAvatarValue} type="button" onClick={addCustomAvatar}>
                  Set
                </button>
              </div>
              {selectedAvatar?.isCustomAvatar && (
                <div>
                  <h2 className={styles.selectedAvatar}>Custom Avatar Selected</h2>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
};
