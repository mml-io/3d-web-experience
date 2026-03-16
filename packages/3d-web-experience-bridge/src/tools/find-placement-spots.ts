import { z } from "zod";

import { findSurfaceSpots } from "../SurfaceAnalyzer";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { textResult } from "./utils";

const findPlacementSpots: ToolDefinition = {
  name: "find_placement_spots",
  description:
    "Find ideal locations to place content in the 3D world. " +
    "Two modes: 'ground' (default) finds open areas on the navmesh for large objects. " +
    "'surface' analyzes actual mesh geometry (including GLB models) to find horizontal surfaces " +
    "like tables, shelves, and desks for placing small objects.",
  group: "Observation",
  inputSchema: z.object({
    search_mode: z
      .enum(["ground", "surface"])
      .optional()
      .describe(
        "Search mode: 'ground' for open areas on the navmesh (default), 'surface' for horizontal surfaces like tables/shelves",
      ),
    surface_class: z
      .string()
      .optional()
      .describe(
        "Only for surface mode: filter surfaces by class attribute (e.g. 'tabletop', 'shelf')",
      ),
    min_width: z
      .number()
      .optional()
      .describe("Minimum required width in world units (default: 2 for ground, 0.2 for surface)"),
    min_depth: z
      .number()
      .optional()
      .describe("Minimum required depth in world units (default: 2 for ground, 0.2 for surface)"),
    max_results: z.number().optional().describe("Maximum number of spots to return (default: 5)"),
    radius: z
      .number()
      .optional()
      .describe("Search radius from agent position (default: 20 for surface mode)"),
  }),
  async execute(
    params: {
      search_mode?: "ground" | "surface";
      surface_class?: string;
      min_width?: number;
      min_depth?: number;
      max_results?: number;
      radius?: number;
    },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    if (!ctx.navMeshManager || !ctx.headlessScene) {
      return textResult({
        success: false,
        error: "NavMesh or scene not available. Wait for the scene to load.",
      });
    }

    if (!ctx.navMeshManager.isReady) {
      return textResult({
        success: false,
        error: "NavMesh not ready yet. Wait for navmesh generation to complete.",
      });
    }

    const agentPos = ctx.avatarController.getPosition();
    const searchMode = params.search_mode ?? "ground";

    // --- Surface mode ---
    if (searchMode === "surface") {
      const spots = findSurfaceSpots(ctx.headlessScene, ctx.navMeshManager, agentPos, {
        surfaceClass: params.surface_class,
        minWidth: params.min_width,
        minDepth: params.min_depth,
        maxResults: params.max_results ?? 5,
        radius: params.radius ?? 20,
      });

      return textResult({
        searchMode: "surface",
        agentPosition: {
          x: Math.round(agentPos.x * 100) / 100,
          y: Math.round(agentPos.y * 100) / 100,
          z: Math.round(agentPos.z * 100) / 100,
        },
        spotsFound: spots.length,
        spots,
      });
    }

    // --- Ground mode ---
    // Try to fetch existing document positions from the server
    const existingDocPositions: Array<{ x: number; y: number; z: number }> = [];
    try {
      const res = await fetch(`${ctx.serverUrl}/api/v1/documents-config`);
      if (res.ok) {
        const config = (await res.json()) as Record<
          string,
          { position?: { x: number; y: number; z: number } }
        >;
        for (const [, doc] of Object.entries(config)) {
          if (doc.position) {
            existingDocPositions.push(doc.position);
          }
        }
      }
    } catch {
      // Non-critical — proceed without existing doc positions
    }

    // Fall back to world-config if documents-config doesn't exist
    if (existingDocPositions.length === 0) {
      try {
        const res = await fetch(`${ctx.serverUrl}/api/v1/world-config`);
        if (res.ok) {
          const data = (await res.json()) as {
            documents?: Record<string, { position?: { x: number; y: number; z: number } }>;
          };
          if (data.documents) {
            for (const [, doc] of Object.entries(data.documents)) {
              if (doc.position) {
                existingDocPositions.push(doc.position);
              }
            }
          }
        }
      } catch {
        // Non-critical
      }
    }

    const spots = ctx.navMeshManager.computePlacementSpots(
      ctx.headlessScene.scene,
      existingDocPositions,
      agentPos,
      {
        minWidth: params.min_width,
        minDepth: params.min_depth,
        maxResults: params.max_results ?? 5,
      },
    );

    return textResult({
      searchMode: "ground",
      agentPosition: {
        x: Math.round(agentPos.x * 100) / 100,
        y: Math.round(agentPos.y * 100) / 100,
        z: Math.round(agentPos.z * 100) / 100,
      },
      existingDocuments: existingDocPositions.length,
      spotsFound: spots.length,
      spots,
    });
  },
};

export default findPlacementSpots;
