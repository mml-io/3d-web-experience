import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { textResult } from "./utils";

const getElement: ToolDefinition = {
  name: "get_element",
  description: "Look up a single scene element by its node ID and return its current state.",
  group: "Observation",
  returns: "{ nodeId, tag, position, attributes, children? }",
  inputSchema: z.object({
    node_id: z.number().int().describe("The node ID of the element to look up"),
  }),
  async execute(params: { node_id: number }, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.headlessScene) {
      return textResult({ success: false, error: "Scene not loaded" });
    }
    const element = ctx.headlessScene.getElementByNodeId(params.node_id);
    if (!element) {
      return textResult({
        success: false,
        error: `No element found with node ID ${params.node_id}`,
      });
    }
    return textResult(element);
  },
};

export default getElement;
