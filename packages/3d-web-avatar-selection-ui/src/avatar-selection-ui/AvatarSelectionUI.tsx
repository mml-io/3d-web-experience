import * as React from "react";
import { createRef, forwardRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, Root } from "react-dom/client";

import { AvatarType } from "./AvatarType";
import { AvatarSelectionUIComponent } from "./components/AvatarPanel/AvatarSectionUIComponent";

const ForwardedAvatarSelectionUIComponent = forwardRef(AvatarSelectionUIComponent);

export type CustomAvatar = AvatarType & {
  isCustomAvatar?: boolean;
};

export type AvatarSelectionUIProps = {
  holderElement: HTMLElement;
  clientId: number;
  visibleByDefault?: boolean;
  availableAvatars: Array<AvatarType>;
  sendMessageToServerMethod: (avatar: CustomAvatar) => void;
  enableCustomAvatar?: boolean;
};

export class AvatarSelectionUI {
  private root: Root;
  private appRef: React.RefObject<any> = createRef<any>();

  private wrapper = document.createElement("div");

  constructor(private config: AvatarSelectionUIProps) {
    this.config.holderElement.appendChild(this.wrapper);
    this.root = createRoot(this.wrapper);
  }

  private onUpdateUserAvatar = (avatar: CustomAvatar) => {
    this.config.sendMessageToServerMethod(avatar);
  };

  init() {
    flushSync(() =>
      this.root.render(
        <ForwardedAvatarSelectionUIComponent
          ref={this.appRef}
          onUpdateUserAvatar={this.onUpdateUserAvatar}
          visibleByDefault={false}
          availableAvatars={this.config.availableAvatars}
          enableCustomAvatar={this.config.enableCustomAvatar}
        />,
      ),
    );
  }
}
