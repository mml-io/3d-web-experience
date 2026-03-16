import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { roundPos, textResult } from "./utils";

const moveTo: ToolDefinition = {
  name: "move_to",
  description:
    "Start moving the avatar toward a target position. Returns immediately — use observe to block until arrival.",
  group: "Movement",
  returns: '{ status: "moving", from: {x,y,z}, to: {x,y,z}, speed }',
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
  }),
  async execute(
    params: { x: number; y: number; z: number; speed?: number },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    ctx.avatarController.moveTo(params.x, params.y, params.z, params.speed);
    const pos = ctx.avatarController.getPosition();
    return textResult({
      status: "moving",
      from: roundPos(pos),
      to: { x: params.x, y: params.y, z: params.z },
      speed: params.speed ?? 3.0,
    });
  },
};

export default moveTo;
