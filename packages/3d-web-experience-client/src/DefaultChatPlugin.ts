import type { Networked3dWebExperienceClient } from "./Networked3dWebExperienceClient";
import type { UIPlugin } from "./plugins";

type ChatMessage = {
  id: number;
  username: string;
  message: string;
  distance: number | null;
  fromConnectionId: number;
  isLocal: boolean;
  timestamp: number;
};

const MAX_MESSAGES = 200;
const NEAR_DISTANCE = 10;
const FAR_DISTANCE = 100;
const FILTER_THRESHOLDS = [0, 15, 30, 60]; // 0 = off

const PASSIVE_MAX = 5;
const PASSIVE_LINGER_MS = 8000;
const PASSIVE_FADE_MS = 600;

const ACCENT = "#ffffff";
const PANEL_BG = "rgba(10, 14, 23, 0.85)";
const BORDER = "1px solid rgba(255,255,255,0.08)";
const BORDER_RADIUS = "8px";

function getDistanceColor(distance: number): string {
  if (distance <= 15) return "#ffffff";
  if (distance <= 50) return "#7a8ba6";
  return "#4a5568";
}

function getProximityOpacity(distance: number): number {
  if (distance <= NEAR_DISTANCE) return 1.0;
  if (distance >= FAR_DISTANCE) return 0.35;
  return 1.0 - ((distance - NEAR_DISTANCE) / (FAR_DISTANCE - NEAR_DISTANCE)) * 0.65;
}

function getProximityFontSize(distance: number): number {
  if (distance <= NEAR_DISTANCE) return 14;
  if (distance >= FAR_DISTANCE) return 11;
  return 14 - ((distance - NEAR_DISTANCE) / (FAR_DISTANCE - NEAR_DISTANCE)) * 3;
}

export class DefaultChatPlugin implements UIPlugin {
  private container: HTMLDivElement | null = null;
  private scrollStyle: HTMLStyleElement | null = null;
  private client: Networked3dWebExperienceClient | null = null;

  private messages: ChatMessage[] = [];
  private nextId = 0;
  private panelOpen = false;
  private unreadCount = 0;
  private filterIndex = 0;
  private proximityMode = false;
  private userScrolledUp = false;

  // DOM references
  private toggleBtn!: HTMLDivElement;
  private unreadBadge!: HTMLSpanElement;
  private passiveArea!: HTMLDivElement;
  private panel!: HTMLDivElement;
  private messageArea!: HTMLDivElement;
  private input!: HTMLInputElement;
  private filterPill!: HTMLSpanElement;
  private proxPill!: HTMLSpanElement;
  private globalKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private chatHandler: ((msg: any) => void) | null = null;

  mount(_container: HTMLElement, client: Networked3dWebExperienceClient): void {
    this.client = client;

    this.container = document.createElement("div");
    Object.assign(this.container.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "10001",
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      fontSize: "13px",
      color: "#e0e0e0",
    });
    _container.appendChild(this.container);

    this.buildToggleButton();
    this.buildPassiveArea();
    this.buildPanel();

    this.chatHandler = (msg) => {
      const distance = msg.isLocal ? 0 : this.calculateDistance(msg.fromConnectionId);
      this.addMessageToUI(msg.username, msg.message, distance, msg.fromConnectionId, msg.isLocal);
    };
    client.on("chat", this.chatHandler);
  }

  dispose(): void {
    if (this.globalKeydownHandler) {
      document.removeEventListener("keydown", this.globalKeydownHandler);
      this.globalKeydownHandler = null;
    }
    if (this.chatHandler && this.client) {
      this.client.off("chat", this.chatHandler);
      this.chatHandler = null;
    }
    this.scrollStyle?.remove();
    this.container?.remove();
    this.container = null;
    this.client = null;
  }

  private buildToggleButton(): void {
    this.toggleBtn = document.createElement("div");
    Object.assign(this.toggleBtn.style, {
      position: "absolute",
      bottom: "12px",
      left: "12px",
      width: "44px",
      height: "44px",
      borderRadius: "50%",
      background: PANEL_BG,
      border: BORDER,
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      pointerEvents: "auto",
      boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      transition: "all 0.15s ease",
      color: ACCENT,
      fontSize: "20px",
      userSelect: "none",
    });
    this.toggleBtn.textContent = "\u{1F4AC}";
    this.container!.appendChild(this.toggleBtn);

    this.unreadBadge = document.createElement("span");
    Object.assign(this.unreadBadge.style, {
      position: "absolute",
      top: "-4px",
      right: "-4px",
      background: ACCENT,
      color: "#0a0e17",
      fontSize: "10px",
      fontWeight: "700",
      borderRadius: "50%",
      width: "18px",
      height: "18px",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: "18px",
      textAlign: "center",
    });
    this.toggleBtn.appendChild(this.unreadBadge);

    this.toggleBtn.addEventListener("click", () => this.setPanelOpen(true));
  }

  private buildPassiveArea(): void {
    this.passiveArea = document.createElement("div");
    Object.assign(this.passiveArea.style, {
      position: "absolute",
      bottom: "64px",
      left: "12px",
      width: "360px",
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      pointerEvents: "none",
    });
    this.container!.appendChild(this.passiveArea);
  }

  private buildPanel(): void {
    this.panel = document.createElement("div");
    Object.assign(this.panel.style, {
      position: "absolute",
      bottom: "12px",
      left: "12px",
      width: "360px",
      maxHeight: "440px",
      display: "none",
      flexDirection: "column",
      background: PANEL_BG,
      border: BORDER,
      borderRadius: BORDER_RADIUS,
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      pointerEvents: "auto",
      overflow: "hidden",
    });
    this.container!.appendChild(this.panel);

    // Header
    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 12px",
      borderBottom: BORDER,
      flexShrink: "0",
    });
    this.panel.appendChild(header);

    const headerLeft = document.createElement("div");
    Object.assign(headerLeft.style, { display: "flex", alignItems: "center", gap: "10px" });
    header.appendChild(headerLeft);

    const chatLabel = document.createElement("span");
    chatLabel.textContent = "CHAT";
    Object.assign(chatLabel.style, {
      fontWeight: "600",
      fontSize: "12px",
      letterSpacing: "0.5px",
      textTransform: "uppercase",
      color: ACCENT,
    });
    headerLeft.appendChild(chatLabel);

    const headerRight = document.createElement("div");
    Object.assign(headerRight.style, { display: "flex", alignItems: "center", gap: "6px" });
    header.appendChild(headerRight);

    const pillBase: Record<string, string> = {
      fontSize: "10px",
      padding: "2px 8px",
      borderRadius: "4px",
      cursor: "pointer",
      userSelect: "none",
      transition: "all 0.15s ease",
      fontWeight: "600",
      letterSpacing: "0.3px",
    };

    this.filterPill = document.createElement("span");
    Object.assign(this.filterPill.style, {
      ...pillBase,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "transparent",
      color: "rgba(255,255,255,0.4)",
    });
    this.filterPill.textContent = "ALL";
    this.filterPill.title = "Filter by distance";
    headerRight.appendChild(this.filterPill);

    this.proxPill = document.createElement("span");
    Object.assign(this.proxPill.style, {
      ...pillBase,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "transparent",
      color: "rgba(255,255,255,0.4)",
    });
    this.proxPill.textContent = "PROX";
    this.proxPill.title = "Proximity prominence";
    headerRight.appendChild(this.proxPill);

    const closeBtn = document.createElement("span");
    Object.assign(closeBtn.style, {
      ...pillBase,
      border: "none",
      background: "transparent",
      color: "rgba(255,255,255,0.3)",
      fontSize: "14px",
      padding: "0 4px",
      cursor: "pointer",
      marginLeft: "4px",
    });
    closeBtn.textContent = "\u2715";
    closeBtn.title = "Close chat";
    headerRight.appendChild(closeBtn);

    // Message area
    this.messageArea = document.createElement("div");
    Object.assign(this.messageArea.style, {
      flex: "1",
      overflowY: "auto",
      padding: "4px 0",
      minHeight: "0",
      maxHeight: "340px",
    });
    this.scrollStyle = document.createElement("style");
    this.scrollStyle.textContent = `
      .default-chat-messages::-webkit-scrollbar { width: 4px; }
      .default-chat-messages::-webkit-scrollbar-track { background: transparent; }
      .default-chat-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
    `;
    document.head.appendChild(this.scrollStyle);
    this.messageArea.className = "default-chat-messages";
    this.panel.appendChild(this.messageArea);

    // Input area
    const inputArea = document.createElement("div");
    Object.assign(inputArea.style, {
      display: "flex",
      padding: "8px 12px",
      gap: "8px",
      borderTop: BORDER,
      flexShrink: "0",
    });
    this.panel.appendChild(inputArea);

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.placeholder = "Type a message...";
    this.input.maxLength = 500;
    Object.assign(this.input.style, {
      flex: "1",
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "6px",
      padding: "6px 10px",
      color: "#e0e0e0",
      fontSize: "13px",
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      outline: "none",
    });
    inputArea.appendChild(this.input);

    const sendBtn = document.createElement("button");
    sendBtn.textContent = "\u27A4";
    Object.assign(sendBtn.style, {
      background: ACCENT,
      border: "none",
      borderRadius: "6px",
      width: "32px",
      height: "32px",
      color: "#0a0e17",
      fontSize: "14px",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: "0",
      transition: "opacity 0.15s ease",
    });
    inputArea.appendChild(sendBtn);

    // Event handlers
    closeBtn.addEventListener("click", () => this.setPanelOpen(false));

    this.filterPill.addEventListener("click", () => {
      this.filterIndex = (this.filterIndex + 1) % FILTER_THRESHOLDS.length;
      this.updateFilterPill();
      this.rerenderMessages();
    });

    this.proxPill.addEventListener("click", () => {
      this.proximityMode = !this.proximityMode;
      this.updateProxPill();
      this.rerenderMessages();
    });

    this.messageArea.addEventListener("scroll", () => {
      const threshold = 30;
      const diff =
        this.messageArea.scrollHeight - this.messageArea.scrollTop - this.messageArea.clientHeight;
      this.userScrolledUp = diff >= threshold;
    });

    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && this.input.value.trim()) {
        this.sendMessage(this.input.value.trim());
        this.input.value = "";
      }
      if (e.key === "Escape") {
        this.input.blur();
        this.setPanelOpen(false);
      }
    });
    this.input.addEventListener("keyup", (e) => e.stopPropagation());
    this.input.addEventListener("keypress", (e) => e.stopPropagation());

    sendBtn.addEventListener("click", () => {
      if (this.input.value.trim()) {
        this.sendMessage(this.input.value.trim());
        this.input.value = "";
      }
      this.input.focus();
    });

    this.globalKeydownHandler = (e: KeyboardEvent) => {
      // Only capture Enter when no other input/textarea is focused, to avoid
      // interfering with other plugins (e.g. avatar name input).
      const active = document.activeElement;
      const isInputFocused =
        active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
      if (e.key === "Enter" && !isInputFocused) {
        e.preventDefault();
        if (!this.panelOpen) this.setPanelOpen(true);
        setTimeout(() => this.input.focus(), 0);
      }
    };
    document.addEventListener("keydown", this.globalKeydownHandler);
  }

  private sendMessage(text: string): void {
    this.client?.sendChatMessage(text);
  }

  private calculateDistance(fromConnectionId: number): number | null {
    if (!this.client) return null;
    const states = this.client.getCharacterStates();
    let localPos: { x: number; y: number; z: number } | null = null;
    let senderPos: { x: number; y: number; z: number } | null = null;
    for (const s of states.values()) {
      if (s.isLocal) localPos = s.position;
      if (s.connectionId === fromConnectionId) senderPos = s.position;
    }
    if (!localPos || !senderPos) return null;
    const dx = senderPos.x - localPos.x;
    const dz = senderPos.z - localPos.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  private setPanelOpen(open: boolean): void {
    this.panelOpen = open;
    this.panel.style.display = open ? "flex" : "none";
    this.toggleBtn.style.display = open ? "none" : "flex";
    this.passiveArea.style.display = open ? "none" : "flex";
    if (open) {
      this.unreadCount = 0;
      this.updateUnreadBadge();
      this.scrollToBottom(true);
    }
  }

  private updateUnreadBadge(): void {
    if (this.unreadCount > 0 && !this.panelOpen) {
      this.unreadBadge.textContent = this.unreadCount > 9 ? "9+" : String(this.unreadCount);
      this.unreadBadge.style.display = "flex";
    } else {
      this.unreadBadge.style.display = "none";
    }
  }

  private updateFilterPill(): void {
    const threshold = FILTER_THRESHOLDS[this.filterIndex];
    if (threshold === 0) {
      this.filterPill.textContent = "ALL";
      Object.assign(this.filterPill.style, {
        background: "transparent",
        color: "rgba(255,255,255,0.4)",
        borderColor: "rgba(255,255,255,0.08)",
      });
    } else {
      this.filterPill.textContent = `< ${threshold}m`;
      Object.assign(this.filterPill.style, {
        background: "rgba(255,255,255,0.08)",
        color: ACCENT,
        borderColor: "rgba(255,255,255,0.15)",
      });
    }
  }

  private updateProxPill(): void {
    if (this.proximityMode) {
      Object.assign(this.proxPill.style, {
        background: "rgba(255,255,255,0.08)",
        color: ACCENT,
        borderColor: "rgba(255,255,255,0.15)",
      });
    } else {
      Object.assign(this.proxPill.style, {
        background: "transparent",
        color: "rgba(255,255,255,0.4)",
        borderColor: "rgba(255,255,255,0.08)",
      });
    }
  }

  private shouldShowMessage(msg: ChatMessage): boolean {
    const threshold = FILTER_THRESHOLDS[this.filterIndex];
    if (threshold === 0) return true;
    if (msg.fromConnectionId === 0) return true;
    if (msg.isLocal) return true;
    if (msg.distance === null) return false;
    return msg.distance <= threshold;
  }

  private scrollToBottom(force = false): void {
    if (force || !this.userScrolledUp) {
      this.messageArea.scrollTop = this.messageArea.scrollHeight;
    }
  }

  private createMessageElement(msg: ChatMessage): HTMLElement {
    const row = document.createElement("div");
    Object.assign(row.style, {
      padding: "3px 12px",
      display: "flex",
      alignItems: "flex-start",
      gap: "8px",
      transition: "opacity 0.15s ease",
    });

    if (this.proximityMode && msg.distance !== null && msg.fromConnectionId !== 0) {
      row.style.opacity = String(getProximityOpacity(msg.distance));
      row.style.fontSize = `${getProximityFontSize(msg.distance)}px`;
    }

    const badge = document.createElement("span");
    Object.assign(badge.style, {
      fontSize: "9px",
      padding: "1px 5px",
      borderRadius: "4px",
      fontWeight: "600",
      flexShrink: "0",
      minWidth: "32px",
      textAlign: "center",
      lineHeight: "16px",
      marginTop: "2px",
    });

    if (msg.fromConnectionId === 0) {
      badge.textContent = "SYS";
      badge.style.color = "#f0c040";
      badge.style.background = "rgba(240,192,64,0.12)";
    } else if (msg.isLocal) {
      badge.textContent = "YOU";
      badge.style.color = ACCENT;
      badge.style.background = "rgba(255,255,255,0.08)";
    } else if (msg.distance !== null) {
      badge.textContent = `${Math.round(msg.distance)}m`;
      const c = getDistanceColor(msg.distance);
      badge.style.color = c;
      badge.style.background = c + "1f";
    } else {
      badge.textContent = "?";
      badge.style.color = "rgba(255,255,255,0.3)";
      badge.style.background = "rgba(255,255,255,0.05)";
    }
    row.appendChild(badge);

    const content = document.createElement("span");
    Object.assign(content.style, { wordBreak: "break-word", lineHeight: "1.4" });

    const usernameSpan = document.createElement("span");
    usernameSpan.textContent = msg.username;
    Object.assign(usernameSpan.style, {
      fontWeight: "600",
      color: msg.isLocal ? ACCENT : "#ffffff",
      marginRight: "6px",
    });
    content.appendChild(usernameSpan);
    content.appendChild(document.createTextNode(msg.message));
    row.appendChild(content);

    return row;
  }

  private rerenderMessages(): void {
    this.messageArea.innerHTML = "";
    for (const msg of this.messages) {
      const el = this.createMessageElement(msg);
      if (!this.shouldShowMessage(msg)) el.style.display = "none";
      this.messageArea.appendChild(el);
    }
    this.scrollToBottom(true);
  }

  private addPassiveMessage(msg: ChatMessage): void {
    const el = document.createElement("div");
    Object.assign(el.style, {
      padding: "3px 10px",
      background: "rgba(10, 14, 23, 0.6)",
      borderRadius: "6px",
      fontSize: "13px",
      lineHeight: "1.4",
      opacity: "0",
      transition: `opacity ${PASSIVE_FADE_MS}ms ease`,
      whiteSpace: "normal",
      wordBreak: "break-word",
    });

    const usernameSpan = document.createElement("span");
    usernameSpan.textContent = msg.username;
    Object.assign(usernameSpan.style, {
      fontWeight: "600",
      color: msg.isLocal ? ACCENT : "#ffffff",
      marginRight: "6px",
    });
    el.appendChild(usernameSpan);
    el.appendChild(document.createTextNode(msg.message));

    this.passiveArea.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = "0.9";
    });

    while (this.passiveArea.children.length > PASSIVE_MAX) {
      this.passiveArea.removeChild(this.passiveArea.firstChild!);
    }

    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => {
        if (el.parentNode === this.passiveArea) this.passiveArea.removeChild(el);
      }, PASSIVE_FADE_MS);
    }, PASSIVE_LINGER_MS);
  }

  private addMessageToUI(
    username: string,
    message: string,
    distance: number | null,
    fromConnectionId: number,
    isLocal: boolean,
  ): void {
    const msg: ChatMessage = {
      id: this.nextId++,
      username,
      message,
      distance,
      fromConnectionId,
      isLocal,
      timestamp: Date.now(),
    };

    this.messages.push(msg);
    if (this.messages.length > MAX_MESSAGES) {
      this.messages.shift();
      if (this.messageArea.firstChild) this.messageArea.removeChild(this.messageArea.firstChild);
    }

    const el = this.createMessageElement(msg);
    if (!this.shouldShowMessage(msg)) el.style.display = "none";
    this.messageArea.appendChild(el);
    this.scrollToBottom();

    if (!this.panelOpen) {
      this.unreadCount++;
      this.updateUnreadBadge();
      this.addPassiveMessage(msg);
    }
  }
}
