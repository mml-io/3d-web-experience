import * as playcanvas from "playcanvas";

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
  private targetOpacity: number = 0;
  private fadingSpeed: number = 0.02;
  private config: CharacterTooltipConfig;
  private content: string | null = null;
  private hideTimeout: NodeJS.Timeout | null = null;
  private canvasText: CanvasText;
  private tooltipSprite: playcanvas.Entity;
  private material: playcanvas.StandardMaterial;
  private texture: playcanvas.Texture | null = null;
  private app: playcanvas.AppBase;

  constructor(app: playcanvas.AppBase, configArg?: Partial<CharacterTooltipConfig>) {
    super();
    this.app = app;

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

    this.canvasText = new CanvasText();

    // Create sprite entity
    this.tooltipSprite = new playcanvas.Entity("TooltipSprite");
    this.addChild(this.tooltipSprite);

    // Create material
    this.material = new playcanvas.StandardMaterial();
    this.material.emissive = new playcanvas.Color(1, 1, 1);
    this.material.blendType = playcanvas.BLEND_NORMAL;
    this.material.opacity = this.config.visibleOpacity;
    this.material.useGammaTonemap = false;
    this.material.useFog = false;
    this.material.useLighting = false;
    this.material.depthWrite = false;
    this.material.cull = playcanvas.CULLFACE_NONE;
    this.material.update();

    // Add sprite component
    this.tooltipSprite.addComponent("sprite", {
      material: this.material,
      width: 1,
      height: 1,
    });

    // Set initial position
    this.setLocalPosition(0, 1.6, 0);
    this.tooltipSprite.enabled = false;
  }

  public getSpriteHeight(): number {
    const spriteComp = this.tooltipSprite.sprite;
    return spriteComp ? spriteComp.height : 0;
  }

  public setHeightOffset(height: number) {
    const pos = this.getLocalPosition();
    const scale = this.getSpriteHeight();
    this.setLocalPosition(pos.x, height + scale / 2, pos.z);
  }

  private redrawText(content: string) {
    if (content === this.content) {
      // No need to redraw if the content is the same
      return;
    }
    this.content = content;

    // Generate canvas with text
    const canvas = this.canvasText.renderText(content, {
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

    // Update texture
    if (this.texture) {
      this.texture.destroy();
      this.texture = null;
    }

    // Create texture from canvas
    this.texture = new playcanvas.Texture(this.app.graphicsDevice);
    this.texture.setSource(canvas);
    this.texture.minFilter = playcanvas.FILTER_LINEAR;
    this.texture.magFilter = playcanvas.FILTER_LINEAR;
    this.material.emissiveMap = this.texture;
    this.material.update();

    // Update sprite scale based on canvas size
    const width = canvas.width / (100 * fontScale);
    const height = canvas.height / (100 * fontScale);

    const spriteComponent = this.tooltipSprite.sprite;
    if (spriteComponent) {
      spriteComponent.width = width;
      spriteComponent.height = height;
    }
  }

  setText(text: string, onRemove?: () => void) {
    const sanitizedText = text.replace(/(\r\n|\n|\r)/gm, "");
    this.tooltipSprite.enabled = true;
    this.targetOpacity = this.config.visibleOpacity;
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    if (this.config.secondsToFadeOut !== null) {
      this.hideTimeout = setTimeout(() => {
        this.hideTimeout = null;
        this.hide();
        if (onRemove) {
          onRemove();
        }
      }, this.config.secondsToFadeOut * 1000);
    }
    this.redrawText(sanitizedText);
  }

  hide() {
    this.targetOpacity = 0;
  }

  show() {
    this.setText(this.content || "");
  }

  update() {
    const opacity = this.material.opacity;
    if (opacity < this.targetOpacity) {
      this.material.opacity = Math.min(
        this.material.opacity + this.fadingSpeed,
        this.targetOpacity,
      );
      this.material.update();
    } else if (opacity > this.targetOpacity) {
      this.material.opacity = Math.max(
        this.material.opacity - this.fadingSpeed,
        this.targetOpacity,
      );
      this.material.update();

      if (this.material.opacity <= 0) {
        this.tooltipSprite.enabled = false;
      }
    }
  }
}
