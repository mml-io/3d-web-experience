import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { round2, roundPos, textResult } from "./utils";

const searchNearby: ToolDefinition = {
  name: "search_nearby",
  description: "Search for MML elements near your current position, sorted by distance.",
  group: "Observation",
  returns:
    "{ position: {x,y,z}, radius, found, elements: [{nodeId,tag,position,distance,attrs}...] }",
  inputSchema: z.object({
    radius: z.number().optional().default(15).describe("Search radius (default: 15)"),
    element_type: z.string().optional().describe("Filter by element type (e.g. m-cube, m-label)"),
    max_results: z.number().optional().default(20).describe("Maximum results (default: 20)"),
  }),
  async execute(
    params: { radius?: number; element_type?: string; max_results?: number },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    if (!ctx.headlessScene || !ctx.avatarController) {
      return textResult({ success: false, error: "Scene not loaded" });
    }
    const pos = ctx.avatarController.getPosition();
    const elements = ctx.headlessScene.getAllElements(pos, {
      radius: params.radius ?? 15,
      maxResults: params.max_results ?? 20,
      tagFilter: params.element_type,
    });
    const compact = elements.map((el) => ({
      nodeId: el.nodeId,
      tag: el.tag,
      position: roundPos(el.position),
      distance: round2(el.distance),
      attrs: el.attributes,
    }));
    return textResult({
      position: roundPos(pos),
      radius: params.radius ?? 15,
      found: compact.length,
      elements: compact,
    });
  },
};

export default searchNearby;
