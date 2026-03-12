import { VirtualJoystick } from "@mml-io/3d-web-client-core";

import type { Networked3dWebExperienceClient } from "./Networked3dWebExperienceClient";
import type { UIPlugin } from "./plugins";

export type VirtualJoystickPluginOptions = {
  radius?: number;
  innerRadius?: number;
  mouseSupport?: boolean;
};

export class DefaultVirtualJoystickPlugin implements UIPlugin {
  private wrapper: HTMLDivElement | null = null;
  private joystick: VirtualJoystick | null = null;

  constructor(private options: VirtualJoystickPluginOptions = {}) {}

  mount(container: HTMLElement, client: Networked3dWebExperienceClient): void {
    this.wrapper = document.createElement("div");
    container.appendChild(this.wrapper);

    this.joystick = new VirtualJoystick(this.wrapper, {
      radius: this.options.radius ?? 70,
      innerRadius: this.options.innerRadius ?? 20,
      mouseSupport: this.options.mouseSupport ?? false,
    });

    client.setAdditionalInputProvider(this.joystick);
  }

  dispose(): void {
    this.wrapper?.remove();
    this.wrapper = null;
    this.joystick = null;
  }
}
