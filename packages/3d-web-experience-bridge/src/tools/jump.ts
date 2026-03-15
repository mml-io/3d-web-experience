import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { roundPos, textResult } from "./utils";

const jump: ToolDefinition = {
  name: "jump",
  description:
    "Make the avatar jump. First call jumps from the ground; calling again while airborne performs a double jump.",
  group: "Movement",
  returns: "{ jumped: boolean, position: {x,y,z}, onGround: boolean }",
  inputSchema: z.object({}),
  async execute(_params: Record<string, never>, ctx: ToolContext): Promise<ToolResult> {
    const success = ctx.avatarController.jump();
    const pos = ctx.avatarController.getPosition();
    return textResult({
      jumped: success,
      position: roundPos(pos),
      onGround: ctx.avatarController.onGround,
    });
  },
};

export default jump;
