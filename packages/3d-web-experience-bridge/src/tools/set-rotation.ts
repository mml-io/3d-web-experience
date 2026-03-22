import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { round2, textResult } from "./utils";

const setRotation: ToolDefinition = {
  name: "set_rotation",
  description:
    "Set the avatar's facing direction to a specific angle in degrees. " +
    "0 = facing +Z, 90 = facing +X, 180 = facing -Z, 270 = facing -X. " +
    "Only effective while the avatar is stationary — movement overrides the facing direction.",
  group: "Avatar",
  returns: "{ angleDegrees, eulerY }",
  inputSchema: z.object({
    angle: z
      .number()
      .finite()
      .describe("Facing direction in degrees (0 = +Z, 90 = +X, 180 = -Z, 270 = -X)"),
  }),
  async execute(params: { angle: number }, ctx: ToolContext): Promise<ToolResult> {
    const eulerY = (params.angle * Math.PI) / 180;
    ctx.avatarController.setRotation(eulerY);
    return textResult({
      angleDegrees: round2(params.angle % 360),
      eulerY: round2(eulerY),
    });
  },
};

export default setRotation;
