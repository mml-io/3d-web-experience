import type { AvatarType } from "./AvatarType";
import type { Networked3dWebExperienceClient } from "./Networked3dWebExperienceClient";
import type { UIPlugin } from "./plugins";

const ACCENT = "#ffffff";
const PANEL_BG = "rgba(10, 14, 23, 0.85)";
const BORDER = "1px solid rgba(255,255,255,0.08)";
const BORDER_RADIUS = "8px";

enum CustomAvatarType {
  meshFileUrl = "meshFileUrl",
  mmlUrl = "mmlUrl",
  mml = "mml",
}

export class DefaultAvatarSelectionPlugin implements UIPlugin {
  private container: HTMLDivElement | null = null;
  private scrollStyle: HTMLStyleElement | null = null;
  private client: Networked3dWebExperienceClient | null = null;

  private panelOpen = false;
  private selectedIndex = -1;
  private avatars: AvatarType[] = [];
  private allowCustomAvatars = false;
  private allowCustomDisplayName = false;
  private customAvatarType: CustomAvatarType = CustomAvatarType.mmlUrl;

  // DOM references
  private toggleBtn!: HTMLDivElement;
  private panel!: HTMLDivElement;
  private grid!: HTMLDivElement;
  private nameInput: HTMLInputElement | null = null;
  private customInput: HTMLInputElement | HTMLTextAreaElement | null = null;
  private customSection: HTMLDivElement | null = null;
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;

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
    this.buildPanel();
  }

  onConfigChanged(config: Record<string, unknown>): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfg = config as any;
    let needsRebuild = false;
    if (cfg.avatarConfiguration) {
      this.avatars = (cfg.avatarConfiguration.availableAvatars ?? []) as AvatarType[];
      this.allowCustomAvatars = cfg.avatarConfiguration.allowCustomAvatars ?? false;
      needsRebuild = true;
    }
    if (cfg.allowCustomDisplayName !== undefined) {
      this.allowCustomDisplayName = cfg.allowCustomDisplayName || false;
      needsRebuild = true;
    }
    if (needsRebuild) {
      this.rebuildPanel();
    }
  }

  dispose(): void {
    if (this.escapeHandler) {
      document.removeEventListener("keydown", this.escapeHandler);
      this.escapeHandler = null;
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
      top: "12px",
      right: "12px",
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
    this.toggleBtn.textContent = "\u{1F464}";
    this.toggleBtn.title = "Avatar & Display Name";
    this.container!.appendChild(this.toggleBtn);

    this.toggleBtn.addEventListener("click", () => this.setPanelOpen(true));
  }

  private rebuildPanel(): void {
    const wasOpen = this.panelOpen;
    this.panel.remove();
    this.scrollStyle?.remove();
    this.buildPanel();
    if (wasOpen) this.setPanelOpen(true);
  }

  private buildPanel(): void {
    this.panel = document.createElement("div");
    Object.assign(this.panel.style, {
      position: "absolute",
      top: "12px",
      right: "12px",
      width: "340px",
      maxHeight: "calc(100vh - 24px)",
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

    const headerLabel = document.createElement("span");
    headerLabel.textContent = "AVATAR";
    Object.assign(headerLabel.style, {
      fontWeight: "600",
      fontSize: "12px",
      letterSpacing: "0.5px",
      textTransform: "uppercase",
      color: ACCENT,
    });
    header.appendChild(headerLabel);

    const closeBtn = document.createElement("span");
    Object.assign(closeBtn.style, {
      fontSize: "14px",
      color: "rgba(255,255,255,0.3)",
      cursor: "pointer",
      padding: "0 4px",
      userSelect: "none",
    });
    closeBtn.textContent = "\u2715";
    closeBtn.title = "Close";
    header.appendChild(closeBtn);
    closeBtn.addEventListener("click", () => this.setPanelOpen(false));

    // Display name input (conditional)
    this.nameInput = null;
    if (this.allowCustomDisplayName) {
      const nameSection = document.createElement("div");
      Object.assign(nameSection.style, {
        padding: "8px 12px",
        borderBottom: BORDER,
        flexShrink: "0",
      });
      this.panel.appendChild(nameSection);

      const nameLabel = document.createElement("div");
      nameLabel.textContent = "Display Name";
      Object.assign(nameLabel.style, {
        fontSize: "10px",
        fontWeight: "600",
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.4)",
        marginBottom: "6px",
      });
      nameSection.appendChild(nameLabel);

      this.nameInput = document.createElement("input");
      this.nameInput.type = "text";
      this.nameInput.placeholder = "Enter display name...";
      this.nameInput.maxLength = 30;
      Object.assign(this.nameInput.style, {
        width: "100%",
        boxSizing: "border-box",
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "6px",
        padding: "6px 10px",
        color: "#e0e0e0",
        fontSize: "13px",
        fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
        outline: "none",
      });
      nameSection.appendChild(this.nameInput);

      this.nameInput.addEventListener("keydown", (e) => e.stopPropagation());
      this.nameInput.addEventListener("keyup", (e) => e.stopPropagation());
      this.nameInput.addEventListener("keypress", (e) => e.stopPropagation());
    }

    // Avatar grid
    const gridScroll = document.createElement("div");
    Object.assign(gridScroll.style, {
      flex: "1",
      overflowY: "auto",
      padding: "8px",
      minHeight: "0",
    });
    this.scrollStyle = document.createElement("style");
    this.scrollStyle.textContent = `
      .default-avatar-grid::-webkit-scrollbar { width: 4px; }
      .default-avatar-grid::-webkit-scrollbar-track { background: transparent; }
      .default-avatar-grid::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
    `;
    document.head.appendChild(this.scrollStyle);
    gridScroll.className = "default-avatar-grid";
    this.panel.appendChild(gridScroll);

    this.grid = document.createElement("div");
    Object.assign(this.grid.style, {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(70px, 1fr))",
      gap: "6px",
    });
    gridScroll.appendChild(this.grid);

    // Custom avatar section (conditional)
    this.customInput = null;
    this.customSection = null;
    if (this.allowCustomAvatars) {
      this.customSection = document.createElement("div");
      Object.assign(this.customSection.style, {
        padding: "8px 12px",
        borderTop: BORDER,
        flexShrink: "0",
      });
      this.panel.appendChild(this.customSection);

      const customLabel = document.createElement("div");
      customLabel.textContent = "Custom Avatar";
      Object.assign(customLabel.style, {
        fontSize: "10px",
        fontWeight: "600",
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.4)",
        marginBottom: "6px",
      });
      this.customSection.appendChild(customLabel);

      this.buildCustomAvatarTypeSelector(this.customSection);
      this.buildCustomAvatarInput(this.customSection);
    }

    // Apply button
    const applyArea = document.createElement("div");
    Object.assign(applyArea.style, {
      padding: "8px 12px",
      borderTop: BORDER,
      flexShrink: "0",
    });
    this.panel.appendChild(applyArea);

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "Apply";
    Object.assign(applyBtn.style, {
      width: "100%",
      background: ACCENT,
      border: "none",
      borderRadius: "6px",
      padding: "8px",
      color: "#0a0e17",
      fontSize: "13px",
      fontWeight: "600",
      cursor: "pointer",
      transition: "opacity 0.15s ease",
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    });
    applyArea.appendChild(applyBtn);
    applyBtn.addEventListener("click", () => this.applyChanges());

    // Escape to close
    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.panelOpen) this.setPanelOpen(false);
    };
    document.addEventListener("keydown", this.escapeHandler);

    this.renderGrid();
  }

  private renderGrid(): void {
    this.grid.innerHTML = "";

    this.avatars.forEach((avatar, idx) => {
      const cell = document.createElement("div");
      const isSelected = idx === this.selectedIndex;
      Object.assign(cell.style, {
        aspectRatio: "1",
        borderRadius: "6px",
        border: isSelected ? `2px solid ${ACCENT}` : "2px solid rgba(255,255,255,0.06)",
        background: isSelected ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        transition: "all 0.1s ease",
        position: "relative",
      });

      if (avatar.thumbnailUrl) {
        const img = document.createElement("img");
        img.src = avatar.thumbnailUrl;
        Object.assign(img.style, {
          width: "100%",
          height: "100%",
          objectFit: "cover",
          borderRadius: "4px",
        });
        img.onerror = () => {
          img.remove();
          this.addTextLabel(cell, avatar, idx);
        };
        cell.appendChild(img);
      } else {
        this.addTextLabel(cell, avatar, idx);
      }

      cell.addEventListener("click", () => {
        this.selectedIndex = idx;
        this.renderGrid();
      });
      cell.addEventListener("mouseenter", () => {
        if (idx !== this.selectedIndex) {
          cell.style.borderColor = "rgba(255,255,255,0.15)";
          cell.style.background = "rgba(255,255,255,0.06)";
        }
      });
      cell.addEventListener("mouseleave", () => {
        if (idx !== this.selectedIndex) {
          cell.style.borderColor = "rgba(255,255,255,0.06)";
          cell.style.background = "rgba(255,255,255,0.04)";
        }
      });

      this.grid.appendChild(cell);
    });
  }

  private buildCustomAvatarTypeSelector(parent: HTMLElement): void {
    const radioGroup = document.createElement("div");
    Object.assign(radioGroup.style, {
      display: "flex",
      gap: "12px",
      marginBottom: "8px",
    });
    parent.appendChild(radioGroup);

    const types: { type: CustomAvatarType; label: string }[] = [
      { type: CustomAvatarType.mmlUrl, label: "MML URL" },
      { type: CustomAvatarType.mml, label: "MML" },
      { type: CustomAvatarType.meshFileUrl, label: "Mesh URL" },
    ];

    for (const { type, label } of types) {
      const item = document.createElement("label");
      Object.assign(item.style, {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        cursor: "pointer",
        fontSize: "12px",
        color: "rgba(255,255,255,0.7)",
      });

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "default-avatar-custom-type";
      radio.checked = this.customAvatarType === type;
      radio.addEventListener("change", () => {
        this.customAvatarType = type;
        this.rebuildCustomInput();
      });

      item.appendChild(radio);
      item.appendChild(document.createTextNode(label));
      radioGroup.appendChild(item);
    }
  }

  private getCustomPlaceholder(): string {
    switch (this.customAvatarType) {
      case CustomAvatarType.meshFileUrl:
        return "https://example.com/avatar.glb";
      case CustomAvatarType.mmlUrl:
        return "https://example.com/avatar.html";
      case CustomAvatarType.mml:
        return '<m-character src="https://...">\n</m-character>';
    }
  }

  private buildCustomAvatarInput(parent: HTMLElement): void {
    const inputStyle: Partial<CSSStyleDeclaration> = {
      width: "100%",
      boxSizing: "border-box",
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "6px",
      padding: "6px 10px",
      color: "#e0e0e0",
      fontSize: "12px",
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      outline: "none",
      resize: "vertical",
    };

    if (this.customAvatarType === CustomAvatarType.mml) {
      const textarea = document.createElement("textarea");
      textarea.rows = 4;
      textarea.placeholder = this.getCustomPlaceholder();
      Object.assign(textarea.style, inputStyle);
      this.customInput = textarea;
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = this.getCustomPlaceholder();
      Object.assign(input.style, inputStyle);
      this.customInput = input;
    }

    this.customInput.addEventListener("input", () => {
      if (this.customInput!.value.trim()) {
        this.selectedIndex = -1;
        this.renderGrid();
      }
    });
    this.customInput.addEventListener("keydown", (e) => e.stopPropagation());
    this.customInput.addEventListener("keyup", (e) => e.stopPropagation());
    this.customInput.addEventListener("keypress", (e) => e.stopPropagation());

    parent.appendChild(this.customInput);
  }

  private rebuildCustomInput(): void {
    if (!this.customSection) return;
    // Remove old input
    this.customInput?.remove();
    this.buildCustomAvatarInput(this.customSection);
  }

  private addTextLabel(cell: HTMLElement, avatar: AvatarType, idx: number): void {
    const label = document.createElement("span");
    label.textContent = avatar.name || `#${idx + 1}`;
    Object.assign(label.style, {
      fontSize: "10px",
      color: "rgba(255,255,255,0.5)",
      textAlign: "center",
      padding: "4px",
      wordBreak: "break-word",
    });
    cell.appendChild(label);
  }

  private setPanelOpen(open: boolean): void {
    this.panelOpen = open;
    this.panel.style.display = open ? "flex" : "none";
    this.toggleBtn.style.display = open ? "none" : "flex";
    if (open) this.syncCurrentState();
  }

  private syncCurrentState(): void {
    if (!this.client) return;
    const connectionId = this.client.getConnectionId();
    if (connectionId === null) return;
    const profile = this.client.getUserProfile(connectionId);
    if (!profile) return;

    if (this.nameInput && profile.username) {
      this.nameInput.value = profile.username;
    }

    const desc = profile.characterDescription;
    this.selectedIndex = this.avatars.findIndex(
      (a) =>
        (a.meshFileUrl && a.meshFileUrl === desc?.meshFileUrl) ||
        (a.mmlCharacterUrl && a.mmlCharacterUrl === desc?.mmlCharacterUrl) ||
        (a.mmlCharacterString && a.mmlCharacterString === desc?.mmlCharacterString),
    );

    if (this.customInput && this.selectedIndex === -1 && desc) {
      if (desc.mmlCharacterString) {
        this.customAvatarType = CustomAvatarType.mml;
        this.rebuildCustomInput();
        this.customInput.value = desc.mmlCharacterString;
      } else if (desc.mmlCharacterUrl) {
        this.customAvatarType = CustomAvatarType.mmlUrl;
        this.rebuildCustomInput();
        this.customInput.value = desc.mmlCharacterUrl;
      } else if (desc.meshFileUrl) {
        this.customAvatarType = CustomAvatarType.meshFileUrl;
        this.rebuildCustomInput();
        this.customInput.value = desc.meshFileUrl;
      }
    }
    this.renderGrid();
  }

  private applyChanges(): void {
    if (!this.client) return;

    // Determine avatar
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let characterDescription: Record<string, any> | null = null;
    if (this.selectedIndex >= 0 && this.selectedIndex < this.avatars.length) {
      const avatar = this.avatars[this.selectedIndex];
      if (avatar.meshFileUrl) {
        characterDescription = { meshFileUrl: avatar.meshFileUrl };
      } else if (avatar.mmlCharacterUrl) {
        characterDescription = { mmlCharacterUrl: avatar.mmlCharacterUrl };
      } else if (avatar.mmlCharacterString) {
        characterDescription = { mmlCharacterString: avatar.mmlCharacterString };
      }
    } else if (this.customInput?.value.trim()) {
      const value = this.customInput.value.trim();
      switch (this.customAvatarType) {
        case CustomAvatarType.mml:
          characterDescription = { mmlCharacterString: value };
          break;
        case CustomAvatarType.mmlUrl:
          characterDescription = { mmlCharacterUrl: value };
          break;
        case CustomAvatarType.meshFileUrl:
          characterDescription = { meshFileUrl: value };
          break;
      }
    }

    if (characterDescription) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client.selectAvatar(characterDescription as any);
    }

    // Update display name
    if (this.nameInput) {
      const newName = this.nameInput.value.trim();
      if (newName) this.client.setDisplayName(newName);
    }

    this.setPanelOpen(false);
  }
}
