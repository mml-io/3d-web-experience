import type { Networked3dWebExperienceClient } from "./Networked3dWebExperienceClient";
import type { UIPlugin } from "./plugins";

type CharacterState = {
  connectionId: number;
  userId: string;
  position: { x: number; y: number; z: number };
  username: string;
  isLocal: boolean;
};

type GetCharacterStates = () => Map<number, CharacterState>;

const WORLD_HALF = 105;
const MINIMAP_SIZE = 180;
const VIEW_RADIUS = WORLD_HALF;
const GRID_SPACING = 30;
const PLAYER_LIST_UPDATE_MS = 500;
const MINIMAP_UPDATE_MS = 100;

const ACCENT = "#ffffff";
const PANEL_BG = "rgba(10, 14, 23, 0.85)";
const BORDER = "1px solid rgba(255,255,255,0.08)";
const BORDER_RADIUS = "8px";

export type DefaultHUDPluginOptions = {
  minimap?: boolean;
  playerList?: boolean;
};

function createHUD(
  mountTarget: HTMLElement,
  client: Networked3dWebExperienceClient,
  options: DefaultHUDPluginOptions = {},
): { dispose: () => void } {
  const showMinimap = options.minimap !== false;
  const showPlayerList = options.playerList !== false;

  const getCharacterStates: GetCharacterStates = () => client.getCharacterStates();

  /**
   * Compute the camera's orbit angle around the local character by looking at
   * the vector from the character to the camera position. This gives the
   * direction the camera is looking FROM, which is what the minimap needs to
   * orient correctly.
   */
  const getCameraYaw = (): number => {
    const camPos = client.getCameraManager().getCameraPosition();
    const states = getCharacterStates();
    const local = Array.from(states.values()).find((p) => p.isLocal);
    if (!local) return 0;
    return Math.atan2(camPos.x - local.position.x, camPos.z - local.position.z);
  };

  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "10000",
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    fontSize: "13px",
    color: "#e0e0e0",
  });
  mountTarget.appendChild(container);

  const SMALL_SCREEN_PX = 768;

  // Bottom-right group: toggle button + player list + minimap
  const group = document.createElement("div");
  Object.assign(group.style, {
    position: "absolute",
    bottom: "12px",
    right: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    pointerEvents: "none",
    alignItems: "flex-end",
  });
  container.appendChild(group);

  // --- HUD toggle (visible on small screens, or when manually collapsed) ---
  let hudExpanded = window.innerWidth >= SMALL_SCREEN_PX;

  const hudToggle = document.createElement("div");
  Object.assign(hudToggle.style, {
    width: "36px",
    height: "36px",
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
    fontSize: "14px",
    color: ACCENT,
    userSelect: "none",
    flexShrink: "0",
  });
  hudToggle.title = "Toggle HUD";
  hudToggle.textContent = "\u{1F5FA}"; // map emoji
  group.appendChild(hudToggle);

  // Content wrapper for the collapsible panels
  const hudContent = document.createElement("div");
  Object.assign(hudContent.style, {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    pointerEvents: "none",
  });
  group.appendChild(hudContent);

  function setHudExpanded(expanded: boolean) {
    hudExpanded = expanded;
    hudContent.style.display = expanded ? "flex" : "none";
    hudToggle.style.display = expanded && window.innerWidth >= SMALL_SCREEN_PX ? "none" : "flex";
  }

  hudToggle.addEventListener("click", () => setHudExpanded(!hudExpanded));
  const resizeHandler = () => {
    const isSmall = window.innerWidth < SMALL_SCREEN_PX;
    // Show the toggle button on small screens even when expanded (so user can collapse)
    hudToggle.style.display = !hudExpanded || isSmall ? "flex" : "none";
  };
  window.addEventListener("resize", resizeHandler);
  setHudExpanded(hudExpanded);

  // =========================================================
  // Player List
  // =========================================================
  let highlightedPlayerId: number | null = null;
  let playerListInterval: ReturnType<typeof setInterval> | null = null;

  if (showPlayerList) {
    const playerList = document.createElement("div");
    Object.assign(playerList.style, {
      width: `${MINIMAP_SIZE}px`,
      background: PANEL_BG,
      border: BORDER,
      borderRadius: BORDER_RADIUS,
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      pointerEvents: "auto",
      overflow: "hidden",
      boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
    });
    hudContent.appendChild(playerList);

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 12px",
      cursor: "pointer",
      userSelect: "none",
      borderBottom: BORDER,
    });
    playerList.appendChild(header);

    const headerTitle = document.createElement("span");
    headerTitle.textContent = "Players (0)";
    Object.assign(headerTitle.style, {
      fontWeight: "600",
      fontSize: "12px",
      letterSpacing: "0.5px",
      textTransform: "uppercase",
      color: ACCENT,
    });
    header.appendChild(headerTitle);

    const chevron = document.createElement("span");
    chevron.textContent = "\u25B2";
    Object.assign(chevron.style, {
      fontSize: "10px",
      color: "rgba(255,255,255,0.4)",
      transition: "transform 0.2s ease",
    });
    header.appendChild(chevron);

    const listBody = document.createElement("div");
    // Reserve space for: bottom margin (16px) + minimap (180px) + gap (6px) +
    // player list header (~38px) + top/bottom border (2px) + some breathing room
    const reservedPx = 16 + MINIMAP_SIZE + 6 + 40 + 2 + 16;
    Object.assign(listBody.style, {
      maxHeight: `calc(100vh - ${reservedPx}px)`,
      overflowY: "auto",
      padding: "4px 0",
    });
    playerList.appendChild(listBody);

    let collapsed = false;
    header.addEventListener("click", () => {
      collapsed = !collapsed;
      listBody.style.display = collapsed ? "none" : "block";
      chevron.style.transform = collapsed ? "rotate(180deg)" : "rotate(0deg)";
      if (collapsed) highlightedPlayerId = null;
    });

    listBody.addEventListener("mouseleave", () => {
      highlightedPlayerId = null;
    });

    function updatePlayerList() {
      const states = getCharacterStates();
      const players = Array.from(states.values()).sort((a, b) => {
        if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
        return (a.username || "").localeCompare(b.username || "");
      });

      headerTitle.textContent = `Players (${players.length})`;

      const names = players
        .map((p) => `${p.connectionId}:${p.username || ""}:${p.isLocal}`)
        .join(",");
      if (listBody.dataset.hash === names) return;
      listBody.dataset.hash = names;

      listBody.innerHTML = "";
      for (const player of players) {
        const row = document.createElement("div");
        Object.assign(row.style, {
          padding: "5px 12px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          cursor: player.isLocal ? "default" : "pointer",
          transition: "background 0.1s ease",
        });

        if (!player.isLocal) {
          row.addEventListener("mouseenter", () => {
            highlightedPlayerId = player.connectionId;
            row.style.background = "rgba(255,255,255,0.06)";
          });
          row.addEventListener("mouseleave", () => {
            highlightedPlayerId = null;
            row.style.background = "";
          });
          row.addEventListener("click", () => {
            // Rotate the camera to face the clicked player
            const currentStates = getCharacterStates();
            const local = Array.from(currentStates.values()).find((p) => p.isLocal);
            const target = currentStates.get(player.connectionId);
            if (local && target) {
              const dx = target.position.x - local.position.x;
              const dz = target.position.z - local.position.z;
              const angleToTarget = Math.atan2(dz, dx);
              client.getCameraManager().setOrbitAngle(angleToTarget + Math.PI);
            }
          });
        }

        const dot = document.createElement("span");
        Object.assign(dot.style, {
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: player.isLocal ? ACCENT : "#7a8ba6",
          flexShrink: "0",
        });
        row.appendChild(dot);

        const name = document.createElement("span");
        name.textContent = player.username || "Unknown";
        Object.assign(name.style, {
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: player.isLocal ? "#ffffff" : "#b0bec5",
          fontWeight: player.isLocal ? "600" : "400",
          fontSize: "12px",
        });
        row.appendChild(name);

        if (player.isLocal) {
          const youBadge = document.createElement("span");
          youBadge.textContent = "you";
          Object.assign(youBadge.style, {
            fontSize: "9px",
            color: ACCENT,
            background: "rgba(255,255,255,0.08)",
            padding: "1px 5px",
            borderRadius: "4px",
            marginLeft: "auto",
            fontWeight: "600",
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            flexShrink: "0",
          });
          row.appendChild(youBadge);
        }

        listBody.appendChild(row);
      }
    }

    playerListInterval = setInterval(updatePlayerList, PLAYER_LIST_UPDATE_MS);
    updatePlayerList();
  }

  // =========================================================
  // Minimap
  // =========================================================
  let minimapRafId: number | null = null;

  if (showMinimap) {
    let cameraOriented = true;

    const minimapContainer = document.createElement("div");
    Object.assign(minimapContainer.style, {
      position: "relative",
      width: `${MINIMAP_SIZE}px`,
      height: `${MINIMAP_SIZE}px`,
      background: PANEL_BG,
      border: BORDER,
      borderRadius: BORDER_RADIUS,
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      pointerEvents: "auto",
      overflow: "hidden",
      boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
    });
    hudContent.appendChild(minimapContainer);

    const canvas = document.createElement("canvas");
    canvas.width = MINIMAP_SIZE * 2;
    canvas.height = MINIMAP_SIZE * 2;
    Object.assign(canvas.style, {
      width: `${MINIMAP_SIZE}px`,
      height: `${MINIMAP_SIZE}px`,
      display: "block",
    });
    minimapContainer.appendChild(canvas);

    const ctx = canvas.getContext("2d")!;
    const S = canvas.width;
    const C = S / 2;
    let frameScale = S / (VIEW_RADIUS * 2);

    // Orientation toggle
    const toggleBtn = document.createElement("div");
    Object.assign(toggleBtn.style, {
      position: "absolute",
      top: "6px",
      right: "6px",
      width: "22px",
      height: "22px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(255,255,255,0.08)",
      borderRadius: "4px",
      cursor: "pointer",
      userSelect: "none",
      fontSize: "11px",
      fontWeight: "700",
      color: ACCENT,
      zIndex: "2",
      lineHeight: "1",
    });
    toggleBtn.title = "Toggle north-oriented / camera-oriented";
    toggleBtn.textContent = "C";
    minimapContainer.appendChild(toggleBtn);

    toggleBtn.addEventListener("click", () => {
      cameraOriented = !cameraOriented;
      toggleBtn.textContent = cameraOriented ? "C" : "N";
    });

    // Coordinate display
    const coordLabel = document.createElement("div");
    Object.assign(coordLabel.style, {
      position: "absolute",
      bottom: "5px",
      left: "7px",
      fontSize: "10px",
      fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace",
      color: "rgba(255,255,255,0.45)",
      zIndex: "2",
      pointerEvents: "none",
      textShadow: "0 1px 3px rgba(0,0,0,0.8)",
    });
    coordLabel.textContent = "0, 0";
    minimapContainer.appendChild(coordLabel);

    function offsetToCanvas(dx: number, dz: number, rotation: number): [number, number] {
      let rx: number, ry: number;
      if (rotation !== 0) {
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        rx = dx * cos - dz * sin;
        ry = dx * sin + dz * cos;
      } else {
        rx = dx;
        ry = dz;
      }
      return [C + rx * frameScale, C + ry * frameScale];
    }

    function drawGrid(playerX: number, playerZ: number, rotation: number, viewRadius: number) {
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      const visibleRange = viewRadius * 1.42;

      const minGX = Math.floor((playerX - visibleRange) / GRID_SPACING) * GRID_SPACING;
      const maxGX = Math.ceil((playerX + visibleRange) / GRID_SPACING) * GRID_SPACING;
      const minGZ = Math.floor((playerZ - visibleRange) / GRID_SPACING) * GRID_SPACING;
      const maxGZ = Math.ceil((playerZ + visibleRange) / GRID_SPACING) * GRID_SPACING;

      for (let wx = minGX; wx <= maxGX; wx += GRID_SPACING) {
        const dx = wx - playerX;
        const [x1, y1] = offsetToCanvas(dx, -visibleRange, rotation);
        const [x2, y2] = offsetToCanvas(dx, visibleRange, rotation);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      for (let wz = minGZ; wz <= maxGZ; wz += GRID_SPACING) {
        const dz = wz - playerZ;
        const [x1, y1] = offsetToCanvas(-visibleRange, dz, rotation);
        const [x2, y2] = offsetToCanvas(visibleRange, dz, rotation);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Origin crosshair
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      const [ox1, oy1] = offsetToCanvas(-playerX, -visibleRange, rotation);
      const [ox2, oy2] = offsetToCanvas(-playerX, visibleRange, rotation);
      ctx.beginPath();
      ctx.moveTo(ox1, oy1);
      ctx.lineTo(ox2, oy2);
      ctx.stroke();

      const [zx1, zy1] = offsetToCanvas(-visibleRange, -playerZ, rotation);
      const [zx2, zy2] = offsetToCanvas(visibleRange, -playerZ, rotation);
      ctx.beginPath();
      ctx.moveTo(zx1, zy1);
      ctx.lineTo(zx2, zy2);
      ctx.stroke();
    }

    function drawNorthIndicator(rotation: number, viewRadius: number) {
      const [nx, ny] = offsetToCanvas(0, -viewRadius * 0.88, rotation);
      if (nx < 0 || nx > S || ny < 0 || ny > S) return;
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "bold 18px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("N", nx, ny);
    }

    function updateMinimap() {
      const states = getCharacterStates();
      ctx.clearRect(0, 0, S, S);

      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, S - 2, S - 2);

      const local = Array.from(states.values()).find((p) => p.isLocal) ?? null;
      const playerX = local?.position.x ?? 0;
      const playerZ = local?.position.z ?? 0;

      let effectiveViewRadius = VIEW_RADIUS;
      if (highlightedPlayerId !== null) {
        const highlighted = states.get(highlightedPlayerId);
        if (highlighted) {
          const dx = highlighted.position.x - playerX;
          const dz = highlighted.position.z - playerZ;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > VIEW_RADIUS * 0.85) {
            effectiveViewRadius = dist * 1.25;
          }
        }
      }
      frameScale = S / (effectiveViewRadius * 2);

      const cameraYaw = getCameraYaw();
      const rotation = cameraOriented ? cameraYaw : 0;

      drawGrid(playerX, playerZ, rotation, effectiveViewRadius);
      drawNorthIndicator(rotation, effectiveViewRadius);

      const players = Array.from(states.values());
      const remotes = players.filter((p) => !p.isLocal);

      for (const p of remotes) {
        const dx = p.position.x - playerX;
        const dz = p.position.z - playerZ;
        const [mx, my] = offsetToCanvas(dx, dz, rotation);
        if (mx < -10 || mx > S + 10 || my < -10 || my > S + 10) continue;

        const isHighlighted = p.connectionId === highlightedPlayerId;

        if (isHighlighted) {
          ctx.beginPath();
          ctx.moveTo(C, C);
          ctx.lineTo(mx, my);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.beginPath();
          ctx.arc(mx, my, 14, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
          ctx.fill();

          ctx.beginPath();
          ctx.arc(mx, my, 9, 0, Math.PI * 2);
          ctx.strokeStyle = ACCENT;
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(mx, my, 6, 0, Math.PI * 2);
          ctx.fillStyle = ACCENT;
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(mx, my, 5, 0, Math.PI * 2);
          ctx.fillStyle = "#7a8ba6";
          ctx.fill();
        }
      }

      // Local player — center
      ctx.beginPath();
      ctx.arc(C, C, 12, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(C, C, 7, 0, Math.PI * 2);
      ctx.fillStyle = ACCENT;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(C, C, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();

      coordLabel.textContent = `${Math.round(playerX)}, ${Math.round(playerZ)}`;
    }

    // Tooltip on hover
    const tooltip = document.createElement("div");
    Object.assign(tooltip.style, {
      position: "absolute",
      background: "rgba(0,0,0,0.85)",
      color: "#fff",
      padding: "3px 7px",
      borderRadius: "4px",
      fontSize: "10px",
      pointerEvents: "none",
      display: "none",
      whiteSpace: "nowrap",
      zIndex: "3",
    });
    minimapContainer.appendChild(tooltip);

    canvas.addEventListener("mousemove", (e) => {
      const states = getCharacterStates();
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;

      const local = Array.from(states.values()).find((p) => p.isLocal) ?? null;
      const playerX = local?.position.x ?? 0;
      const playerZ = local?.position.z ?? 0;
      const rotation = cameraOriented ? getCameraYaw() : 0;

      let found: string | null = null;
      for (const p of states.values()) {
        const dx = p.position.x - playerX;
        const dz = p.position.z - playerZ;
        const [mx, my] = p.isLocal ? [C, C] : offsetToCanvas(dx, dz, rotation);
        const ddx = cx - mx;
        const ddy = cy - my;
        if (ddx * ddx + ddy * ddy < 15 * 15) {
          found = p.username || "Unknown";
          break;
        }
      }

      if (found) {
        tooltip.textContent = found;
        tooltip.style.display = "block";
        tooltip.style.left = `${e.clientX - rect.left + 10}px`;
        tooltip.style.top = `${e.clientY - rect.top - 20}px`;
      } else {
        tooltip.style.display = "none";
      }
    });

    canvas.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });

    let lastMinimapUpdate = 0;
    function minimapLoop(now: number) {
      if (now - lastMinimapUpdate >= MINIMAP_UPDATE_MS) {
        updateMinimap();
        lastMinimapUpdate = now;
      }
      minimapRafId = requestAnimationFrame(minimapLoop);
    }
    minimapRafId = requestAnimationFrame(minimapLoop);
    updateMinimap();
  }

  return {
    dispose() {
      if (playerListInterval !== null) clearInterval(playerListInterval);
      if (minimapRafId !== null) cancelAnimationFrame(minimapRafId);
      window.removeEventListener("resize", resizeHandler);
      container.remove();
    },
  };
}

export class DefaultHUDPlugin implements UIPlugin {
  private hud: { dispose: () => void } | null = null;

  constructor(private options: DefaultHUDPluginOptions = {}) {}

  mount(_container: HTMLElement, client: Networked3dWebExperienceClient): void {
    this.hud = createHUD(_container, client, this.options);
  }

  dispose(): void {
    this.hud?.dispose();
    this.hud = null;
  }
}
