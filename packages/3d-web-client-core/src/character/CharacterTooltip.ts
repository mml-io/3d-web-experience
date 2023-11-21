import {
  Camera,
  Color,
  FrontSide,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
} from "three";

import { THREECanvasTextTexture } from "./CanvasText";

enum LabelAlignment {
  left = "left",
  center = "center",
  right = "right",
}

const fontScale = 5;
const defaultLabelColor = new Color(0x000000);
const defaultFontColor = new Color(0xffffff);
const defaultLabelAlignment = LabelAlignment.center;
const defaultLabelFontSize = 9;
const defaultLabelPadding = 0;
const defaultLabelWidth = 0.25;
const defaultLabelHeight = 0.125;
const defaultLabelCastShadows = true;

const tooltipGeometry = new PlaneGeometry(1, 1, 1, 1);

export class CharacterTooltip extends Mesh {
  private tooltipMaterial: MeshBasicMaterial;
  private visibleOpacity: number = 0.85;
  private targetOpacity: number = 0;
  private fadingSpeed: number = 0.02;
  private secondsToFadeOut: number = 15;

  private props = {
    content: "",
    alignment: defaultLabelAlignment,
    width: defaultLabelWidth,
    height: defaultLabelHeight,
    fontSize: defaultLabelFontSize,
    padding: defaultLabelPadding,
    color: defaultLabelColor,
    fontColor: defaultFontColor,
    castShadows: defaultLabelCastShadows,
  };

  constructor() {
    super(tooltipGeometry);
    this.tooltipMaterial = new MeshBasicMaterial({
      map: null,
      transparent: true,
      opacity: 0,
      side: FrontSide,
    });
    this.material = this.tooltipMaterial;
    this.position.set(0, 1.6, 0);
    this.visible = false;
  }

  private redrawText(content: string) {
    if (!this.tooltipMaterial) {
      return;
    }
    if (this.tooltipMaterial.map) {
      this.tooltipMaterial.map.dispose();
    }
    const { texture, width, height } = THREECanvasTextTexture(content, {
      bold: true,
      fontSize: this.props.fontSize * fontScale,
      paddingPx: this.props.padding,
      textColorRGB255A1: {
        r: this.props.fontColor.r * 255,
        g: this.props.fontColor.g * 255,
        b: this.props.fontColor.b * 255,
        a: 1.0,
      },
      backgroundColorRGB255A1: {
        r: this.props.color.r * 255,
        g: this.props.color.g * 255,
        b: this.props.color.b * 255,
        a: 1.0,
      },
      dimensions: {
        width: this.props.width * (100 * fontScale),
        height: this.props.height * (100 * fontScale),
      },
      alignment: this.props.alignment,
    });

    this.tooltipMaterial.map = texture;
    this.tooltipMaterial.map.magFilter = LinearFilter;
    this.tooltipMaterial.map.minFilter = LinearFilter;
    this.tooltipMaterial.needsUpdate = true;

    this.scale.x = width / (100 * fontScale);
    this.scale.y = height / (100 * fontScale);
    this.position.y = 1.6;
  }

  setText(text: string, temporary: boolean = false) {
    this.redrawText(text);
    this.visible = true;
    this.targetOpacity = this.visibleOpacity;
    if (temporary) {
      setTimeout(() => {
        this.hide();
      }, this.secondsToFadeOut * 1000);
    }
  }

  hide() {
    this.targetOpacity = 0;
  }

  update(camera: Camera) {
    this.lookAt(camera.position);
    const opacity = this.tooltipMaterial.opacity;
    if (opacity < this.targetOpacity) {
      this.tooltipMaterial.opacity = Math.min(
        this.tooltipMaterial.opacity + this.fadingSpeed,
        this.targetOpacity,
      );
    } else if (opacity > this.targetOpacity) {
      this.tooltipMaterial.opacity = Math.max(
        this.tooltipMaterial.opacity - this.fadingSpeed,
        this.targetOpacity,
      );
      if (opacity >= 1 && this.tooltipMaterial.transparent) {
        this.tooltipMaterial.transparent = false;
        this.tooltipMaterial.needsUpdate = true;
      } else if (opacity > 0 && opacity < 1 && !this.tooltipMaterial.transparent) {
        this.tooltipMaterial.transparent = true;
        this.tooltipMaterial.needsUpdate = true;
      }
      if (this.tooltipMaterial.opacity <= 0) {
        this.visible = false;
      }
    }
  }
}
