import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { round2, roundPos, textResult } from "./utils";

const faceUser: ToolDefinition = {
  name: "face_user",
  description:
    "Rotate the avatar to face toward a specific user by username. " +
    "Only effective while the avatar is stationary — movement overrides the facing direction.",
  group: "Avatar",
  returns: '{ status: "ok"|"error", username, angleDegrees, eulerY }',
  inputSchema: z.object({
    username: z.string().describe("Username of the user to face toward"),
  }),
  async execute(params: { username: string }, ctx: ToolContext): Promise<ToolResult> {
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

    const myPos = ctx.avatarController.getPosition();
    const dx = target.position.x - myPos.x;
    const dz = target.position.z - myPos.z;
    const eulerY = Math.atan2(dx, dz);
    ctx.avatarController.setRotation(eulerY);

    const angleDegrees = ((eulerY * 180) / Math.PI + 360) % 360;
    return textResult({
      status: "ok",
      username: target.username,
      userPosition: roundPos(target.position),
      angleDegrees: round2(angleDegrees),
      eulerY: round2(eulerY),
    });
  },
};

export default faceUser;
