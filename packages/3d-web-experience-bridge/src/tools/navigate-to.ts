import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { distance2D, round2, roundPos, textResult } from "./utils";

const navigateTo: ToolDefinition = {
  name: "navigate_to",
  description:
    "Walk to a position using pathfinding. Automatically routes around obstacles and jumps between platforms. " +
    "For distant targets, walks you partway there — call again after arrival to continue. " +
    "This tool returns immediately with navigation status; use observe to confirm the avatar has reached its destination.",
  group: "Movement",
  returns:
    '{ status: "navigating"|"partial_path"|"no_path"|"error", from: {x,y,z}, to: {x,y,z}, waypoints, jumps, speed }',
  inputSchema: z.object({
    x: z.number().finite().describe("Target X coordinate"),
    y: z.number().finite().describe("Target Y coordinate"),
    z: z.number().finite().describe("Target Z coordinate"),
    speed: z
      .number()
      .finite()
      .positive()
      .max(20)
      .optional()
      .describe("Movement speed in units/sec (default: 3.0, max: 20)"),
    stop_distance: z
      .number()
      .finite()
      .positive()
      .optional()
      .describe("Stop this many units away from the target (default: 0, walks to exact position)"),
  }),
  async execute(
    params: { x: number; y: number; z: number; speed?: number; stop_distance?: number },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    if (!ctx.navMeshManager) {
      return textResult({ status: "error", error: "NavMesh manager not available." });
    }

    if (!ctx.navMeshManager.isReady) {
      const ready = await ctx.navMeshManager.waitForReady(30000);
      if (!ready) {
        return textResult({
          status: "error",
          error: "NavMesh is still loading. Try again later.",
        });
      }
    }

    const from = ctx.avatarController.getPosition();
    let to = { x: params.x, y: params.y, z: params.z };
    const speed = params.speed ?? 3.0;
    const stopDistance = params.stop_distance ?? 0;

    if (stopDistance > 0) {
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > stopDistance) {
        const ratio = (dist - stopDistance) / dist;
        to = { x: from.x + dx * ratio, y: to.y, z: from.z + dz * ratio };
      }
    }

    // If destination is outside the navmesh region, walk to the edge
    if (!ctx.navMeshManager.isWithinRegion(to)) {
      const edgePoint = ctx.navMeshManager.computeEdgePoint(from, to);
      if (edgePoint) {
        const result = ctx.navMeshManager.computePathWithJumpInfo(from, edgePoint);
        if (result && result.path.length > 0) {
          ctx.avatarController.followPath(
            result.path,
            speed,
            result.jumpIndices.size > 0 ? result.jumpIndices : undefined,
          );
          ctx.avatarController.setUltimateDestination(to);

          const remainingDistance = distance2D(from, to);

          return textResult({
            status: "partial_path",
            autoResuming: true,
            from: roundPos(from),
            to: roundPos(to),
            intermediate: roundPos(edgePoint),
            waypoints: result.path.length,
            jumps: result.jumpIndices.size,
            remainingDistance: round2(remainingDistance),
            speed,
          });
        }
      }
    }

    const result = ctx.navMeshManager.computePathWithJumpInfo(from, to);
    if (!result || result.path.length === 0) {
      return textResult({
        status: "no_path",
        error: "No navigable path found. Try a nearby point or use move_to for direct movement.",
        from: roundPos(from),
        to: roundPos(to),
      });
    }

    ctx.avatarController.setUltimateDestination(null);
    ctx.avatarController.followPath(
      result.path,
      speed,
      result.jumpIndices.size > 0 ? result.jumpIndices : undefined,
    );

    return textResult({
      status: "navigating",
      from: roundPos(from),
      to: roundPos(to),
      waypoints: result.path.length,
      jumps: result.jumpIndices.size,
      speed,
    });
  },
};

export default navigateTo;
