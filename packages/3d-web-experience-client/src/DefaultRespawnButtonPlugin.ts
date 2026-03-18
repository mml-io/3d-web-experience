import type {
  Networked3dWebExperienceClient,
  UpdatableConfig,
} from "./Networked3dWebExperienceClient";
import type { UIPlugin } from "./plugins";

export class DefaultRespawnButtonPlugin implements UIPlugin {
  private client: Networked3dWebExperienceClient | null = null;
  private container: HTMLElement | null = null;
  private button: HTMLDivElement | null = null;

  mount(container: HTMLElement, client: Networked3dWebExperienceClient): void {
    this.client = client;
    this.container = container;
  }

  onConfigChanged(config: Partial<UpdatableConfig>): void {
    if (config.hud === undefined) return;
    const enabled = config.hud !== false && config.hud.respawnButton === true;
    if (enabled && !this.button) {
      this.show();
    } else if (!enabled && this.button) {
      this.hide();
    }
  }

  dispose(): void {
    this.hide();
    this.client = null;
    this.container = null;
  }

  private show(): void {
    if (this.button) return;
    this.button = document.createElement("div");
    this.button.textContent = "RESPAWN";
    Object.assign(this.button.style, {
      position: "absolute",
      top: "12px",
      left: "12px",
      zIndex: "102",
      padding: "12px",
      borderRadius: "8px",
      border: "1px solid rgba(255, 255, 255, 0.2)",
      color: "rgba(255, 255, 255, 0.9)",
      background: "linear-gradient(135deg, rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.4))",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif",
      fontSize: "14px",
      fontWeight: "500",
      letterSpacing: "0.5px",
      boxShadow: "0 4px 24px rgba(0, 0, 0, 0.4)",
      cursor: "pointer",
      transition: "all 0.2s ease-in-out",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      userSelect: "none",
    });

    this.button.addEventListener("mouseenter", () => {
      if (!this.button) return;
      this.button.style.background =
        "linear-gradient(135deg, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.6))";
      this.button.style.borderColor = "rgba(255, 255, 255, 0.3)";
      this.button.style.transform = "translateY(-1px)";
      this.button.style.boxShadow = "0 6px 28px rgba(0, 0, 0, 0.5)";
    });
    this.button.addEventListener("mouseleave", () => {
      if (!this.button) return;
      this.button.style.background =
        "linear-gradient(135deg, rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.4))";
      this.button.style.borderColor = "rgba(255, 255, 255, 0.2)";
      this.button.style.transform = "";
      this.button.style.boxShadow = "0 4px 24px rgba(0, 0, 0, 0.4)";
    });
    this.button.addEventListener("pointerdown", () => {
      if (!this.button) return;
      this.button.style.transform = "translateY(0)";
      this.button.style.boxShadow = "0 2px 12px rgba(0, 0, 0, 0.3)";
    });
    this.button.addEventListener("pointerup", () => {
      if (!this.button) return;
      this.button.style.transform = "translateY(-1px)";
      this.button.style.boxShadow = "0 6px 28px rgba(0, 0, 0, 0.5)";
    });

    this.button.addEventListener("click", () => {
      this.client?.respawn();
    });

    (this.container ?? document.body).appendChild(this.button);
  }

  private hide(): void {
    this.button?.remove();
    this.button = null;
  }
}
