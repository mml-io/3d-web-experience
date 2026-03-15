import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { textResult } from "./utils";

const interact: ToolDefinition = {
  name: "interact",
  description:
    "Trigger a proximity-based m-interaction by its node ID. " +
    "You must be within the interaction's range. Use get_scene_info to find interactionElements. " +
    "Interactions often trigger MML scene changes — call observe with your last resume_from cursor to see the effect.",
  group: "Interaction",
  returns: "{ success: true, elementTag } | { success: false, error }",
  inputSchema: z.object({
    node_id: z.number().int().describe("The node ID of the m-interaction element to trigger"),
  }),
  async execute(params: { node_id: number }, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.headlessScene) {
      return textResult({ success: false, error: "Scene not loaded" });
    }
    const avatarPos = ctx.avatarController.getPosition();
    const result = ctx.headlessScene.triggerInteraction(params.node_id, avatarPos);
    return textResult(result);
  },
};

export default interact;
