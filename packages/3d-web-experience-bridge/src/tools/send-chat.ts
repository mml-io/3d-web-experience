import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { textResult } from "./utils";

/**
 * Strip backslash-escapes that are not valid in plain text.
 *
 * LLMs frequently produce strings like `Hey\! How are you\?` when generating
 * JSON tool arguments. In JSON, `\!` and `\?` are not recognised escape
 * sequences — most parsers pass the literal backslash through, resulting in
 * chat messages that contain visible `\` characters.
 *
 * This function removes a `\` that precedes any character which is NOT part
 * of a meaningful escape (e.g. `\n`, `\t`, `\\` are left alone).
 */
function stripSpuriousEscapes(text: string): string {
  // Keep backslashes that precede a character with special meaning.
  // Remove backslashes before anything else (punctuation, letters, digits, etc.).
  return text.replace(/\\([^\\nrtbfuUvx0])/g, "$1");
}

const sendChat: ToolDefinition = {
  name: "send_chat_message",
  description: "Send a chat message visible to all users in the world.",
  group: "Communication",
  returns: '{ status: "sent", message }',
  inputSchema: z.object({
    message: z.string().describe("The message to send"),
  }),
  async execute(params: { message: string }, ctx: ToolContext): Promise<ToolResult> {
    const message = stripSpuriousEscapes(params.message);
    ctx.worldConnection.sendChatMessage(message);
    return textResult({ status: "sent", message });
  },
};

export default sendChat;
