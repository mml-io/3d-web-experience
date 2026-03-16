import { describe, expect, test } from "vitest";

import { loadTools } from "../../src/tools/registry";

describe("loadTools", () => {
  const tools = loadTools();

  test("returns a Map of tools", () => {
    expect(tools).toBeInstanceOf(Map);
    expect(tools.size).toBeGreaterThan(0);
  });

  const expectedTools = [
    "move_to",
    "teleport",
    "navigate_to",
    "stop_moving",
    "follow_user",
    "stop_following",
    "get_scene_info",
    "observe",
    "search_nearby",
    "set_animation_state",
    "set_character_description",
    "send_chat_message",
    "get_chat_history",
    "jump",
    "click",
    "interact",
    "get_element",
    "find_placement_spots",
  ];

  test(`contains all ${expectedTools.length} expected tools`, () => {
    for (const name of expectedTools) {
      expect(tools.has(name)).toBe(true);
    }
    expect(tools.size).toBe(expectedTools.length);
  });

  test("each tool has required fields", () => {
    for (const [name, tool] of tools) {
      expect(tool.name).toBe(name);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });
});
