import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { distance, round2, roundPos, textResult } from "./utils";

const getSceneInfo: ToolDefinition = {
  name: "get_scene_info",
  description:
    "Get a comprehensive overview of the scene: your position, other users, nearby elements, and optionally raw mesh geometry. IMPORTANT: When include_geometry is true, the output is very large (50+ mesh entries). Do NOT call this with include_geometry=true in your main context. Instead, delegate the geometry call to a cheap/fast subagent and have it return a concise spatial summary. This avoids flooding your context window with raw mesh data.",
  group: "Observation",
  returns:
    "{ sceneLoaded, navmeshReady, self?: {connectionId, username, position, rotation, isMoving, onGround, distanceToTarget, isFollowing}, users?: [{username, connectionId, position, distance}...], elements?: [{nodeId, tag, position, distance, attrs, categories}...], nearbyGeometry?: [...] }",
  inputSchema: z.object({
    radius: z
      .number()
      .default(30)
      .describe("Only return elements/users within this radius (default: 30)"),
    max_elements: z.number().default(50).describe("Maximum elements to return (default: 50)"),
    include_self: z.boolean().default(true).describe("Include own position/state (default: true)"),
    include_users: z.boolean().default(true).describe("Include other users list (default: true)"),
    include_elements: z.boolean().default(true).describe("Include scene elements (default: true)"),
    include_geometry: z
      .boolean()
      .default(false)
      .describe(
        "Include nearby mesh geometry details (default: false). WARNING: produces very large output — use a subagent to call this and summarize the results rather than reading raw geometry directly.",
      ),
    geometry_radius: z.number().default(20).describe("Radius for geometry inclusion (default: 20)"),
    include_world_config: z
      .boolean()
      .default(false)
      .describe(
        "Include the current world configuration (environment, sun, fog, skybox, spawn, avatar settings). Default: false.",
      ),
  }),
  async execute(
    params: {
      radius?: number;
      max_elements?: number;
      include_self?: boolean;
      include_users?: boolean;
      include_elements?: boolean;
      include_geometry?: boolean;
      geometry_radius?: number;
      include_world_config?: boolean;
    },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const sceneLoaded = ctx.headlessScene?.isLoaded ?? false;
    const navmeshReady = ctx.navMeshManager?.isReady ?? false;

    const filterRadius = params.radius ?? 30;
    const maxElements = params.max_elements ?? 50;
    const includeSelf = params.include_self ?? true;
    const includeUsers = params.include_users ?? true;
    const includeElements = params.include_elements ?? true;
    const includeGeometry = params.include_geometry ?? false;
    const geometryRadius = params.geometry_radius ?? 20;

    const result: Record<string, unknown> = {
      sceneLoaded,
      navmeshReady,
    };

    const avatarPos = ctx.avatarController?.getPosition();

    // Self position/state
    if (includeSelf && ctx.avatarController) {
      const pos = ctx.avatarController.getPosition();
      const rot = ctx.avatarController.getRotation();
      const moving = ctx.avatarController.isMoving();
      const distRemaining = ctx.avatarController.distanceToTarget();
      result.self = {
        connectionId: ctx.worldConnection.getConnectionId(),
        username: ctx.worldConnection.getUsername(),
        position: roundPos(pos),
        rotation: rot,
        isMoving: moving,
        onGround: ctx.avatarController.onGround,
        distanceToTarget: moving ? round2(distRemaining) : null,
        isFollowing: ctx.avatarController.isFollowing(),
      };
    }

    // Other users
    if (includeUsers) {
      const myId = ctx.worldConnection.getConnectionId();
      const others = ctx.worldConnection.getOtherUsers().filter((u) => u.connectionId !== myId);
      const myPos = avatarPos ?? { x: 0, y: 0, z: 0 };
      result.users = others.map((u) => ({
        username: u.username,
        connectionId: u.connectionId,
        position: roundPos(u.position),
        distance: round2(distance(myPos, u.position)),
      }));
    }

    // Elements (unified with categories)
    if (includeElements && ctx.headlessScene && avatarPos) {
      const categorized = ctx.headlessScene.getCategorizedElements(avatarPos, {
        radius: filterRadius,
        maxResults: maxElements,
      });
      result.elements = categorized.map((el) => ({
        nodeId: el.nodeId,
        tag: el.tag,
        position: el.position,
        distance: el.distance,
        attrs: el.attributes,
        categories: el.categories,
      }));
    } else if (includeElements) {
      result.elements = [];
    }

    // Geometry
    if (includeGeometry && ctx.headlessScene && ctx.avatarController) {
      const pos = ctx.avatarController.getPosition();
      result.nearbyGeometry = ctx.headlessScene.getFilteredSceneInfo(pos, geometryRadius);
    } else if (!includeGeometry) {
      const meshCount = ctx.headlessScene?.countMeshes?.() ?? null;
      const elementCount = (result as any).elements?.length ?? 0;
      result.GEOMETRY_WARNING =
        `${meshCount ?? "Many"} meshes are hidden. These are the actual world — buildings, terrain, roads — not the ${elementCount} interactive elements above. ` +
        `Reading raw geometry directly will consume thousands of tokens of your context and degrade your ability to reason about subsequent tasks. ` +
        `Delegate to a subagent: call get_scene_info with include_geometry=true on port ${ctx.bridgePort ?? 3100} via a subagent and have it return a concise spatial summary.`;
    }

    // World config
    const includeWorldConfig = params.include_world_config ?? false;
    if (includeWorldConfig && ctx.worldConfig) {
      result.worldConfig = ctx.worldConfig;
    }

    // Omitted sections
    const omitted: Record<string, string> = {};
    if (!includeGeometry) {
      omitted.geometry = "use include_geometry=true (large output — delegate to a subagent)";
    }
    if (!includeWorldConfig) {
      omitted.worldConfig =
        "use include_world_config=true to see environment, sun, fog, skybox, spawn, and avatar settings";
    }
    if (Object.keys(omitted).length > 0) {
      result.omitted = omitted;
    }

    return textResult(result);
  },
};

export default getSceneInfo;
