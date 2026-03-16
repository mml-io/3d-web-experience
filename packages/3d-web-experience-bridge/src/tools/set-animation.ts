import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { textResult } from "./utils";

const setAnimation: ToolDefinition = {
  name: "set_animation_state",
  description: "Set the avatar's animation state. 0 = idle, 1 = walking.",
  group: "Avatar",
  returns: "{ animationState }",
  inputSchema: z.object({
    state: z.number().int().min(0).max(1).describe("Animation state: 0=idle, 1=walking"),
  }),
  async execute(params: { state: number }, ctx: ToolContext): Promise<ToolResult> {
    ctx.avatarController.setAnimationState(params.state);
    return textResult({ animationState: params.state });
  },
};

export default setAnimation;
