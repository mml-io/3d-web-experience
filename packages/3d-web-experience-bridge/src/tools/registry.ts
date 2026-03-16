import type { WorldConnection } from "@mml-io/3d-web-experience-client";
import type { z } from "zod";

import type { AvatarController } from "../AvatarController";
import type { HeadlessMMLScene } from "../HeadlessMMLScene";
import type { NavMeshManager } from "../NavMeshManager";

import click from "./click";
import type { EventBuffer } from "./EventBuffer";
import findPlacementSpots from "./find-placement-spots";
import followUser from "./follow-user";
import getChatHistory from "./get-chat-history";
import getElement from "./get-element";
import getSceneInfo from "./get-scene-info";
import interact from "./interact";
import jump from "./jump";
import moveTo from "./move-to";
import navigateTo from "./navigate-to";
import observe from "./observe";
import searchNearby from "./search-nearby";
import sendChat from "./send-chat";
import setAnimation from "./set-animation";
import setCharacterDescription from "./set-character-description";
import stopFollowing from "./stop-following";
import stopMoving from "./stop-moving";
import teleport from "./teleport";

export type ToolContext = {
  worldConnection: WorldConnection;
  avatarController: AvatarController;
  headlessScene?: HeadlessMMLScene;
  navMeshManager?: NavMeshManager;
  serverUrl: string;
  bridgePort?: number;
  eventBuffer?: EventBuffer;
  worldConfig?: Record<string, unknown> | null;
};

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodObject<any>;
  /** Compact JSON shape describing the tool's return value (shown in --help). */
  returns?: string;
  /** Category for grouped help display (e.g. "Movement", "Observation"). */
  group?: string;
  // Each tool narrows `params` to its own schema type in its implementation.
  // A generic constraint isn't practical here because tool schemas vary widely.
  execute: (
    params: Record<string, unknown>,
    ctx: ToolContext,
    signal?: AbortSignal,
  ) => Promise<ToolResult>;
};

export function loadTools(): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>();
  const allTools: ToolDefinition[] = [
    moveTo,
    teleport,
    navigateTo,
    stopMoving,
    followUser,
    stopFollowing,
    getSceneInfo,
    observe,
    searchNearby,
    setAnimation,
    setCharacterDescription,
    sendChat,
    getChatHistory,
    jump,
    click,
    interact,
    getElement,
    findPlacementSpots,
  ];
  for (const tool of allTools) {
    tools.set(tool.name, tool);
  }
  return tools;
}
