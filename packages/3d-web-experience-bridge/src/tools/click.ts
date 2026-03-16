import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { textResult } from "./utils";

const click: ToolDefinition = {
  name: "click",
  description:
    "Click on a visible geometry element (m-cube, m-sphere, m-model, m-label, etc.) by its node ID. " +
    "Requires line of sight to the target. Use get_scene_info to find clickableElements. " +
    "Clicks often trigger MML scene changes — call observe with your last resume_from cursor to see the effect.",
  group: "Interaction",
  returns: "{ success: true, elementTag, hitPosition } | { success: false, error }",
  inputSchema: z.object({
    node_id: z.number().int().describe("The node ID of the element to click"),
  }),
  async execute(params: { node_id: number }, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.headlessScene) {
      return textResult({ success: false, error: "Scene not loaded" });
    }
    const avatarPos = ctx.avatarController.getPosition();
    const result = ctx.headlessScene.clickNode(params.node_id, avatarPos);
    return textResult(result);
  },
};

export default click;
