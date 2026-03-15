import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { textResult } from "./utils";

const setCharacterDescription: ToolDefinition = {
  name: "set_character_description",
  description:
    "Change the bot's 3D avatar at runtime. Provide exactly one of: mesh_file_url (URL to a .glb model file), mml_character_url (URL to an MML character document), or mml_character_string (inline MML character markup). The change is immediately visible to all connected users.",
  group: "Avatar",
  returns: '{ status: "updated", characterDescription }',
  inputSchema: z.object({
    mesh_file_url: z.string().optional().describe("URL to a .glb avatar model file"),
    mml_character_url: z.string().optional().describe("URL to an MML character document"),
    mml_character_string: z.string().optional().describe("Inline MML character markup string"),
  }),
  async execute(
    params: { mesh_file_url?: string; mml_character_url?: string; mml_character_string?: string },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const provided = [
      params.mesh_file_url,
      params.mml_character_url,
      params.mml_character_string,
    ].filter((v) => v !== undefined && v !== null && v !== "");
    if (provided.length === 0) {
      return textResult({
        success: false,
        error:
          "Must provide exactly one of: mesh_file_url, mml_character_url, or mml_character_string",
      });
    }
    if (provided.length > 1) {
      return textResult({
        success: false,
        error: "Provide only one of: mesh_file_url, mml_character_url, or mml_character_string",
      });
    }

    const characterDescription = params.mesh_file_url
      ? { meshFileUrl: params.mesh_file_url }
      : params.mml_character_url
        ? { mmlCharacterUrl: params.mml_character_url }
        : { mmlCharacterString: params.mml_character_string! };

    ctx.worldConnection.updateCharacterDescription(characterDescription);

    return textResult({ status: "updated", characterDescription });
  },
};

export default setCharacterDescription;
