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
    const textAlign = (options.alignment as CanvasTextAlign) ?? "left";

    this.context.font = fontString;
    this.context.textAlign = textAlign;

    if (options.dimensions && options.dimensions.maxWidth === undefined) {
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
    }

    if (options.dimensions && options.dimensions.maxWidth !== undefined) {
      this.context.font = fontString;
      this.context.textAlign = textAlign;

      const words = message.split(" ");
      let currentLine = "";
      const lines: string[] = [];

      for (let i = 0; i < words.length; i++) {
        const testLine = currentLine + words[i] + " ";
        const testWidth = this.context.measureText(testLine).width;
        if (testWidth > options.dimensions.maxWidth && i > 0) {
          lines.push(currentLine.trim());
          currentLine = words[i] + " ";
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine.length > 0) {
        lines.push(currentLine.trim());
      }

      const textHeight = fontsize * lines.length;

      const measuredLineWidths = lines.map(
        (line) => this.context.measureText(line).width + padding * 2,
      );
      const maxLineWidth = Math.max(...measuredLineWidths);
      const textWidth = Math.min(
        maxLineWidth + padding * 2,
        options.dimensions.maxWidth + padding * 2,
      );

      this.canvas.width = textWidth;

      this.canvas.height = textHeight + padding * 2;
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
    }

    const metrics = this.context.measureText(message);
    const textWidth = metrics.width;
    const textHeight =
      (metrics.fontBoundingBoxAscent ?? fontsize * 0.8) +
      (metrics.fontBoundingBoxDescent ?? fontsize * 0.2);

    this.canvas.width = textWidth + padding * 2;
    this.canvas.height = textHeight + padding * 2;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.font = fontString;
    this.context.textAlign = textAlign;
    this.context.lineWidth = 0;
    this.context.fillStyle = `rgba(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b}, ${backgroundColor.a})`;
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.fillStyle = `rgba(${textColor.r}, ${textColor.g}, ${textColor.b}, ${textColor.a})`;
    this.context.fillText(message, padding + getTextAlignOffset(textAlign, textWidth), textHeight);
    return this.canvas;
  }
}
