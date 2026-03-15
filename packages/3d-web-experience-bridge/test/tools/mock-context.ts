import { EventEmitter } from "events";

import { vi } from "vitest";

import { EventBuffer } from "../../src/tools/EventBuffer";
import type { ToolContext } from "../../src/tools/registry";

/**
 * Creates a mock ToolContext for unit-testing tool execute() functions.
 * All methods are vi.fn() stubs with sensible defaults.
 */
export function createMockContext(overrides?: Partial<ToolContext>): ToolContext & {
  avatarController: any;
  worldConnection: any;
  headlessScene: any;
  navMeshManager: any;
} {
  const avatarEmitter = new EventEmitter();
  const eventListeners: Array<(event: any) => void> = [];
  const navMeshEmitter = new EventEmitter();

  const avatarController = {
    getPosition: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }),
    getRotation: vi.fn().mockReturnValue({ eulerY: 0 }),
    isMoving: vi.fn().mockReturnValue(false),
    distanceToTarget: vi.fn().mockReturnValue(0),
    get onGround() {
      return true;
    },
    moveTo: vi.fn(),
    teleport: vi.fn(),
    stop: vi.fn(),
    jump: vi.fn().mockReturnValue(true),
    followPath: vi.fn(),
    startFollowing: vi.fn(),
    stopFollowing: vi.fn(),
    isFollowing: vi.fn().mockReturnValue(false),
    getFollowUserId: vi.fn().mockReturnValue(null),
    setAnimationState: vi.fn(),
    clearAnimationOverride: vi.fn(),
    getAnimationState: vi.fn().mockReturnValue(0),
    waitForArrival: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    setUltimateDestination: vi.fn(),
    getUltimateDestination: vi.fn().mockReturnValue(null),
    // EventEmitter methods
    once: vi.fn((event: string, listener: (...args: any[]) => void) => {
      avatarEmitter.once(event, listener);
    }),
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      avatarEmitter.on(event, listener);
    }),
    removeListener: vi.fn((event: string, listener: (...args: any[]) => void) => {
      avatarEmitter.removeListener(event, listener);
    }),
    emit: (event: string, ...args: any[]) => avatarEmitter.emit(event, ...args),
  } as any;

  const worldConnection = {
    getOtherUsers: vi.fn().mockReturnValue([]),
    getConnectionId: vi.fn().mockReturnValue(1),
    getUsername: vi.fn().mockReturnValue("Agent"),
    getChatHistory: vi.fn().mockReturnValue([]),
    sendChatMessage: vi.fn(),
    sendCustomMessage: vi.fn(),
    updateCharacterDescription: vi.fn(),
    updateUsername: vi.fn(),
    updateColors: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    addEventListener: vi.fn((listener: (event: any) => void) => {
      eventListeners.push(listener);
    }),
    removeEventListener: vi.fn((listener: (event: any) => void) => {
      const idx = eventListeners.indexOf(listener);
      if (idx !== -1) eventListeners.splice(idx, 1);
    }),
    // Helper to emit events in tests
    _emitEvent: (event: any) => {
      for (const listener of [...eventListeners]) {
        listener(event);
      }
    },
  } as any;

  const sceneChangeEmitter = new EventEmitter();
  const headlessScene = {
    isLoaded: true,
    colliderCount: 3,
    getSceneSummary: vi.fn().mockReturnValue({
      meshCount: 5,
      boundingBox: { min: [-10, 0, -10], max: [10, 5, 10] },
      landmarks: [],
    }),
    getClickableElements: vi.fn().mockReturnValue([]),
    getInteractionElements: vi.fn().mockReturnValue([]),
    getLabelElements: vi.fn().mockReturnValue([]),
    getElementTypeCounts: vi.fn().mockReturnValue({}),
    getCategorizedElements: vi.fn().mockReturnValue([]),
    getAllElements: vi.fn().mockReturnValue([]),
    clickNode: vi.fn().mockReturnValue({ success: true }),
    triggerInteraction: vi.fn().mockReturnValue({ success: true, prompt: "Test" }),
    getElementByNodeId: vi.fn().mockReturnValue(null),
    getFilteredSceneInfo: vi.fn().mockReturnValue([]),
    onSceneChanged: vi.fn((handler: (...args: any[]) => void) => {
      sceneChangeEmitter.on("scene_changed", handler);
    }),
    offSceneChanged: vi.fn((handler: (...args: any[]) => void) => {
      sceneChangeEmitter.off("scene_changed", handler);
    }),
    _emitSceneChanged: (changes: string[], changedElements: any[] = []) => {
      sceneChangeEmitter.emit("scene_changed", changes, changedElements);
    },
  } as any;

  const navMeshManager = {
    isReady: true,
    computePathWithJumpInfo: vi.fn().mockReturnValue({
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 5 },
      ],
      jumpIndices: new Set<number>(),
    }),
    isWithinRegion: vi.fn().mockReturnValue(true),
    computeEdgePoint: vi.fn().mockReturnValue({ x: 5, y: 0, z: 5 }),
    waitForReady: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    once: vi.fn((event: string, listener: (...args: any[]) => void) => {
      navMeshEmitter.once(event, listener);
    }),
    removeListener: vi.fn((event: string, listener: (...args: any[]) => void) => {
      navMeshEmitter.removeListener(event, listener);
    }),
    _emitEvent: (event: string) => navMeshEmitter.emit(event),
  } as any;

  const ctx: ToolContext = {
    worldConnection,
    avatarController,
    headlessScene,
    navMeshManager,
    serverUrl: "http://127.0.0.1:8080",
    ...overrides,
  };
  ctx.eventBuffer = new EventBuffer(ctx);
  return ctx as any;
}

/** Parse the JSON text from a tool result. */
export function parseResult(result: { content: Array<{ type: string; text: string }> }): any {
  return JSON.parse(result.content[0].text);
}
