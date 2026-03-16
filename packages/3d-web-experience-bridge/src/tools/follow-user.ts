import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { roundPos, textResult } from "./utils";

const followUser: ToolDefinition = {
  name: "follow_user",
  description:
    "Start following a user by username. The avatar will continuously track and walk toward the user. " +
    "Returns immediately — use observe to detect arrival or follow_lost. " +
    "Cancelled by any other movement tool or stop_following.",
  group: "Movement",
  returns: '{ status: "following"|"error", username, targetPosition, stopDistance, speed }',
  inputSchema: z.object({
    username: z.string().describe("Username of the user to follow"),
    stop_distance: z
      .number()
      .finite()
      .positive()
      .optional()
      .describe("Stop this many units away (default: 2.0)"),
    speed: z
      .number()
      .finite()
      .positive()
      .max(20)
      .optional()
      .describe("Movement speed in units/sec (default: 3.0, max: 20)"),
  }),
  async execute(
    params: { username: string; stop_distance?: number; speed?: number },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const users = ctx.worldConnection.getOtherUsers();
    const target = users.find((u) => u.username?.toLowerCase() === params.username.toLowerCase());
    if (!target) {
      return textResult({
        status: "error",
        error: `User "${params.username}" not found. Available users: ${
          users
            .map((u) => u.username)
            .filter(Boolean)
            .join(", ") || "none"
        }`,
      });
    }
    const stopDistance = params.stop_distance ?? 2.0;
    const speed = params.speed ?? 3.0;
    ctx.avatarController.startFollowing(
      target.connectionId,
      ctx.worldConnection,
      stopDistance,
      speed,
    );
    return textResult({
      status: "following",
      username: target.username,
      connectionId: target.connectionId,
      targetPosition: roundPos(target.position),
      stopDistance,
      speed,
    });
  },
};

export default followUser;
