import { createRef, forwardRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, Root } from "react-dom/client";
import * as React from "react";
import { AvatarSelectionUIComponent } from "./components/AvatarPanel/AvatarSectionUIComponent";
import { AvatarType, CustomAvatarType } from "@mml-io/3d-web-experience-client";

export type StringToHslOptions = {
  hueThresholds?: [number, number][];
  saturationThresholds?: [number, number][];
  lightnessThresholds?: [number, number][];
};

const DEFAULT_HUE_RANGES: [number, number][] = [[10, 350]];
const DEFAULT_SATURATION_RANGES: [number, number][] = [[60, 100]];
const DEFAULT_LIGHTNESS_RANGES: [number, number][] = [[65, 75]];

export const DEFAULT_HSL_OPTIONS: StringToHslOptions = {
  hueThresholds: DEFAULT_HUE_RANGES,
  saturationThresholds: DEFAULT_SATURATION_RANGES,
  lightnessThresholds: DEFAULT_LIGHTNESS_RANGES,
};

const ForwardedAvatarSelectionUIComponent = forwardRef(AvatarSelectionUIComponent);

export type AvatarSelectionUIProps = {
  holderElement: HTMLElement;
  clientId: number;
  visibleByDefault?: boolean;
  stringToHslOptions?: StringToHslOptions;
  availableAvatars: AvatarType[];
  selectedAvatar?: CustomAvatarType;
  sendMessageToServerMethod: (avatar: CustomAvatarType) => void;
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

  private onUpdateUserAvatar = (avatar: CustomAvatarType) => {
    this.config.sendMessageToServerMethod(avatar);
  };

  init() {
    flushSync(() =>
      this.root.render(
        <ForwardedAvatarSelectionUIComponent
          ref={this.appRef}
          onUpdateUserAvatar={this.onUpdateUserAvatar}
          visibleByDefault={false}
          stringToHslOptions={this.config.stringToHslOptions}
          availableAvatars={this.config.availableAvatars}
          enableCustomAvatar={this.config.enableCustomAvatar}
        />,
      ),
    );
  }
}
