import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { textResult } from "./utils";

const getChatHistory: ToolDefinition = {
  name: "get_chat_history",
  description: "Get recent chat messages from the world.",
  group: "Communication",
  returns: "{ messages: [{username, message, secondsAgo}...], count }",
  inputSchema: z.object({
    last_n: z.number().int().min(1).max(100).optional().describe("Return only the last N messages"),
    since_seconds_ago: z
      .number()
      .min(0)
      .optional()
      .describe("Only return messages from the last N seconds"),
  }),
  async execute(
    params: { last_n?: number; since_seconds_ago?: number },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const now = Date.now();
    const since =
      params.since_seconds_ago !== undefined ? now - params.since_seconds_ago * 1000 : undefined;
    let messages = ctx.worldConnection.getChatHistory(since);
    if (params.last_n !== undefined) {
      messages = messages.slice(-params.last_n);
    }
    const formatted = messages.map((m) => ({
      username: m.username,
      message: m.message,
      secondsAgo: Math.round((now - m.timestamp) / 1000),
    }));
    return textResult({ messages: formatted, count: formatted.length });
  },
};

export default getChatHistory;
