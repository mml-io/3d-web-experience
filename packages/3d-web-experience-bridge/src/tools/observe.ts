import type { WorldEvent } from "@mml-io/3d-web-experience-client";
import { z } from "zod";

import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { distance, round2, roundPos, textResult } from "./utils";

const PROXIMITY_CHECK_INTERVAL_MS = 500;

type ObserveEvent = { type: string; [key: string]: unknown };

const observe: ToolDefinition = {
  name: "observe",
  description:
    "Wait for and collect world events. Pass --resume-from last to continue from " +
    "the previous observe cursor automatically, or pass a numeric timestamp. " +
    "Without resume_from, only events arriving after this call are returned. " +
    "Use min_wait_ms to batch events over a collection window instead of returning " +
    "on the first event. With early_exit_on_arrival, arrival events bypass the " +
    "min_wait and return immediately with all events collected so far.",
  group: "Observation",
  returns: "{ trigger, resume_from, position, moving, events?, users? }",
  inputSchema: z.object({
    timeout_seconds: z.number().min(1).max(300).optional().describe("Max wait time (default 10)"),
    resume_from: z
      .union([z.number(), z.literal("last")])
      .optional()
      .describe(
        'Cursor from the previous observe response, or "last" to auto-resume ' +
          "from the previous observe call's cursor. " +
          "Omitting it starts from now and will miss any already-buffered events.",
      ),
    min_wait_ms: z
      .number()
      .int()
      .min(0)
      .max(30000)
      .optional()
      .describe(
        "Minimum collection window in ms before returning (default 100). " +
          "Events are batched during this window instead of returning on the first one.",
      ),
    early_exit_on_arrival: z
      .boolean()
      .optional()
      .describe(
        "If true, arrival/stuck events bypass min_wait_ms and return immediately " +
          "with all events collected so far (default false)",
      ),
    chat: z.boolean().optional().describe("Collect chat events (default true)"),
    arrival: z
      .boolean()
      .optional()
      .describe("Collect arrival/stuck/follow_lost events (default true)"),
    users: z.boolean().optional().describe("Collect user join/leave events (default true)"),
    proximity_distance: z.number().optional().describe("Wake when a new user enters this radius"),
    scene: z.boolean().optional().describe("Collect scene change events (default true)"),
  }),
  async execute(
    params: {
      timeout_seconds?: number;
      resume_from?: number | "last";
      min_wait_ms?: number;
      early_exit_on_arrival?: boolean;
      chat?: boolean;
      arrival?: boolean;
      users?: boolean;
      proximity_distance?: number;
      scene?: boolean;
    },
    ctx: ToolContext,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    if (!ctx.eventBuffer) {
      return textResult({
        success: false,
        error: "EventBuffer not initialised — was the bridge started correctly?",
      });
    }
    const buffer = ctx.eventBuffer;

    // Resolve "last" to the cursor from the previous observe call
    let sinceTs: number;
    if (params.resume_from === "last") {
      const lastCursor = buffer.getLastCursor();
      sinceTs = lastCursor > 0 ? lastCursor : Date.now();
    } else {
      sinceTs = params.resume_from ?? Date.now();
    }
    const timeoutMs = (params.timeout_seconds ?? 10) * 1000;
    const minWaitMs = params.min_wait_ms ?? 100;
    const earlyExitOnArrival = params.early_exit_on_arrival ?? false;
    const listenChat = params.chat !== false;
    const listenArrival = params.arrival !== false;
    const listenUsers = params.users !== false;
    const listenScene = params.scene !== false;
    const proximityDistance = params.proximity_distance;

    // Build the set of buffered event types to query
    const wantedTypes = new Set<string>();
    if (listenArrival) {
      wantedTypes.add("arrival");
      wantedTypes.add("stuck");
      wantedTypes.add("follow_lost");
    }
    if (listenUsers) {
      wantedTypes.add("user_joined");
      wantedTypes.add("user_left");
    }
    if (listenScene) wantedTypes.add("scene_changed");
    wantedTypes.add("navmesh_ready");

    const ARRIVAL_EVENT_TYPES = new Set(["arrival", "stuck", "follow_lost"]);

    // Collect all matching events since resume_from
    const collectEvents = (): ObserveEvent[] => {
      const events: ObserveEvent[] = [];

      // Chat from WorldConnection history
      if (listenChat) {
        const ownId = ctx.worldConnection.getConnectionId();
        for (const m of ctx.worldConnection.getChatHistory()) {
          if (m.timestamp >= sinceTs && m.fromConnectionId !== ownId) {
            events.push({ type: "chat", from: m.username, text: m.message });
          }
        }
      }

      // Buffered events (user join/leave, arrival, scene, navmesh)
      for (const e of buffer.getSince(sinceTs, wantedTypes)) {
        events.push(e as ObserveEvent);
      }

      return events;
    };

    // Check for immediately available events (skip if min_wait is active).
    // Filter out stale arrival events: if the avatar is currently moving,
    // any buffered arrivals are from a prior movement intent and should
    // not trigger an immediate return.
    const immediate = collectEvents();
    const currentlyMoving = ctx.avatarController.isMoving();
    const filteredImmediate = currentlyMoving
      ? immediate.filter((e) => !ARRIVAL_EVENT_TYPES.has(e.type))
      : immediate;
    if (filteredImmediate.length > 0 && minWaitMs <= 0) {
      const wantUsers = hasUserEvents(filteredImmediate) || (listenUsers && params.users === true);
      return buildResponse(
        determineTrigger(filteredImmediate),
        ctx,
        enrichSceneEvents(filteredImmediate, ctx),
        wantUsers,
      );
    }

    // No buffered events (or min_wait active) — wait for new ones or timeout
    return new Promise((resolve) => {
      let settled = false;
      const cleanups: Array<() => void> = [];
      const extraEvents: ObserveEvent[] = [];
      let minWaitElapsed = minWaitMs <= 0;

      function finish(triggerOverride?: string) {
        if (settled) return;
        settled = true;
        for (const cleanup of cleanups) cleanup();

        const allEvents = [...collectEvents(), ...extraEvents];
        const trigger =
          triggerOverride ?? (allEvents.length > 0 ? determineTrigger(allEvents) : "timeout");
        const wantUsers = hasUserEvents(allEvents) || (listenUsers && params.users === true);
        resolve(buildResponse(trigger, ctx, enrichSceneEvents(allEvents, ctx), wantUsers));
      }

      /** Gate finish() behind the min_wait window unless early-exit applies. */
      function tryFinish(isArrivalEvent = false) {
        if (settled) return;
        if (isArrivalEvent && earlyExitOnArrival) {
          finish();
          return;
        }
        if (minWaitElapsed) {
          finish();
        }
        // else: min_wait still active — events will be collected when it expires
      }

      // 0. Min-wait timer — when it expires, return collected events (if any)
      if (minWaitMs > 0) {
        const minWaitTimer = setTimeout(() => {
          minWaitElapsed = true;
          const current = [...collectEvents(), ...extraEvents];
          if (current.length > 0) {
            finish();
          }
          // else: no events yet, keep waiting up to the main timeout
        }, minWaitMs);
        cleanups.push(() => clearTimeout(minWaitTimer));
      }

      // 1. Timeout
      const timer = setTimeout(finish, timeoutMs);
      cleanups.push(() => clearTimeout(timer));

      // 1b. Abort signal — a new observe request supersedes this one
      if (signal) {
        if (signal.aborted) {
          finish("superseded");
          return;
        }
        const onAbort = () => finish("superseded");
        signal.addEventListener("abort", onAbort, { once: true });
        cleanups.push(() => signal.removeEventListener("abort", onAbort));
      }

      // 2. Buffer event notification
      const unsubBuffer = buffer.onEvent((type) => {
        if (wantedTypes.has(type)) {
          const isArrival = type === "arrival" || type === "stuck" || type === "follow_lost";
          tryFinish(isArrival);
        }
      });
      cleanups.push(unsubBuffer);

      // 3. Chat notification (chat uses getChatHistory, not the buffer)
      if (listenChat) {
        const onChat = (event: WorldEvent) => {
          if (event.type === "chat") tryFinish();
        };
        ctx.worldConnection.addEventListener(onChat);
        cleanups.push(() => ctx.worldConnection.removeEventListener(onChat));
      }

      // 4. Deferred arrival check — handles the edge case where the avatar
      //    stopped moving before the buffer's listener was set up, or where
      //    the avatar stops during the observe window without emitting an event.
      if (listenArrival) {
        if (!ctx.avatarController.isMoving()) {
          // Avatar already stopped — check for a recent arrival that landed
          // just before sinceTs (race between navigate_to and observe)
          const LOOKBACK_MS = 5000;
          // Only look back before sinceTs if no prior observe has already
          // delivered events in that window (prevents re-synthesizing arrivals
          // that were already returned to the caller).
          const lookbackStart = Math.max(sinceTs - LOOKBACK_MS, buffer.getLastCursor());
          if (
            lookbackStart < sinceTs &&
            buffer.hasSince(lookbackStart, ARRIVAL_EVENT_TYPES) &&
            !buffer.hasSince(sinceTs, ARRIVAL_EVENT_TYPES)
          ) {
            extraEvents.push({ type: "arrival" });
            // Advance the cursor so a concurrent observe call will not
            // re-synthesize the same deferred arrival event.
            buffer.setLastCursor(sinceTs);
            const deferredTimer = setTimeout(() => tryFinish(true), 0);
            cleanups.push(() => clearTimeout(deferredTimer));
          }
        } else {
          // Avatar is currently moving — poll until it stops, then synthesize
          // an arrival if the buffer didn't capture one. Uses an interval so it
          // works for both short navigate_to paths and long follow_user sessions.
          const arrivalPoll = setInterval(() => {
            if (settled) return;
            if (!ctx.avatarController.isMoving()) {
              clearInterval(arrivalPoll);
              if (!buffer.hasSince(sinceTs, ARRIVAL_EVENT_TYPES)) {
                extraEvents.push({ type: "arrival" });
                tryFinish(true);
              }
            }
          }, 250);
          cleanups.push(() => clearInterval(arrivalPoll));
        }
      }

      // 5. Proximity polling
      if (proximityDistance !== undefined) {
        const nearbyAtStart = new Set<number>();
        const myPos = ctx.avatarController.getPosition();
        for (const user of ctx.worldConnection.getOtherUsers()) {
          if (distance(myPos, user.position) <= proximityDistance) {
            nearbyAtStart.add(user.connectionId);
          }
        }

        const interval = setInterval(() => {
          if (settled) return;
          const pos = ctx.avatarController.getPosition();
          for (const user of ctx.worldConnection.getOtherUsers()) {
            if (nearbyAtStart.has(user.connectionId)) continue;
            const d = distance(pos, user.position);
            if (d <= proximityDistance) {
              extraEvents.push({
                type: "proximity",
                name: user.username,
                id: user.connectionId,
                distance: round2(d),
              });
              tryFinish();
              return;
            }
          }
        }, PROXIMITY_CHECK_INTERVAL_MS);
        cleanups.push(() => clearInterval(interval));
      }
    });
  },
};

/** Pick the trigger label from the first event. */
function determineTrigger(events: ObserveEvent[]): string {
  return events.length > 0 ? events[0].type : "timeout";
}

const USER_EVENT_TYPES = new Set(["user_joined", "user_left", "proximity"]);

/** Check if any events are user-related (join/leave/proximity). */
function hasUserEvents(events: ObserveEvent[]): boolean {
  return events.some((e) => USER_EVENT_TYPES.has(e.type));
}

/**
 * Merge scene_changed events into a single enriched event with nearby
 * labels, clickables, and interactions.
 */
function enrichSceneEvents(events: ObserveEvent[], ctx: ToolContext): ObserveEvent[] {
  const sceneChanges: string[] = [];
  const sceneElements: Array<{
    nodeId: number;
    tag: string;
    attribute?: string;
    newValue?: string;
  }> = [];
  const nonScene: ObserveEvent[] = [];

  for (const e of events) {
    if (e.type === "scene_changed" && Array.isArray(e.changes)) {
      sceneChanges.push(...(e.changes as string[]));
      if (Array.isArray(e.changedElements)) {
        sceneElements.push(
          ...(e.changedElements as Array<{
            nodeId: number;
            tag: string;
            attribute?: string;
            newValue?: string;
          }>),
        );
      }
    } else {
      nonScene.push(e);
    }
  }

  if (sceneChanges.length === 0) return events;

  const sceneEvent: ObserveEvent = {
    type: "scene_changed",
    changes: sceneChanges,
  };
  if (sceneElements.length > 0) {
    sceneEvent.changedElements = sceneElements;
  }

  if (ctx.headlessScene) {
    const pos = ctx.avatarController.getPosition();

    const labels = ctx.headlessScene
      .getLabelElements(pos, 15)
      .map((l) => ({
        content: l.attributes.content,
        position: roundPos(l.position),
        nodeId: l.nodeId,
      }))
      .filter((l) => l.content && l.content !== "[too far to read — move closer]");
    if (labels.length > 0) sceneEvent.labels = labels;
  }

  return [...nonScene, sceneEvent];
}

function buildResponse(
  trigger: string,
  ctx: ToolContext,
  events: ObserveEvent[],
  includeUsers: boolean,
): ToolResult {
  // Use Date.now() + 1 so that the next observe call with this cursor
  // does not re-deliver events that were captured at exactly this timestamp.
  const cursor = Date.now() + 1;
  ctx.eventBuffer?.setLastCursor(cursor);
  const pos = ctx.avatarController.getPosition();

  const result: Record<string, unknown> = {
    trigger,
    resume_from: cursor,
    position: roundPos(pos),
    moving: ctx.avatarController.isMoving(),
  };

  if (events.length > 0) {
    result.events = events;
  }

  // Only include users when user-related events occurred or explicitly requested
  if (includeUsers) {
    const others = ctx.worldConnection.getOtherUsers();
    if (others.length > 0) {
      result.users = others.map((u) => ({
        name: u.username,
        id: u.connectionId,
        position: roundPos(u.position),
        distance: round2(distance(pos, u.position)),
      }));
    }
  }

  return textResult(result);
}

export default observe;
