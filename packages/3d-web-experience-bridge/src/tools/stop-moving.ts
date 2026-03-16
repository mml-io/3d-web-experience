import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { roundPos, textResult } from "./utils";

const stopMoving: ToolDefinition = {
  name: "stop_moving",
  description: "Stop the avatar's current movement immediately.",
  group: "Movement",
  returns: '{ status: "stopped"|"already_idle", position: {x,y,z} }',
  inputSchema: z.object({}),
  async execute(_params: Record<string, never>, ctx: ToolContext): Promise<ToolResult> {
    const wasMoving = ctx.avatarController.isMoving();
    ctx.avatarController.stop();
    const pos = ctx.avatarController.getPosition();
    return textResult({
      status: wasMoving ? "stopped" : "already_idle",
      position: roundPos(pos),
    });
  },
};

export default stopMoving;
