import type { WorldEvent } from "@mml-io/3d-web-experience-client";

import type { ToolContext } from "./registry";

/** Maximum number of events stored in the buffer by default. */
const DEFAULT_MAX_EVENTS = 1000;

export type BufferedEvent = {
  timestamp: number;
  type: string;
  [key: string]: unknown;
};

/**
 * Persistent event buffer that captures world, avatar, and scene events
 * between observe() calls. Created lazily on the first observe() invocation
 * and stored on the ToolContext for reuse.
 */
export class EventBuffer {
  private events: BufferedEvent[] = [];
  private maxEvents: number;
  private notifyCallbacks = new Set<(type: string) => void>();
  private cleanups: Array<() => void> = [];
  private lastObservedCursor: number = 0;

  constructor(ctx: ToolContext, maxEvents = DEFAULT_MAX_EVENTS) {
    this.maxEvents = maxEvents;
    this.setupListeners(ctx);
  }

  private setupListeners(ctx: ToolContext): void {
    // User join/leave (chat is handled separately via getChatHistory)
    const onWorldEvent = (event: WorldEvent) => {
      if (event.type === "user_joined") {
        this.push({ type: "user_joined", name: event.username, id: event.connectionId });
      } else if (event.type === "user_left") {
        this.push({ type: "user_left", name: event.username, id: event.connectionId });
      }
    };
    ctx.worldConnection.addEventListener(onWorldEvent);
    this.cleanups.push(() => ctx.worldConnection.removeEventListener(onWorldEvent));

    // Avatar movement events
    const avatarEvents: Array<[string, string]> = [
      ["arrived", "arrival"],
      ["stuck", "stuck"],
      ["follow_lost", "follow_lost"],
    ];
    for (const [emitterEvent, bufferType] of avatarEvents) {
      const handler = () => this.push({ type: bufferType });
      ctx.avatarController.on(emitterEvent, handler);
      this.cleanups.push(() => ctx.avatarController.removeListener(emitterEvent, handler));
    }

    // Scene changes
    if (ctx.headlessScene) {
      const onSceneChanged = (
        changes: string[],
        changedElements: Array<{
          nodeId: number;
          tag: string;
          attribute?: string;
          newValue?: string;
        }>,
      ) => {
        this.push({
          type: "scene_changed",
          changes,
          changedElements: changedElements.length > 0 ? changedElements : undefined,
        });
      };
      ctx.headlessScene.onSceneChanged(onSceneChanged);
      this.cleanups.push(() => ctx.headlessScene!.offSceneChanged(onSceneChanged));
    }

    // NavMesh ready (one-shot)
    if (ctx.navMeshManager && !ctx.navMeshManager.isReady) {
      const onReady = () => this.push({ type: "navmesh_ready" });
      ctx.navMeshManager.once("ready", onReady);
      this.cleanups.push(() => ctx.navMeshManager!.removeListener("ready", onReady));
    }
  }

  private push(event: { type: string; [key: string]: unknown }): void {
    this.events.push({ ...event, timestamp: Date.now() } as BufferedEvent);
    while (this.events.length > this.maxEvents) {
      this.events.shift();
    }
    const type = event.type;
    for (const cb of this.notifyCallbacks) cb(type);
  }

  /** Return events since the given timestamp matching the given types (timestamps stripped).
   *  Consecutive events of the same type within DEDUP_TYPES are collapsed into one. */
  getSince(since: number, types: Set<string>): Array<Omit<BufferedEvent, "timestamp">> {
    const results: Array<Omit<BufferedEvent, "timestamp">> = [];
    let lastType: string | null = null;
    for (const e of this.events) {
      if (e.timestamp >= since && types.has(e.type)) {
        // Collapse consecutive duplicate arrivals
        if (e.type === "arrival" && lastType === "arrival") continue;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { timestamp, ...rest } = e;
        results.push(rest);
        lastType = e.type;
      }
    }
    return results;
  }

  /** Return true if any matching events exist since the given timestamp. */
  hasSince(since: number, types: Set<string>): boolean {
    return this.events.some((e) => e.timestamp >= since && types.has(e.type));
  }

  /** Remove events at or before the given timestamp. */
  pruneBefore(timestamp: number): void {
    const idx = this.events.findIndex((e) => e.timestamp > timestamp);
    if (idx > 0) {
      this.events.splice(0, idx);
    } else if (idx === -1) {
      this.events.length = 0;
    }
  }

  /** Register a callback invoked whenever a new event is pushed. Returns unsubscribe fn. */
  onEvent(cb: (type: string) => void): () => void {
    this.notifyCallbacks.add(cb);
    return () => this.notifyCallbacks.delete(cb);
  }

  /** Return the cursor (timestamp) from the last observe call, or 0 if never observed. */
  getLastCursor(): number {
    return this.lastObservedCursor;
  }

  /** Update the cursor to the given timestamp. Called by observe after building a response. */
  setLastCursor(ts: number): void {
    this.lastObservedCursor = ts;
  }

  /** Tear down all persistent listeners and clear the buffer. */
  dispose(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.notifyCallbacks.clear();
    this.events.length = 0;
  }
}
