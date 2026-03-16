import { EventEmitter } from "events";

import {
  CollisionsManager,
  LocalController,
  SpawnConfiguration,
  Vect3,
  Quat,
  createDefaultCharacterControllerValues,
  normalizeSpawnConfiguration,
} from "@mml-io/3d-web-client-core";
import type { WorldConnection } from "@mml-io/3d-web-experience-client";
import type { UserNetworkingClientUpdate } from "@mml-io/3d-web-user-networking";

import { HeadlessCameraManager } from "./HeadlessCameraManager";
import type { NavMeshManager } from "./NavMeshManager";
import { ProgrammaticInputProvider } from "./ProgrammaticInputProvider";
import type { Position } from "./tools/utils";

export type { Position } from "./tools/utils";
export type Rotation = { eulerY: number };

const TICK_MS = 16; // ~60 Hz (matches client's requestAnimationFrame cadence)
const TARGET_FPS = 60;
const FIXED_DELTA_TIME = 1 / TARGET_FPS;
const DEFAULT_SPEED = 3.0;
export const ARRIVAL_THRESHOLD = 0.5;
const AUTO_CHAIN_THRESHOLD = 1.0;

// Auto-jump thresholds
const AUTO_JUMP_Y_THRESHOLD = 0.35;
const AUTO_JUMP_APPROACH_XZ = 1.5;

// Stuck detection — two different thresholds depending on navigation mode:
//
// Without navmesh (jumpIndices == null): the avatar has no path plan, so it
// tries a reactive jump after STUCK_TICK_COUNT ticks (~64ms). This is a fast
// heuristic to get unstuck from small obstacles.
//
// With navmesh (jumpIndices != null): the avatar has a planned path with known
// jump points. Being "stuck" likely means the path is invalid rather than a
// simple obstacle, so we wait longer (NAVMESH_STALL_TICKS = 20 ticks, ~320ms)
// before attempting a full repath. Jumping prematurely would fight the planned
// path and waste double-jump resources.
const STUCK_TICK_COUNT = 4;
const STUCK_MOVE_EPSILON = 0.02;
const NAVMESH_STALL_TICKS = 20;
const MAX_STUCK_REPATHS = 3;

// Follow mode
const FOLLOW_POLL_MS = 250;
const FOLLOW_REPATH_THRESHOLD = 2.0;

/**
 * High-level avatar controller for the agent bridge.
 *
 * Uses LocalController from @mml-io/3d-web-client-core for physics — the same
 * physics code that runs in the human client. Movement is driven via a
 * ProgrammaticInputProvider and HeadlessCameraManager instead of keyboard/mouse.
 */
export class AvatarController extends EventEmitter {
  private inputProvider: ProgrammaticInputProvider;
  private cameraManager: HeadlessCameraManager;
  private localController: LocalController;

  private currentPosition: Position = { x: 0, y: 0, z: 0 };
  private currentRotation: Rotation = { eulerY: 0 };
  private targetPosition: Position | null = null;
  private waypoints: Position[] = [];
  private waypointIndex: number = 0;
  private speed: number = DEFAULT_SPEED;
  private animationState: number = 0;
  private tickInterval: ReturnType<typeof setInterval>;
  private lastTick: number = Date.now();
  private accumulatedTime: number = 0;
  private stuckTicks: number = 0;
  private stuckRepathCount: number = 0;
  private lastTickPosition: Position = { x: 0, y: 0, z: 0 };
  private jumpIndices: Set<number> | null = null;

  private ultimateDestination: Position | null = null;
  private navMeshManagerRef: NavMeshManager | null = null;

  // Follow mode
  private followInterval: ReturnType<typeof setInterval> | null = null;
  private followUserId: number | null = null;
  private followStopDistance: number = 2.0;
  private followSpeed: number = DEFAULT_SPEED;
  private followWorldConnection: WorldConnection | null = null;
  private followLastTargetPos: Position | null = null;

  constructor(
    private collisionsManager: CollisionsManager,
    spawnConfig?: SpawnConfiguration,
  ) {
    super();

    this.inputProvider = new ProgrammaticInputProvider();
    this.cameraManager = new HeadlessCameraManager();

    const spawnConfiguration = normalizeSpawnConfiguration(spawnConfig);

    const position = new Vect3(
      spawnConfiguration.spawnPosition.x,
      spawnConfiguration.spawnPosition.y,
      spawnConfiguration.spawnPosition.z,
    );
    const quaternion = new Quat(0, 0, 0, 1);

    this.localController = new LocalController({
      id: 0,
      position,
      quaternion,
      collisionsManager: this.collisionsManager,
      keyInputManager: this.inputProvider,
      cameraManager: this.cameraManager,
      spawnConfiguration,
      characterControllerValues: createDefaultCharacterControllerValues(),
    });

    this.currentPosition = { x: position.x, y: position.y, z: position.z };
    this.lastTickPosition = { ...this.currentPosition };

    this.tickInterval = setInterval(() => this.tick(), TICK_MS);
  }

  updateSpawnConfig(spawnConfig: SpawnConfiguration): void {
    const normalized = normalizeSpawnConfiguration(spawnConfig);
    this.localController.updateSpawnConfig(normalized);
  }

  setNavMeshManager(mgr: NavMeshManager): void {
    this.navMeshManagerRef = mgr;
  }

  private tick(): void {
    const now = Date.now();
    const elapsedSeconds = Math.min((now - this.lastTick) / 1000, 0.1);
    this.lastTick = now;
    this.accumulatedTime += elapsedSeconds;

    let physicsUpdated = false;

    while (this.accumulatedTime >= FIXED_DELTA_TIME) {
      this.accumulatedTime -= FIXED_DELTA_TIME;
      physicsUpdated = true;
      this.physicsTick();
    }

    if (physicsUpdated) {
      this.emit("positionUpdate", this.buildUpdate());
    }
  }

  private physicsTick(): void {
    this.updateMovementInput();

    // Update camera position for LocalController's azimuthal angle calculation
    this.cameraManager.setCharacterPosition(this.currentPosition);
    this.collisionsManager.setCharacterPosition(
      new Vect3(this.currentPosition.x, this.currentPosition.y, this.currentPosition.z),
    );

    // Run the same physics as the human client with fixed timestep
    this.localController.update(FIXED_DELTA_TIME);

    // Read back position from the physics controller
    const pos = this.localController.config.position;
    this.currentPosition = { x: pos.x, y: pos.y, z: pos.z };
    const quat = this.localController.config.quaternion;
    this.currentRotation = { eulerY: 2 * Math.atan2(quat.y, quat.w) };

    this.attemptAutoJump();
    this.attemptDoubleJump();
    this.detectStuck();
    this.lastTickPosition = { ...this.currentPosition };
    this.checkWaypointArrival();

    // Determine animation state from LocalController unless an override is active
    if (this.animationOverride !== null) {
      this.animationState = this.animationOverride;
    } else {
      this.animationState = this.localController.getTargetAnimation();
    }
  }

  /** Set input direction toward the current target position. */
  private updateMovementInput(): void {
    if (this.targetPosition) {
      const dx = this.targetPosition.x - this.currentPosition.x;
      const dz = this.targetPosition.z - this.currentPosition.z;
      const xzDist = Math.sqrt(dx * dx + dz * dz);

      if (xzDist > ARRIVAL_THRESHOLD) {
        const heading = Math.atan2(dx, dz);
        this.inputProvider.setDirection(heading);
        this.inputProvider.setSprinting(this.speed > DEFAULT_SPEED);
      } else {
        this.inputProvider.clear();
      }
    } else {
      this.inputProvider.clear();
    }
  }

  /** Pre-emptive jump when approaching a waypoint that is above the avatar. */
  private attemptAutoJump(): void {
    if (!this.localController.characterOnGround || !this.targetPosition) return;

    const allowAutoJump = this.jumpIndices ? this.jumpIndices.has(this.waypointIndex) : true;
    if (!allowAutoJump) return;

    const yDiff = this.targetPosition.y - this.currentPosition.y;
    if (yDiff <= AUTO_JUMP_Y_THRESHOLD) return;

    const dx = this.targetPosition.x - this.currentPosition.x;
    const dz = this.targetPosition.z - this.currentPosition.z;
    const xzDist = Math.sqrt(dx * dx + dz * dz);
    const approachXZ = Math.max(AUTO_JUMP_APPROACH_XZ, yDiff + 0.5);
    if (xzDist < approachXZ) {
      const requiredHeight = yDiff + 0.5;
      const proportionalForce = Math.sqrt(2 * this.localController.gravity * -1 * requiredHeight);
      this.localController.jump(Math.min(proportionalForce, this.localController.jumpForce));
    }
  }

  /** Double-jump while airborne if the planned path requires it. */
  private attemptDoubleJump(): void {
    if (
      this.localController.characterOnGround ||
      this.localController.jumpCounter !== 1 ||
      !this.targetPosition ||
      !this.jumpIndices?.has(this.waypointIndex)
    ) {
      return;
    }

    const yDiff = this.targetPosition.y - this.currentPosition.y;
    if (yDiff <= AUTO_JUMP_Y_THRESHOLD) return;

    const gravity = this.localController.gravity * -1;
    const vy = this.localController.verticalVelocity;
    const additionalHeight = vy > 0 && gravity > 0 ? (vy * vy) / (2 * gravity) : 0;
    const predictedMaxY = this.currentPosition.y + additionalHeight;
    const requiredY = this.targetPosition.y + 0.5;

    if (predictedMaxY < requiredY) {
      const heightNeeded = requiredY - this.currentPosition.y;
      const totalVyNeeded = Math.sqrt(2 * gravity * Math.max(0, heightNeeded));
      const clampedForce = Math.min(
        Math.max(totalVyNeeded, 2.0),
        this.localController.doubleJumpForce,
      );
      this.localController.jump(clampedForce);
    }
  }

  /** Detect when the avatar is stuck and attempt recovery (reactive jump or repath). */
  private detectStuck(): void {
    if (!this.targetPosition) {
      this.stuckTicks = 0;
      return;
    }

    const moveDx = this.currentPosition.x - this.lastTickPosition.x;
    const moveDz = this.currentPosition.z - this.lastTickPosition.z;
    const moveDist = Math.sqrt(moveDx * moveDx + moveDz * moveDz);

    if (moveDist >= STUCK_MOVE_EPSILON) {
      this.stuckTicks = 0;
      return;
    }

    this.stuckTicks++;

    // Airborne stuck: generous timeout before repath/give-up since the avatar
    // may still be mid-arc.
    if (!this.localController.characterOnGround) {
      this.handleStuck(NAVMESH_STALL_TICKS * 2);
      return;
    }

    if (this.jumpIndices) {
      // Navmesh-guided path — attempt repath after longer stall
      this.handleStuck(NAVMESH_STALL_TICKS);
    } else {
      // No navmesh — reactive jump to get unstuck
      if (this.stuckTicks >= STUCK_TICK_COUNT) {
        const yDiff = this.targetPosition!.y - this.currentPosition.y;
        if (yDiff > 0.1) {
          const requiredHeight = yDiff + 0.5;
          const gravity = this.localController.gravity * -1;
          const force = Math.min(
            Math.sqrt(2 * gravity * requiredHeight),
            this.localController.jumpForce,
          );
          this.localController.jump(force);
        } else {
          this.localController.jump(8);
        }
        this.stuckTicks = 0;
      }
    }
  }

  /**
   * Attempt repath or give up when stuck for longer than tickThreshold ticks.
   * If a navmesh path is active and repath budget remains, re-plan from the
   * current position. Otherwise, clear navigation state and emit "stuck".
   */
  private handleStuck(tickThreshold: number): void {
    if (this.stuckTicks < tickThreshold) {
      return;
    }

    if (this.jumpIndices && this.navMeshManagerRef) {
      this.stuckRepathCount++;
      if (this.stuckRepathCount <= MAX_STUCK_REPATHS && this.ultimateDestination) {
        this.stuckTicks = 0;
        this.autoChainNextSegment();
        return;
      }
    }

    this.targetPosition = null;
    this.waypoints = [];
    this.waypointIndex = 0;
    this.jumpIndices = null;
    this.ultimateDestination = null;
    this.stuckRepathCount = 0;
    this.emit("stuck");
    this.stuckTicks = 0;
  }

  /** Advance to the next waypoint or chain to a new path segment on arrival. */
  private checkWaypointArrival(): void {
    if (!this.targetPosition) return;

    const dx = this.targetPosition.x - this.currentPosition.x;
    const dz = this.targetPosition.z - this.currentPosition.z;
    const xzDist = Math.sqrt(dx * dx + dz * dz);

    if (xzDist > ARRIVAL_THRESHOLD) return;

    this.stuckRepathCount = 0;
    if (this.waypoints.length > 0 && this.waypointIndex < this.waypoints.length - 1) {
      this.waypointIndex++;
      this.targetPosition = { ...this.waypoints[this.waypointIndex] };
      return;
    }

    if (this.ultimateDestination && this.navMeshManagerRef) {
      const udx = this.ultimateDestination.x - this.currentPosition.x;
      const udz = this.ultimateDestination.z - this.currentPosition.z;
      const udist = Math.sqrt(udx * udx + udz * udz);

      if (udist > AUTO_CHAIN_THRESHOLD) {
        this.autoChainNextSegment();
        return;
      }
    }

    this.ultimateDestination = null;
    this.targetPosition = null;
    this.waypoints = [];
    this.waypointIndex = 0;
    this.emit("arrived");
  }

  private buildUpdate(): UserNetworkingClientUpdate {
    return {
      position: { ...this.currentPosition },
      rotation: { ...this.currentRotation },
      state: this.animationState,
    };
  }

  moveTo(x: number, y: number, z: number, speed?: number): void {
    this.cancelFollow();
    this.animationOverride = null;
    this.ultimateDestination = null;
    this.waypoints = [];
    this.waypointIndex = 0;
    this.targetPosition = { x, y, z };
    this.speed = speed ?? DEFAULT_SPEED;
    this.stuckTicks = 0;
    this.stuckRepathCount = 0;
    this.jumpIndices = null;
  }

  followPath(path: Position[], speed?: number, jumpIndices?: Set<number>): void {
    if (path.length === 0) return;
    this.cancelFollow();
    this.animationOverride = null;
    this.waypoints = path.map((p) => ({ ...p }));
    this.waypointIndex = 0;
    this.targetPosition = { ...this.waypoints[0] };
    this.speed = speed ?? DEFAULT_SPEED;
    this.stuckTicks = 0;
    this.stuckRepathCount = 0;
    this.jumpIndices = jumpIndices ?? null;
  }

  getCurrentPath(): Position[] {
    return this.waypoints.map((p) => ({ ...p }));
  }

  getWaypointIndex(): number {
    return this.waypointIndex;
  }

  stop(): void {
    this.cancelFollow();
    this.ultimateDestination = null;
    this.targetPosition = null;
    this.waypoints = [];
    this.waypointIndex = 0;
    this.stuckTicks = 0;
    this.stuckRepathCount = 0;
    this.jumpIndices = null;
    this.inputProvider.clear();
    this.emit("arrived");
  }

  teleport(x: number, y: number, z: number): void {
    this.cancelFollow();
    this.ultimateDestination = null;
    this.currentPosition = { x, y, z };
    this.localController.config.position.set(x, y, z);
    this.localController.resetVelocity();
    this.targetPosition = null;
    this.waypoints = [];
    this.waypointIndex = 0;
    this.animationState = 0;
    this.stuckTicks = 0;
    this.stuckRepathCount = 0;
    this.jumpIndices = null;
    this.inputProvider.clear();
    this.emit("arrived");
  }

  jump(): boolean {
    return this.localController.jump();
  }

  get onGround(): boolean {
    return this.localController.characterOnGround;
  }

  getPosition(): Position {
    return { ...this.currentPosition };
  }

  getRotation(): Rotation {
    return { ...this.currentRotation };
  }

  isMoving(): boolean {
    return this.targetPosition !== null || this.waypoints.length > 0;
  }

  getAnimationState(): number {
    return this.animationState;
  }

  private animationOverride: number | null = null;

  setAnimationState(state: number): void {
    this.animationState = state;
    this.animationOverride = state;
  }

  clearAnimationOverride(): void {
    this.animationOverride = null;
  }

  distanceToTarget(): number {
    if (!this.targetPosition) return 0;
    const dx = this.targetPosition.x - this.currentPosition.x;
    const dz = this.targetPosition.z - this.currentPosition.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  waitForArrival(timeoutMs: number = 60000): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (!this.targetPosition && this.waypoints.length === 0) {
        resolve(true);
        return;
      }

      const cleanup = () => {
        clearTimeout(timer);
        this.removeListener("arrived", onArrived);
        this.removeListener("stuck", onStuck);
      };

      const onArrived = () => {
        cleanup();
        resolve(true);
      };

      const onStuck = () => {
        cleanup();
        resolve(false);
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);

      this.once("arrived", onArrived);
      this.once("stuck", onStuck);
    });
  }

  setUltimateDestination(dest: Position | null): void {
    this.ultimateDestination = dest ? { ...dest } : null;
  }

  getUltimateDestination(): Position | null {
    return this.ultimateDestination ? { ...this.ultimateDestination } : null;
  }

  private autoChainNextSegment(): void {
    if (!this.ultimateDestination || !this.navMeshManagerRef) return;

    const from = this.currentPosition;
    const to = this.ultimateDestination;

    if (!this.navMeshManagerRef.isWithinRegion(to)) {
      const edgePoint = this.navMeshManagerRef.computeEdgePoint(from, to);
      if (edgePoint) {
        const result = this.navMeshManagerRef.computePathWithJumpInfo(from, edgePoint);
        if (result && result.path.length > 0) {
          this.waypoints = result.path.map((p) => ({ ...p }));
          this.waypointIndex = 0;
          this.targetPosition = { ...this.waypoints[0] };
          this.stuckTicks = 0;
          this.jumpIndices = result.jumpIndices.size > 0 ? result.jumpIndices : null;
          return;
        }
      }
    }

    const result = this.navMeshManagerRef.computePathWithJumpInfo(from, to);
    if (result && result.path.length > 0) {
      this.waypoints = result.path.map((p) => ({ ...p }));
      this.waypointIndex = 0;
      this.targetPosition = { ...this.waypoints[0] };
      this.stuckTicks = 0;
      this.jumpIndices = result.jumpIndices.size > 0 ? result.jumpIndices : null;
      return;
    }

    this.ultimateDestination = null;
    this.targetPosition = null;
    this.waypoints = [];
    this.waypointIndex = 0;
    this.emit("arrived");
  }

  startFollowing(
    userId: number,
    worldConnection: WorldConnection,
    stopDistance: number = 2.0,
    speed: number = DEFAULT_SPEED,
  ): void {
    this.cancelFollow();
    this.followUserId = userId;
    this.followWorldConnection = worldConnection;
    this.followStopDistance = stopDistance;
    this.followSpeed = speed;
    this.followLastTargetPos = null;

    this.followInterval = setInterval(() => {
      this.followTick();
    }, FOLLOW_POLL_MS);

    this.followTick();
  }

  private followTick(): void {
    if (this.followUserId === null || !this.followWorldConnection) return;

    const users = this.followWorldConnection.getOtherUsers();
    const target = users.find((u) => u.connectionId === this.followUserId);

    if (!target) {
      this.cancelFollow();
      this.stop();
      this.emit("follow_lost");
      return;
    }

    const targetPos = target.position;
    const myPos = this.currentPosition;

    const dx = targetPos.x - myPos.x;
    const dz = targetPos.z - myPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist <= this.followStopDistance) {
      if (this.targetPosition) {
        this.targetPosition = null;
        this.waypoints = [];
        this.waypointIndex = 0;
        this.jumpIndices = null;
        this.inputProvider.clear();
        this.emit("arrived");
      }
      return;
    }

    if (this.followLastTargetPos) {
      const tdx = targetPos.x - this.followLastTargetPos.x;
      const tdz = targetPos.z - this.followLastTargetPos.z;
      const targetMoved = Math.sqrt(tdx * tdx + tdz * tdz);
      if (targetMoved < FOLLOW_REPATH_THRESHOLD && this.targetPosition) {
        return;
      }
    }

    this.followLastTargetPos = { ...targetPos };

    // dist is always > followStopDistance here (guarded by the early return above)
    const ratio = (dist - this.followStopDistance) / dist;
    const approachPos: Position = {
      x: myPos.x + dx * ratio,
      y: targetPos.y,
      z: myPos.z + dz * ratio,
    };

    if (this.navMeshManagerRef && this.navMeshManagerRef.isReady) {
      const result = this.navMeshManagerRef.computePathWithJumpInfo(myPos, approachPos);
      if (result && result.path.length > 0) {
        this.waypoints = result.path.map((p) => ({ ...p }));
        this.waypointIndex = 0;
        this.targetPosition = { ...this.waypoints[0] };
        this.speed = this.followSpeed;
        this.stuckTicks = 0;
        this.jumpIndices = result.jumpIndices.size > 0 ? result.jumpIndices : null;
        this.ultimateDestination = null;
        return;
      }
    }

    this.waypoints = [];
    this.waypointIndex = 0;
    this.targetPosition = { ...approachPos };
    this.speed = this.followSpeed;
    this.stuckTicks = 0;
    this.jumpIndices = null;
    this.ultimateDestination = null;
  }

  stopFollowing(): void {
    this.cancelFollow();
    this.ultimateDestination = null;
    this.targetPosition = null;
    this.waypoints = [];
    this.waypointIndex = 0;
    this.stuckTicks = 0;
    this.jumpIndices = null;
    this.inputProvider.clear();
  }

  private cancelFollow(): void {
    if (this.followInterval) {
      clearInterval(this.followInterval);
      this.followInterval = null;
    }
    this.followUserId = null;
    this.followWorldConnection = null;
    this.followLastTargetPos = null;
  }

  isFollowing(): boolean {
    return this.followUserId !== null;
  }

  getFollowUserId(): number | null {
    return this.followUserId;
  }

  destroy(): void {
    this.cancelFollow();
    this.stop();
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }
    this.removeAllListeners();
  }
}
