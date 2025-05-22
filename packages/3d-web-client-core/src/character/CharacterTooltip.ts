import * as playcanvas from "playcanvas";

import { CameraManager } from "../camera/CameraManager";

import { CanvasText } from "./CanvasText";

enum LabelAlignment {
  left = "left",
  center = "center",
  right = "right",
}

const fontScale = 5;
const defaultLabelColor = new playcanvas.Color(0, 0, 0);
const defaultFontColor = new playcanvas.Color(1, 1, 1);
const defaultLabelAlignment = LabelAlignment.center;
const defaultLabelFontSize = 10;
const defaultLabelPadding = 10;
const defaultVisibleOpacity = 0.85;
const defaultSecondsToFadeOut = null;

const defaultFadeSpeed = 0.02;

export type CharacterTooltipConfig = {
  alignment: LabelAlignment;
  fontSize: number;
  padding: number;
  color: playcanvas.Color;
  fontColor: playcanvas.Color;
  visibleOpacity: number;
  maxWidth?: number;
  secondsToFadeOut: number | null;
};

export class CharacterTooltip extends playcanvas.Entity {
  private textCanvas: CanvasText = new CanvasText();
  private planeEntity: playcanvas.Entity;
  private material: playcanvas.StandardMaterial;
  private texture: playcanvas.Texture | null = null;

  private targetOpacity: number = 0;
  private fadingSpeed: number = defaultFadeSpeed;
  private currentContent: string | null = null;
  private hideTimeout: NodeJS.Timeout | null = null;

  private config: CharacterTooltipConfig;
  private app: playcanvas.AppBase;
  private cameraManager: CameraManager;

  constructor(
    app: playcanvas.AppBase,
    cameraManager: CameraManager,
    configArg?: Partial<CharacterTooltipConfig>,
  ) {
    super();
    this.app = app;
    this.cameraManager = cameraManager;

    this.config = {
      alignment: defaultLabelAlignment,
      fontSize: defaultLabelFontSize,
      padding: defaultLabelPadding,
      color: defaultLabelColor,
      fontColor: defaultFontColor,
      visibleOpacity: defaultVisibleOpacity,
      secondsToFadeOut: defaultSecondsToFadeOut,
      ...configArg,
    };

    this.material = new playcanvas.StandardMaterial();
    this.material.emissive = new playcanvas.Color(1, 1, 1);
    this.material.blendType = playcanvas.BLEND_NORMAL;
    this.material.opacity = this.config.visibleOpacity;
    this.material.useGammaTonemap = true;
    this.material.useFog = false;
    this.material.useLighting = false;
    this.material.depthWrite = false;
    this.material.cull = playcanvas.CULLFACE_NONE;
    this.material.update();

    this.planeEntity = new playcanvas.Entity("TooltipPlane");
    this.planeEntity.addComponent("render", {
      type: "plane",
      material: this.material,
      width: 1,
      height: 1,
    });
    this.planeEntity.setLocalEulerAngles(90, 180, 0);
    this.addChild(this.planeEntity);
    this.setLocalPosition(0, 1.6, 0);
    this.planeEntity.enabled = false;
  }

  public setText(content: string, onRemove?: () => void) {
    const sanitized = content.trim();
    if (this.currentContent === sanitized) return;

    this.currentContent = sanitized;
    this.planeEntity.enabled = true;
    this.targetOpacity = this.config.visibleOpacity;

    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    if (this.config.secondsToFadeOut !== null) {
      this.hideTimeout = setTimeout(() => {
        this.hideTimeout = null;
        this.hide();
        onRemove?.();
      }, this.config.secondsToFadeOut * 1000);
    }

    const canvas = this.textCanvas.renderText(sanitized, {
      bold: true,
      fontSize: this.config.fontSize * fontScale,
      paddingPx: this.config.padding,
      textColorRGB255A1: {
        r: Math.round(this.config.fontColor.r * 255),
        g: Math.round(this.config.fontColor.g * 255),
        b: Math.round(this.config.fontColor.b * 255),
        a: 1.0,
      },
      backgroundColorRGB255A1: {
        r: Math.round(this.config.color.r * 255),
        g: Math.round(this.config.color.g * 255),
        b: Math.round(this.config.color.b * 255),
        a: 1.0,
      },
      alignment: this.config.alignment,
      dimensions:
        this.config.maxWidth !== undefined
          ? {
              width: this.config.maxWidth,
              height: 100, // arbitrary height, will adjust based on content
            }
          : undefined,
    });

    if (this.texture) {
      this.texture.destroy();
      this.texture = null;
    }

    this.texture = new playcanvas.Texture(this.app.graphicsDevice, {
      width: canvas.width,
      height: canvas.height,
    });
    this.texture.setSource(canvas);
    this.texture.minFilter = playcanvas.FILTER_LINEAR;
    this.texture.magFilter = playcanvas.FILTER_LINEAR;
    this.material.emissiveMap = this.texture;
    this.material.diffuseMap = this.texture;
    this.material.opacityMap = this.texture;
    this.material.update();

    const width = canvas.width / (100 * fontScale);
    const height = canvas.height / (100 * fontScale);
    this.planeEntity.setLocalScale(width, 1, height);
  }

  public show() {
    this.setText(this.currentContent || "");
  }

  public hide() {
    this.targetOpacity = 0;
  }

  public update() {
    if (!this.material) return;
    const current = this.material.opacity;
    if (current < this.targetOpacity) {
      this.material.opacity = Math.min(current + this.fadingSpeed, this.targetOpacity);
      this.material.update();
    } else if (current > this.targetOpacity) {
      this.material.opacity = Math.max(current - this.fadingSpeed, this.targetOpacity);
      this.material.update();
      if (this.material.opacity <= 0) {
        this.planeEntity.enabled = false;
      }
    }
    if (this.cameraManager.camera) {
      this.lookAt(this.cameraManager.camera.getPosition());
    }
  }

  public getSpriteHeight(): number {
    return this.planeEntity.getLocalScale().z;
  }

  public setHeightOffset(height: number) {
    const pos = this.getLocalPosition();
    const spriteHeight = this.getSpriteHeight();
    this.setLocalPosition(pos.x, height + spriteHeight / 2, pos.z);
  }
}
