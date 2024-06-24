import React from "react";
import { useRef, useState, ForwardRefRenderFunction, MouseEvent } from "react";

import { useClickOutside } from "../../helpers";
import ChatIcon from "../../icons/Chat.svg";
import { StringToHslOptions } from "../../AvatarSelectionUI";

import styles from "./AvatarSelectionUIComponent.module.css";
import { AvatarType } from "@mml-io/3d-web-experience-client";

type AvatarSelectionUIProps = {
  onUpdateUserAvatar: (avatar: AvatarType) => void;
  visibleByDefault?: boolean;
  stringToHslOptions?: StringToHslOptions;
  availableAvatars: AvatarType[];
  enableCustomAvatar?: boolean;
};

type CustomAvatarType = AvatarType & {
  isCustomAvatar?: boolean;
};

export const AvatarSelectionUIComponent: ForwardRefRenderFunction<any, AvatarSelectionUIProps> = (
  props: AvatarSelectionUIProps,
) => {
  const visibleByDefault: boolean = props.visibleByDefault ?? false;
  const [isVisible, setIsVisible] = useState<boolean>(visibleByDefault);
  const [selectedAvatar, setSelectedAvatar] = useState<CustomAvatarType | undefined>(undefined);
  const [customAvatarType, setCustomAvatarType] = useState<"glb" | "html" | "mml">("glb");
  const [customAvatarValue, setCustomAvatarValue] = useState<string>("");

  const handleRootClick = (e: MouseEvent) => {
    e.stopPropagation();
  };

  const avatarPanelRef = useClickOutside(() => {
    setIsVisible(false);
  });

  const selectAvatar = (avatar: CustomAvatarType) => {
    setSelectedAvatar(avatar);
    props.onUpdateUserAvatar(avatar);
  };

  const addCustomAvatar = () => {
    if (!customAvatarValue) {
      return;
    }

    const selectedAvatar = {
      mmlCharacterString: customAvatarType === "mml" ? customAvatarValue : undefined,
      mmlCharacterUrl: customAvatarType === "html" ? customAvatarValue : undefined,
      meshFileUrl: customAvatarType === "glb" ? customAvatarValue : undefined,
      isCustomAvatar: true,
    } as CustomAvatarType;

    setSelectedAvatar(selectedAvatar);
    props.onUpdateUserAvatar(selectedAvatar);
  };

  return (
    <>
      <div className={styles.menuButton} onClick={handleRootClick}>
        <div className={styles.openTab} onClick={() => setIsVisible(true)}>
          <img src={`data:image/svg+xml;utf8,${encodeURIComponent(ChatIcon)}`} />
        </div>
      </div>
      <div style={{ zIndex: isVisible ? 1 : -1 }} className={`${styles.avatarSelectionContainer}`}>
        <div className={styles.avatarSelectionUi} ref={avatarPanelRef}>
          <div className={styles.avatarSelectionUiHeader}>
            <h1>Choose your avatar</h1>
            <button
              className={styles.avatarSelectionUiCloseButton}
              onClick={() => setIsVisible(false)}
            >
              Close
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
          {props.enableCustomAvatar && (
            <div className={styles.customAvatarSection}>
              <h2>Custom Avatar Section</h2>
              <input
                type="radio"
                id="glb"
                name="customAvatarType"
                onChange={() => setCustomAvatarType("glb")}
                defaultChecked={customAvatarType === "glb"}
                checked={customAvatarType === "glb"}
              />
              <label htmlFor="glb">GLB</label>
              <input
                type="radio"
                id="html"
                name="customAvatarType"
                onChange={() => setCustomAvatarType("html")}
                defaultChecked={customAvatarType === "html"}
                checked={customAvatarType === "html"}
              />
              <label htmlFor="html">HTML</label>
              <input
                type="radio"
                id="mml"
                name="customAvatarType"
                onChange={() => setCustomAvatarType("mml")}
                defaultChecked={customAvatarType === "mml"}
                checked={customAvatarType === "mml"}
              />
              <label htmlFor="mml">MML</label>
              <input
                className={styles.customAvatarInput}
                value={customAvatarValue}
                onChange={({ target: { value } }) => setCustomAvatarValue(value)}
              />
              <button disabled={!customAvatarValue} type="button" onClick={addCustomAvatar}>
                Set
              </button>
              {selectedAvatar?.isCustomAvatar && (
                <div>
                  <h2 className={styles.selectedAvatar}>Custom Avatar Selected</h2>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
