import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { roundPos, textResult } from "./utils";

const stopFollowing: ToolDefinition = {
  name: "stop_following",
  description: "Stop following the current user.",
  group: "Movement",
  returns: '{ status: "stopped"|"not_following", position: {x,y,z} }',
  inputSchema: z.object({}),
  async execute(_params: Record<string, never>, ctx: ToolContext): Promise<ToolResult> {
    const wasFollowing = ctx.avatarController.isFollowing();
    ctx.avatarController.stopFollowing();
    return textResult({
      status: wasFollowing ? "stopped" : "not_following",
      position: roundPos(ctx.avatarController.getPosition()),
    });
  },
};

export default stopFollowing;
