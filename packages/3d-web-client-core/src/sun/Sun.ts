import * as playcanvas from "playcanvas";

import { sunValues } from "../tweakpane/blades/environmentFolder";

export class Sun extends playcanvas.Entity {
  private readonly debug: boolean = false;
  private readonly sunOffset: playcanvas.Vec3 = new playcanvas.Vec3(
    sunValues.sunPosition.sunAzimuthalAngle * (Math.PI / 180),
    sunValues.sunPosition.sunPolarAngle * (Math.PI / 180),
    10,
  );

  private readonly directionalLight: playcanvas.Entity;

  public target: playcanvas.Vec3 | null = null;

  constructor(app: playcanvas.AppBase) {
    super("Sun", app);

    if (this.debug === true) {
      // TODO - debug helper
    }

    this.directionalLight = new playcanvas.Entity("SunDirectionalLight");
    this.directionalLight.addComponent("light", {
      type: "directional",
      luminance: 10 * 4000,
      intensity: 10 * 0.01,
      castShadows: true,
      color: new playcanvas.Color(1, 1, 1),
      shadowBias: 0.001,
      normalOffsetBias: 0.0001,
      innerConeAngle: 45,
      outerConeAngle: 45,
      range: 100,
      falloffMode: playcanvas.LIGHTFALLOFF_INVERSESQUARED,
      enabled: true,
    });
    this.setColor();
    this.addChild(this.directionalLight);

    this.updateCharacterPosition(new playcanvas.Vec3(0, 0, 0));
  }

  public updateCharacterPosition(position: playcanvas.Vec3 | undefined) {
    if (!position) return;
    this.target = position;
    this.setSunPosition(this.sunOffset.x, this.sunOffset.y);
  }

  public setAzimuthalAngle(angle: number) {
    if (this.sunOffset) this.sunOffset.x = angle;
    if (this.target) this.updateCharacterPosition(this.target);
  }

  public setPolarAngle(angle: number) {
    if (this.sunOffset) this.sunOffset.y = angle;
    if (this.target) this.updateCharacterPosition(this.target);
  }

  public setIntensity(intensity: number) {
    if (this.directionalLight.light) {
      this.directionalLight.light.intensity = intensity;
    }
  }

  public setColor() {
    if (this.directionalLight.light) {
      this.directionalLight.light.color = new playcanvas.Color(
        sunValues.sunColor.r,
        sunValues.sunColor.g,
        sunValues.sunColor.b,
      );
    }
  }

  private setSunPosition(azimuthalAngle: number, polarAngle: number) {
    if (!this.target) return;
    const distance = this.sunOffset.z;
    const sphericalPosition = new playcanvas.Vec3(
      distance * Math.sin(polarAngle) * Math.cos(azimuthalAngle),
      distance * Math.cos(polarAngle),
      distance * Math.sin(polarAngle) * Math.sin(azimuthalAngle),
    );

    // Create a new position by adding the spherical offset to the target
    const newSunPosition = new playcanvas.Vec3().copy(this.target).add(sphericalPosition);

    // Position the directional light
    this.directionalLight.setPosition(newSunPosition.x, newSunPosition.y, newSunPosition.z);

    // Look at the target
    this.directionalLight.lookAt(this.target.x, this.target.y, this.target.z);
  }
}
