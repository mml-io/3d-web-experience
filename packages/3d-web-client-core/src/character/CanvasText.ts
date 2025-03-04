import { Texture, LinearFilter, RGBAFormat } from "three";

export type RGBA = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export type CanvasTextOptions = {
  fontSize: number;
  textColorRGB255A1: RGBA;
  backgroundColorRGB255A1?: RGBA;
  font?: string;
  bold?: boolean;
  paddingPx?: number;
  alignment?: string;
  dimensions?:
    | {
        maxWidth?: undefined;
        width: number;
        height: number;
      }
    | {
        maxWidth: number;
      };
};

function getTextAlignOffset(textAlign: CanvasTextAlign, width: number) {
  switch (textAlign) {
    case "center":
      return width / 2;
    case "right":
      return width;
    default:
      return 0;
  }
}

function printAtWordWrap(
  context: CanvasRenderingContext2D,
  fullText: string,
  textAlign: CanvasTextAlign,
  y: number,
  lineHeight: number,
  fitWidth: number,
  padding: number,
) {
  const x = getTextAlignOffset(textAlign, fitWidth - padding * 2);
  const lines = fullText.split("\n");
  let currentLine = 0;
  for (const text of lines) {
    fitWidth = fitWidth || 0;

    if (fitWidth <= 0) {
      context.fillText(text, x, y + lineHeight * currentLine);
      currentLine++;
      continue;
    }
    let words = text.split(" ");
    let lastWordIndex = 1;
    while (words.length > 0 && lastWordIndex <= words.length) {
      const str = words.slice(0, lastWordIndex).join(" ");
      const textWidth = context.measureText(str).width;
      if (textWidth + padding * 2 > fitWidth) {
        if (lastWordIndex === 1) {
          // Handle case where single word is too long
          const word = words[0];
          let charIndex = 1;
          while (charIndex < word.length) {
            const substring = word.substring(0, charIndex);
            const subWidth = context.measureText(substring).width;
            if (subWidth + padding * 2 > fitWidth) {
              if (charIndex === 1) charIndex = 2;
              context.fillText(
                word.substring(0, charIndex - 1),
                x + padding,
                y + lineHeight * currentLine + padding,
              );
              currentLine++;
              words[0] = word.substring(charIndex - 1);
              break;
            }
            charIndex++;
          }
          if (charIndex >= word.length) {
            lastWordIndex = 2;
          } else {
            continue;
          }
        }
        context.fillText(
          words.slice(0, lastWordIndex - 1).join(" "),
          x + padding,
          y + lineHeight * currentLine + padding,
        );
        currentLine++;
        words = words.splice(lastWordIndex - 1);
        lastWordIndex = 1;
      } else {
        lastWordIndex++;
      }
    }
    if (lastWordIndex > 0 && words.length > 0) {
      context.fillText(words.join(" "), x + padding, y + lineHeight * currentLine + padding);
      currentLine++;
    }
  }
}

export class CanvasText {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d") as CanvasRenderingContext2D;
  }

  public renderText(message: string, options: CanvasTextOptions): HTMLCanvasElement {
    const fontsize = options.fontSize;
    const textColor = options.textColorRGB255A1;
    const backgroundColor = options.backgroundColorRGB255A1 || { r: 255, g: 255, b: 255, a: 1 };
    const padding = options.paddingPx || 0;
    const font = options.font || "Arial";
    const fontString = (options.bold ? "bold " : "") + fontsize + "px " + font;

    // calculate text alignment offset
    const textAlign = (options.alignment as CanvasTextAlign) ?? "left";

    if (options.dimensions && options.dimensions.maxWidth === undefined) {
      // NOTE: setting the canvas dimensions resets the context properties, so
      // we always do it first
      this.canvas.width = options.dimensions.width;
      this.canvas.height = options.dimensions.height;
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.context.font = fontString;
      this.context.textAlign = textAlign;
      this.context.fillStyle = `rgba(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b}, ${backgroundColor.a})`;
      this.context.lineWidth = 0;
      this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.context.fillStyle = `rgba(${textColor.r}, ${textColor.g}, ${textColor.b}, ${textColor.a})`;
      printAtWordWrap(
        this.context,
        message,
        textAlign,
        fontsize,
        fontsize,
        this.canvas.width,
        padding,
      );
      return this.canvas;
    } else {
      this.context.font = fontString;
      this.context.textAlign = textAlign;
      const metrics = this.context.measureText(message);
      const textWidth = metrics.width;
      const textHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;

      if (options.dimensions && options.dimensions.maxWidth !== undefined) {
        const maxWidthWithoutPadding = options.dimensions.maxWidth - padding * 2;
        if (textWidth > maxWidthWithoutPadding) {
          // This is multiple lines - estimate the lines
          const lineCount = Math.ceil(textWidth / maxWidthWithoutPadding);
          this.canvas.width = options.dimensions.maxWidth;
          this.canvas.height = textHeight * lineCount + padding * 2;
          this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
          this.context.font = fontString;
          this.context.textAlign = textAlign;
          this.context.fillStyle = `rgba(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b}, ${backgroundColor.a})`;
          this.context.lineWidth = 0;
          this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
          this.context.fillStyle = `rgba(${textColor.r}, ${textColor.g}, ${textColor.b}, ${textColor.a})`;
          printAtWordWrap(
            this.context,
            message,
            textAlign,
            fontsize,
            fontsize,
            this.canvas.width,
            padding,
          );
          return this.canvas;
        } else {
          // Allow the text to be rendered as a single line (below)
        }
      }

      // NOTE: setting the this.canvas dimensions resets the context properties, so
      // we always do it first. However, we also need to take into account the
      // font size to measure the text in the first place.
      this.canvas.width = textWidth + padding * 2;
      this.canvas.height = textHeight + padding * 2;
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.context.font = fontString;
      this.context.textAlign = textAlign;
      this.context.fillStyle = `rgba(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b}, ${backgroundColor.a})`;
      this.context.lineWidth = 0;
      this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.context.fillStyle = `rgba(${textColor.r}, ${textColor.g}, ${textColor.b}, ${textColor.a})`;
      this.context.fillText(
        message,
        padding + getTextAlignOffset(textAlign, textWidth),
        textHeight,
      );
    }

    return this.canvas;
  }
}

export function THREECanvasTextTexture(
  text: string,
  options: CanvasTextOptions,
): { texture: Texture; width: number; height: number } {
  const canvas = new CanvasText().renderText(text, options);
  const texture = new Texture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.format = RGBAFormat;
  texture.needsUpdate = true;

  return { texture, width: canvas.width, height: canvas.height };
}
