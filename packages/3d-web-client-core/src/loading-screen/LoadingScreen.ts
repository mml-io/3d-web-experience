import { LoadingProgressManager } from "mml-web";

export type LoadingScreenConfig = {
  background?: string;
  backgroundImageUrl?: string;
  backgroundBlurAmount?: number;
  overlayLayers?: Array<{
    overlayImageUrl: string;
    overlayAnchor: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    overlayOffset?: { x: number; y: number };
  }>;
  title?: string;
  subtitle?: string;
  color?: string;
};

export class LoadingScreen {
  public readonly element: HTMLDivElement;

  private readonly backgroundBlur: HTMLDivElement;

  private overlayLayers: HTMLDivElement[] = [];

  private loadingBannerText: HTMLDivElement;
  private loadingBannerSubtitle: HTMLDivElement;

  private progressBarBackground: HTMLDivElement;
  private progressBarHolder: HTMLDivElement;
  private progressBar: HTMLDivElement;
  private loadingStatusText: HTMLDivElement;

  private progressDebugViewHolder: HTMLDivElement;
  private progressDebugView: HTMLDivElement;
  private progressDebugElement: HTMLPreElement;

  private debugLabel: HTMLLabelElement;
  private debugCheckbox: HTMLInputElement;

  private hasCompleted = false;
  private loadingCallback: () => void;
  private disposed: boolean = false;

  constructor(
    private loadingProgressManager: LoadingProgressManager,
    private config?: LoadingScreenConfig,
  ) {
    const defaultBackground = "linear-gradient(45deg, #28284B 0%, #303056 100%)";
    this.element = document.createElement("div");
    this.element.id = "loading-screen";

    this.element.style.position = "absolute";
    this.element.style.top = "0";
    this.element.style.left = "0";
    this.element.style.width = "100%";
    this.element.style.height = "100%";
    this.element.style.backgroundColor = this.config?.background || defaultBackground;
    this.element.style.background = this.config?.background || defaultBackground;
    this.element.style.zIndex = "10001";

    this.backgroundBlur = document.createElement("div");
    this.backgroundBlur.id = "loading-screen-blur";
    this.backgroundBlur.style.position = "absolute";
    this.backgroundBlur.style.top = "0";
    this.backgroundBlur.style.left = "0";
    this.backgroundBlur.style.width = "100%";
    this.backgroundBlur.style.height = "100%";
    this.backgroundBlur.style.display = "flex";
    if (this.config?.backgroundBlurAmount) {
      this.backgroundBlur.style.backdropFilter = `blur(${this.config.backgroundBlurAmount}px)`;
    }
    this.element.append(this.backgroundBlur);

    if (this.config?.backgroundImageUrl) {
      this.element.style.backgroundImage = `url(${this.config.backgroundImageUrl})`;
      this.element.style.backgroundPosition = "center";
      this.element.style.backgroundSize = "cover";
    }

    if (this.config?.overlayLayers) {
      const logLoadError = (imageUrl: string) => {
        console.error(`Failed to load overlay image: ${imageUrl}`);
      };

      console.log("Overlay layers", this.config.overlayLayers);
      let overlayZIndex = 10002;
      for (const layer of this.config.overlayLayers) {
        const overlayLayer = document.createElement("div");
        overlayLayer.id = `loading-screen-overlay-${overlayZIndex}`;
        overlayLayer.style.position = "absolute";
        overlayLayer.style.background = `url(${layer.overlayImageUrl}) no-repeat`;
        overlayLayer.style.backgroundSize = "contain";

        const anchor = layer.overlayAnchor;
        const offsetX = layer.overlayOffset?.x || 0;
        const offsetY = layer.overlayOffset?.y || 0;

        if (anchor.includes("top")) {
          overlayLayer.style.top = `${offsetY}px`;
        } else if (anchor.includes("bottom")) {
          overlayLayer.style.bottom = `${offsetY}px`;
        }

        if (anchor.includes("left")) {
          overlayLayer.style.left = `${offsetX}px`;
        } else if (anchor.includes("right")) {
          overlayLayer.style.right = `${offsetX}px`;
        }

        const image = new Image();
        image.src = layer.overlayImageUrl;
        image.onload = () => {
          const naturalWidth = image.naturalWidth;
          const naturalHeight = image.naturalHeight;

          overlayLayer.style.width = `${naturalWidth}px`;
          overlayLayer.style.height = `${naturalHeight}px`;
        };

        image.onerror = () => logLoadError(layer.overlayImageUrl);

        overlayLayer.style.zIndex = `${overlayZIndex}`;
        this.overlayLayers.push(overlayLayer);
        this.backgroundBlur.append(overlayLayer);
        overlayZIndex++;
      }
    }

    this.element.style.color = this.config?.color || "white";

    this.loadingBannerText = document.createElement("div");
    if (this.config?.title) {
      this.loadingBannerText.textContent = this.config.title;
    }
    this.loadingBannerText.style.position = "absolute";
    this.loadingBannerText.style.display = "flex";
    this.loadingBannerText.style.flexDirection = "column";
    this.loadingBannerText.style.left = "42px";
    this.loadingBannerText.style.bottom = "102px";
    this.loadingBannerText.style.width = "100%";
    this.loadingBannerText.style.height = "100%";
    this.loadingBannerText.style.color = this.config?.color || "white";
    this.loadingBannerText.style.fontSize = "3.8vw";
    this.loadingBannerText.style.fontWeight = "bold";
    this.loadingBannerText.style.fontFamily = "sans-serif";
    this.loadingBannerText.style.alignItems = "start";
    this.loadingBannerText.style.justifyContent = "flex-end";
    if (this.config?.background) {
      this.loadingBannerText.style.textShadow = `0px 0px 80px ${this.config.background}`;
    }
    this.backgroundBlur.append(this.loadingBannerText);

    this.loadingBannerSubtitle = document.createElement("div");
    this.loadingBannerSubtitle.style.maxWidth = "38.2%";
    this.loadingBannerSubtitle.style.width = "38.2%";
    this.loadingBannerSubtitle.style.color = this.config?.color || "white";
    this.loadingBannerSubtitle.style.fontSize = "1.3vw";
    this.loadingBannerSubtitle.style.fontWeight = "400";
    this.loadingBannerSubtitle.style.fontFamily = "sans-serif";
    this.loadingBannerSubtitle.style.marginTop = "12px";
    this.loadingBannerSubtitle.style.alignItems = "center";
    if (this.config?.background) {
      this.loadingBannerSubtitle.style.textShadow = `0px 0px 40px ${this.config.background}`;
    }

    if (this.config?.subtitle) {
      this.loadingBannerSubtitle.textContent = this.config.subtitle;
      this.loadingBannerText.append(this.loadingBannerSubtitle);
    }

    this.progressDebugViewHolder = document.createElement("div");
    this.progressDebugViewHolder.style.display = "none";
    this.progressDebugViewHolder.style.position = "absolute";
    this.progressDebugViewHolder.style.maxHeight = "calc(100% - 120px)";
    this.progressDebugViewHolder.style.left = "42px";
    this.progressDebugViewHolder.style.bottom = "60px";
    this.progressDebugViewHolder.style.width = "38.2%";
    this.progressDebugViewHolder.style.alignItems = "center";
    this.progressDebugViewHolder.style.justifyContent = "center";
    this.progressDebugViewHolder.style.zIndex = "10003";
    this.backgroundBlur.append(this.progressDebugViewHolder);

    this.progressDebugView = document.createElement("div");
    this.progressDebugView.style.backgroundColor = "rgba(128, 128, 128, 0.5)";
    this.progressDebugView.style.border = "1px solid black";
    this.progressDebugView.style.borderRadius = "7px";
    this.progressDebugView.style.width = "100%";
    this.progressDebugView.style.maxWidth = "100%";
    this.progressDebugView.style.overflow = "auto";
    this.progressDebugViewHolder.append(this.progressDebugView);

    this.debugCheckbox = document.createElement("input");
    this.debugCheckbox.type = "checkbox";
    this.debugCheckbox.checked = false;
    this.debugCheckbox.addEventListener("change", () => {
      this.progressDebugElement.style.display = this.debugCheckbox.checked ? "block" : "none";
      this.loadingBannerText.style.display = this.debugCheckbox.checked ? "none" : "flex";
      if (this.hasCompleted) {
        this.dispose();
      }
    });

    this.debugLabel = document.createElement("label");
    this.debugLabel.textContent = "Debug loading";
    this.debugLabel.style.fontFamily = "sans-serif";
    this.debugLabel.style.padding = "5px";
    this.debugLabel.style.display = "inline-block";
    this.debugLabel.style.userSelect = "none";
    this.debugLabel.append(this.debugCheckbox);
    this.progressDebugView.append(this.debugLabel);

    this.progressDebugElement = document.createElement("pre");
    this.progressDebugElement.style.margin = "0";
    this.progressDebugElement.style.display = this.debugCheckbox.checked ? "block" : "none";
    this.progressDebugView.append(this.progressDebugElement);

    this.progressBarHolder = document.createElement("div");
    this.progressBarHolder.style.display = "flex";
    this.progressBarHolder.style.alignItems = "start";
    this.progressBarHolder.style.justifyContent = "flex-start";
    this.progressBarHolder.style.position = "absolute";
    this.progressBarHolder.style.bottom = "42px";
    this.progressBarHolder.style.left = "42px";
    this.progressBarHolder.style.width = "100%";
    this.progressBarHolder.style.cursor = "pointer";
    this.progressBarHolder.addEventListener("click", () => {
      const display = this.progressDebugViewHolder.style.display;
      if (display === "none") {
        this.progressDebugViewHolder.style.display = "flex";
      } else {
        this.progressDebugViewHolder.style.display = "none";
        this.debugCheckbox.checked = false;
        this.progressDebugElement.style.display = this.debugCheckbox.checked ? "block" : "none";
        this.loadingBannerText.style.display = this.debugCheckbox.checked ? "none" : "flex";
      }
    });
    this.element.append(this.progressBarHolder);

    this.progressBarBackground = document.createElement("div");
    this.progressBarBackground.style.position = "relative";
    this.progressBarBackground.style.width = "38.2%";
    this.progressBarBackground.style.maxWidth = "38.2%";
    this.progressBarBackground.style.backgroundColor = "gray";
    this.progressBarBackground.style.height = "12px";
    this.progressBarBackground.style.lineHeight = "12px";
    this.progressBarBackground.style.borderRadius = "12px";
    this.progressBarBackground.style.border = this.config?.background
      ? `2px solid ${this.config?.background}`
      : "2px solid white";
    this.progressBarBackground.style.overflow = "hidden";
    this.progressBarHolder.append(this.progressBarBackground);

    this.progressBar = document.createElement("div");
    this.progressBar.style.position = "absolute";
    this.progressBar.style.top = "0";
    this.progressBar.style.left = "0";
    this.progressBar.style.width = "0";
    this.progressBar.style.height = "100%";
    this.progressBar.style.backgroundColor = this.config?.color || "#0050a4";
    this.progressBarBackground.append(this.progressBar);

    this.loadingStatusText = document.createElement("div");
    this.loadingStatusText.style.position = "absolute";
    this.loadingStatusText.style.top = "0";
    this.loadingStatusText.style.left = "0";
    this.loadingStatusText.style.width = "100%";
    this.loadingStatusText.style.height = "100%";
    this.loadingStatusText.style.color = this.config?.background || "white";
    this.loadingStatusText.style.fontSize = "11px";
    this.loadingStatusText.style.textAlign = "center";
    this.loadingStatusText.style.verticalAlign = "middle";
    this.loadingStatusText.style.fontFamily = "sans-serif";
    this.loadingStatusText.style.fontWeight = "bold";
    this.loadingStatusText.style.userSelect = "none";
    this.loadingStatusText.textContent = "Loading...";
    this.progressBarBackground.append(this.loadingStatusText);

    this.loadingCallback = () => {
      const [loadingRatio, completedLoading] = this.loadingProgressManager.toRatio();
      if (completedLoading) {
        if (!this.hasCompleted) {
          this.hasCompleted = true;
          if (!this.debugCheckbox.checked) {
            this.dispose();
          }
        }
        this.loadingStatusText.textContent = "Completed";
        this.progressBar.style.width = "100%";
      } else {
        this.loadingStatusText.textContent = `${(loadingRatio * 100).toFixed(2)}%`;
        this.progressBar.style.width = `${loadingRatio * 100}%`;
      }
      this.progressDebugElement.textContent = LoadingProgressManager.LoadingProgressSummaryToString(
        this.loadingProgressManager.toSummary(),
      );
    };

    this.loadingProgressManager.addProgressCallback(this.loadingCallback);
  }

  public dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.loadingProgressManager.removeProgressCallback(this.loadingCallback);
    this.element.remove();
  }
}
