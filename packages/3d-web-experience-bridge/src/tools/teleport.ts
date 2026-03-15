import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { roundPos, textResult } from "./utils";

const teleport: ToolDefinition = {
  name: "teleport",
  description: "Instantly teleport the avatar to a position.",
  group: "Movement",
  returns: '{ status: "teleported", position: {x,y,z} }',
  inputSchema: z.object({
    x: z.number().finite().describe("Target X coordinate"),
    y: z.number().finite().describe("Target Y coordinate"),
    z: z.number().finite().describe("Target Z coordinate"),
  }),
  async execute(
    params: { x: number; y: number; z: number },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    ctx.avatarController.teleport(params.x, params.y, params.z);
    const pos = ctx.avatarController.getPosition();
    return textResult({ status: "teleported", position: roundPos(pos) });
  },
};

export default teleport;
