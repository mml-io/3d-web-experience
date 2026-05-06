import { EventEmitter } from "events";

import { CollisionsManager, Matr4 } from "@mml-io/3d-web-client-core";
import {
  registerCustomElementsToVirtualDocument,
  MMLNetworkSource,
  MMLDocumentTimeManager,
  setGlobalMMLScene,
  setGlobalDocumentTimeManager,
  LoadingProgressManager,
  type IMMLScene,
  MElement,
  VirtualDocument,
  VirtualHTMLElement,
  VirtualNode,
  VirtualCustomEvent,
} from "@mml-io/mml-web";
import {
  ThreeJSGraphicsInterface,
  ThreeJSResourceManager,
  type ThreeJSGraphicsAdapter,
} from "@mml-io/mml-web-threejs";
import * as THREE from "three";
import WebSocket from "ws";

import { createCollisionMesh } from "./ColliderUtils";
import { debug } from "./logger";
import { LABEL_READ_DISTANCE } from "./tools/utils";

const TICK_MS = 50; // 20 Hz

/** CSS selector matching all MML geometry/content element types. */
const MML_GEOMETRY_SELECTOR =
  "m-cube, m-sphere, m-cylinder, m-plane, m-model, m-group, m-label, m-image, m-frame, m-interaction";

/** Polyfill WebSocket globally for networked-dom-web (idempotent). */
function ensureGlobalWebSocket(): void {
  if (!(globalThis as any).WebSocket) {
    (globalThis as any).WebSocket = WebSocket;
  }
}

export type GetPositionAndRotation = () => {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
};

// ---------------------------------------------------------------------------
// Virtual DOM change-detection hooks
//
// Instead of MutationObserver (which had bugs with
// setAttribute on custom elements), we hook into the virtual DOM prototype
// methods to detect MML element additions, removals, and attribute changes.
//
// Safety: The prototype patches are installed once globally, but dispatch is
// scoped per-document via the `handlersByDoc` WeakMap. Each HeadlessMMLScene
// creates its own VirtualDocument, so multiple instances coexist safely as
// long as they don't share a VirtualDocument.
// ---------------------------------------------------------------------------

type ChangeHandler = {
  loaded: boolean;
  connecting: boolean;
  onNodeAdded: (node: VirtualNode) => void;
  onNodeRemoved: (node: VirtualNode) => void;
  onAttrChanged: (
    el: VirtualHTMLElement,
    name: string,
    oldVal: string | null,
    newVal: string,
  ) => void;
};

const handlersByDoc = new WeakMap<object, ChangeHandler>();
let changeHooksInstalled = false;

function installChangeHooks(): void {
  if (changeHooksInstalled) return;
  changeHooksInstalled = true;

  // Hook setAttribute for attribute change detection
  const origSetAttr = VirtualHTMLElement.prototype.setAttribute;
  VirtualHTMLElement.prototype.setAttribute = function (name: string, value: string) {
    const oldValue = this.getAttribute(name);
    origSetAttr.call(this, name, value);
    if (this.ownerDocument && this.nodeName?.startsWith?.("M-") && oldValue !== value) {
      const handler = handlersByDoc.get(this.ownerDocument);
      if (handler && handler.loaded && !handler.connecting) {
        handler.onAttrChanged(this, name, oldValue, value);
      }
    }
  };

  // Hook appendChild for tree change detection
  const origAppend = VirtualNode.prototype.appendChild;
  VirtualNode.prototype.appendChild = function (child: VirtualNode) {
    const result = origAppend.call(this, child);
    if (this.ownerDocument) {
      const handler = handlersByDoc.get(this.ownerDocument);
      if (handler && handler.loaded && !handler.connecting) {
        handler.onNodeAdded(child);
      }
    }
    return result;
  };

  // Hook insertBefore
  const origInsert = VirtualNode.prototype.insertBefore;
  VirtualNode.prototype.insertBefore = function (
    newNode: VirtualNode,
    refNode: VirtualNode | null,
  ) {
    const result = origInsert.call(this, newNode, refNode);
    if (this.ownerDocument) {
      const handler = handlersByDoc.get(this.ownerDocument);
      if (handler && handler.loaded && !handler.connecting) {
        handler.onNodeAdded(newNode);
      }
    }
    return result;
  };

  // Hook removeChild
  const origRemove = VirtualNode.prototype.removeChild;
  VirtualNode.prototype.removeChild = function (child: VirtualNode) {
    const handler = this.ownerDocument ? handlersByDoc.get(this.ownerDocument) : null;
    const needsNotify = handler && handler.loaded && !handler.connecting;
    if (needsNotify) handler!.onNodeRemoved(child);
    return origRemove.call(this, child);
  };

  // Hook replaceChild
  const origReplace = VirtualNode.prototype.replaceChild;
  VirtualNode.prototype.replaceChild = function (newChild: VirtualNode, oldChild: VirtualNode) {
    const handler = this.ownerDocument ? handlersByDoc.get(this.ownerDocument) : null;
    const needsNotify = handler && handler.loaded && !handler.connecting;
    if (needsNotify) handler!.onNodeRemoved(oldChild);
    const result = origReplace.call(this, newChild, oldChild);
    if (needsNotify) handler!.onNodeAdded(newChild);
    return result;
  };
}

export class HeadlessMMLScene {
  public readonly scene: THREE.Scene;
  public readonly rootGroup: THREE.Group;
  private documentTimeManager: MMLDocumentTimeManager;
  private mmlSources: MMLNetworkSource[] = [];
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private graphicsRetryInterval: ReturnType<typeof setInterval> | null = null;
  private loadingProgressManager: LoadingProgressManager;
  private mmlScene: IMMLScene<ThreeJSGraphicsAdapter>;
  private graphicsEnabled = false;
  private connectingElements = false;
  private _loaded = false;
  private groundMesh: THREE.Mesh;

  // Virtual DOM: document and root element replace browser document/document.body
  private virtualDoc: VirtualDocument;
  private root: VirtualHTMLElement;

  // Node ID registry for click targeting
  private nodeIdByElement = new Map<any, number>();
  private elementByNodeId = new Map<number, any>();
  // Track document target elements for cleanup
  private documentTargetElements: VirtualHTMLElement[] = [];
  private nextNodeId = 0;

  /** Keyed document tracking for diffing on world config updates. */
  private documentEntries = new Map<
    string,
    { source: MMLNetworkSource; targetElement: VirtualHTMLElement; url: string }
  >();

  // Scene change detection
  private sceneChangeEmitter = new EventEmitter();
  private pendingChanges = new Set<string>();
  private pendingChangedElements: Array<{
    nodeId: number;
    tag: string;
    attribute?: string;
    newValue?: string;
  }> = [];
  private changeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private static readonly CHANGE_DEBOUNCE_MS = 300;
  private static readonly GEOMETRY_ATTRS = new Set([
    "x",
    "y",
    "z",
    "sx",
    "sy",
    "sz",
    "rx",
    "ry",
    "rz",
    "width",
    "height",
    "depth",
    "radius",
    "collide",
  ]);

  private colliderCount_ = 0;

  // Change handler registered with the virtual DOM hooks
  private changeHandler: ChangeHandler;

  onSceneChanged(
    handler: (
      changes: string[],
      changedElements: Array<{
        nodeId: number;
        tag: string;
        attribute?: string;
        newValue?: string;
      }>,
    ) => void,
  ): void {
    this.sceneChangeEmitter.on("scene_changed", handler);
  }

  offSceneChanged(handler: (...args: any[]) => void): void {
    this.sceneChangeEmitter.off("scene_changed", handler);
  }

  private scheduleTimer(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      this.pendingTimers.delete(id);
      fn();
    }, ms);
    this.pendingTimers.add(id);
    return id;
  }

  private emitSceneChange(
    changeType: string,
    elementDetail?: { nodeId: number; tag: string; attribute?: string; newValue?: string },
  ): void {
    if (!this._loaded) return;
    this.pendingChanges.add(changeType);
    if (elementDetail) {
      this.pendingChangedElements.push(elementDetail);
    }
    if (this.changeDebounceTimer) clearTimeout(this.changeDebounceTimer);
    this.changeDebounceTimer = setTimeout(() => {
      const changes = [...this.pendingChanges];
      const changedElements = [...this.pendingChangedElements];
      this.pendingChanges.clear();
      this.pendingChangedElements = [];
      this.sceneChangeEmitter.emit("scene_changed", changes, changedElements);
    }, HeadlessMMLScene.CHANGE_DEBOUNCE_MS);
  }

  constructor(
    private getUserPositionAndRotation: GetPositionAndRotation,
    private collisionsManager: CollisionsManager,
  ) {
    ensureGlobalWebSocket();

    // Set up virtual DOM: create a VirtualDocument with MML elements registered,
    // and a root element that acts as the equivalent of document.body.
    this.virtualDoc = new VirtualDocument();
    registerCustomElementsToVirtualDocument(this.virtualDoc);
    this.root = this.virtualDoc.createElement("div");
    this.root.setRootConnected(true);

    this.scene = new THREE.Scene();
    this.rootGroup = new THREE.Group();
    this.scene.add(this.rootGroup);

    // Ground plane matching the renderer's 210x210 floor at Y=0
    const groundGeometry = new THREE.PlaneGeometry(210, 210);
    groundGeometry.rotateX(-Math.PI / 2);
    this.groundMesh = new THREE.Mesh(groundGeometry, new THREE.MeshBasicMaterial());
    this.groundMesh.name = "ground-plane";
    this.scene.add(this.groundMesh);

    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);

    let audioListener: THREE.AudioListener;
    try {
      audioListener = new THREE.AudioListener();
    } catch {
      audioListener = new THREE.Object3D() as unknown as THREE.AudioListener;
    }

    const resourceManager = new ThreeJSResourceManager();

    // Cast needed: local mml packages have their own @types/three which is
    // structurally identical but TypeScript treats as distinct nominal types.
    const graphicsAdapter = {
      containerType: null as unknown as THREE.Object3D,
      collisionType: null as unknown as THREE.Object3D,
      getGraphicsAdapterFactory: () => ThreeJSGraphicsInterface,
      getRootContainer: () => this.rootGroup,
      getUserPositionAndRotation: () => this.getUserPositionAndRotation(),
      interactionShouldShowDistance: () => null,
      dispose: () => {},
      getResourceManager: () => resourceManager,
      getThreeScene: () => this.scene,
      getCamera: () => camera,
      getAudioListener: () => audioListener,
    } as unknown as ThreeJSGraphicsAdapter;

    this.loadingProgressManager = new LoadingProgressManager();
    this.instrumentLoadingProgressManager(this.loadingProgressManager, "scene-level");
    this.documentTimeManager = new MMLDocumentTimeManager();

    this.mmlScene = {
      getGraphicsAdapter: () => graphicsAdapter,
      hasGraphicsAdapter: () => this.graphicsEnabled,
      addCollider: (collider: unknown, element: MElement) => {
        const tag = (element as any).tagName?.toLowerCase?.() ?? "unknown";
        try {
          const group = collider as THREE.Group;
          const collisionMesh = createCollisionMesh(group);
          this.collisionsManager.addMeshesGroup(group, collisionMesh, element);
          this.colliderCount_++;
          debug(`[headless-scene] addCollider: <${tag}> (total: ${this.colliderCount_})`);
        } catch (err: any) {
          console.warn(`[headless-scene] Failed to add collider "${tag}":`, err.message);
        }
      },
      updateCollider: (collider: unknown) => {
        try {
          const group = collider as THREE.Group;
          group.updateWorldMatrix(true, true);
          const m = new Matr4().fromArray(group.matrixWorld.elements as unknown as Float32Array);
          const scale = { x: group.scale.x, y: group.scale.y, z: group.scale.z };
          this.collisionsManager.updateMeshesGroup(group, m, scale);
        } catch {
          // ignore update failures
        }
      },
      removeCollider: (collider: unknown) => {
        this.collisionsManager.removeMeshesGroup(collider);
        this.colliderCount_ = Math.max(0, this.colliderCount_ - 1);
      },
      getUserPositionAndRotation: () => this.getUserPositionAndRotation(),
      prompt: () => {},
      link: () => {},
      getLoadingProgressManager: () => this.loadingProgressManager,
    };

    try {
      setGlobalMMLScene(this.mmlScene as IMMLScene);
    } catch {
      // Multiple HeadlessMMLScene instances in the same process share globals
    }
    try {
      setGlobalDocumentTimeManager(this.documentTimeManager);
    } catch {
      // Multiple HeadlessMMLScene instances in the same process share globals
    }

    // Install virtual DOM change detection hooks and register this scene
    installChangeHooks();
    this.changeHandler = {
      loaded: false,
      connecting: false,
      onNodeAdded: (node) => {
        if (this.hasMMLDescendant(node)) this.emitSceneChange("elements_added");
      },
      onNodeRemoved: (node) => {
        this.cleanupNodeIdMaps(node);
        if (this.hasMMLDescendant(node)) this.emitSceneChange("elements_removed");
      },
      onAttrChanged: (el, name, _oldVal, newVal) => {
        const nodeId = this.nodeIdByElement.get(el);
        const detail =
          nodeId !== undefined
            ? { nodeId, tag: el.nodeName.toLowerCase(), attribute: name, newValue: newVal }
            : undefined;
        if (HeadlessMMLScene.GEOMETRY_ATTRS.has(name)) {
          this.emitSceneChange("geometry_changed", detail);
        } else {
          this.emitSceneChange(`${name}_changed`, detail);
        }
      },
    };
    handlersByDoc.set(this.virtualDoc, this.changeHandler);

    this.setupGraphicsRetryLoop();
  }

  /**
   * Query MML elements from the virtual DOM root.
   * Handles comma-separated selectors which VirtualHTMLElement doesn't support natively.
   */
  public queryAll(selector: string): VirtualHTMLElement[] {
    const selectors = selector
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (selectors.length === 1) {
      return this.root.querySelectorAll(selectors[0]);
    }
    const results: VirtualHTMLElement[] = [];
    const seen = new Set<VirtualHTMLElement>();
    for (const sel of selectors) {
      for (const el of this.root.querySelectorAll(sel)) {
        if (!seen.has(el)) {
          seen.add(el);
          results.push(el);
        }
      }
    }
    return results;
  }

  connectToDocument(
    wsUrl: string,
    transform?: {
      position?: { x: number; y: number; z: number };
      rotation?: { x: number; y: number; z: number };
      scale?: { x: number; y: number; z: number };
    },
  ): void {
    const targetElement = this.virtualDoc.createElement("div");
    this.root.appendChild(targetElement);
    this.documentTargetElements.push(targetElement);

    debug(`[headless-scene] Connecting to MML document: ${wsUrl}`);

    const MAX_TRANSFORM_RETRIES = 50;
    let transformApplied = false;
    let transformRetries = 0;
    const applyTransform = () => {
      if (!transform) return;
      if (transformRetries >= MAX_TRANSFORM_RETRIES) {
        console.warn(
          `[headless-scene] Transform for ${wsUrl} not applied after ${MAX_TRANSFORM_RETRIES} retries, giving up`,
        );
        return;
      }
      transformRetries++;
      const remoteDoc = targetElement.querySelector("m-remote-document") as any;
      if (!remoteDoc) return;

      if (transform.position) {
        remoteDoc.setAttribute("x", String(transform.position.x));
        remoteDoc.setAttribute("y", String(transform.position.y));
        remoteDoc.setAttribute("z", String(transform.position.z));
      }
      if (transform.rotation) {
        remoteDoc.setAttribute("rx", String(transform.rotation.x));
        remoteDoc.setAttribute("ry", String(transform.rotation.y));
        remoteDoc.setAttribute("rz", String(transform.rotation.z));
      }
      if (transform.scale) {
        remoteDoc.setAttribute("sx", String(transform.scale.x));
        remoteDoc.setAttribute("sy", String(transform.scale.y));
        remoteDoc.setAttribute("sz", String(transform.scale.z));
      }

      try {
        const container = remoteDoc.getContainer();
        if (container && transform.position) {
          const wp = new THREE.Vector3();
          container.getWorldPosition(wp);
          const tp = transform.position;
          const close = (a: number, b: number) => Math.abs(a - b) < 0.01;
          if (close(wp.x, tp.x) && close(wp.y, tp.y) && close(wp.z, tp.z)) {
            transformApplied = true;
            debug(`[headless-scene] Transform applied to ${wsUrl}: pos=(${tp.x},${tp.y},${tp.z})`);
          } else {
            container.position.set(tp.x, tp.y, tp.z);
            container.updateMatrixWorld(true);
            transformApplied = true;
            debug(
              `[headless-scene] Transform forced on ${wsUrl}: pos=(${tp.x},${tp.y},${tp.z}) (attrs didn't propagate)`,
            );
          }
        }
      } catch {
        // Container not ready yet — will retry
      }

      if (!transformApplied) {
        this.scheduleTimer(applyTransform, 200);
      }
    };

    const source = MMLNetworkSource.create({
      url: wsUrl,
      mmlScene: this.mmlScene as IMMLScene,
      statusUpdated: (status) => {
        debug(`[headless-scene] ${wsUrl} status: ${status}`);
        if (transform && !transformApplied) {
          this.scheduleTimer(applyTransform, 50);
        }
      },
      windowTarget: this.virtualDoc,
      targetForWrappers: targetElement as unknown as HTMLElement,
      documentFactory: this.virtualDoc,
    });

    if (transform) {
      this.scheduleTimer(applyTransform, 50);
    }

    this.mmlSources.push(source);
  }

  /**
   * Connect to an MML document and track it by key for later diffing.
   * Used by `setMMLDocuments` — prefer that method for world-config-driven docs.
   */
  connectToDocumentByKey(
    key: string,
    wsUrl: string,
    transform?: {
      position?: { x: number; y: number; z: number };
      rotation?: { x: number; y: number; z: number };
      scale?: { x: number; y: number; z: number };
    },
  ): void {
    // If a document with this key already exists, disconnect it first
    this.disconnectFromDocument(key);

    const targetElement = this.virtualDoc.createElement("div");
    this.root.appendChild(targetElement);
    this.documentTargetElements.push(targetElement);

    debug(`[headless-scene] Connecting to MML document [${key}]: ${wsUrl}`);

    const source = MMLNetworkSource.create({
      url: wsUrl,
      mmlScene: this.mmlScene as IMMLScene,
      statusUpdated: (status) => {
        debug(`[headless-scene] ${wsUrl} status: ${status}`);
        // If the main scene is already loaded, manually trigger graphics for
        // the new document's elements. The virtual DOM fires connectedCallback
        // automatically, but graphicsEnabled may have been false when elements
        // first connected.
        if (status === 2 && this._loaded) {
          this.scheduleTimer(() => {
            this.changeHandler.connecting = true;
            try {
              this.traverseAndConnect(targetElement);
            } finally {
              this.changeHandler.connecting = false;
            }
          }, 200);
        }
      },
      windowTarget: this.virtualDoc,
      targetForWrappers: targetElement as unknown as HTMLElement,
      documentFactory: this.virtualDoc,
    });

    if (transform) {
      const MAX_RETRIES = 50;
      let retryCount = 0;
      const applyTransform = () => {
        const remoteDoc = targetElement.querySelector("m-remote-document");
        if (remoteDoc) {
          if (transform.position) {
            remoteDoc.setAttribute("x", String(transform.position.x));
            remoteDoc.setAttribute("y", String(transform.position.y));
            remoteDoc.setAttribute("z", String(transform.position.z));
          }
          if (transform.rotation) {
            remoteDoc.setAttribute("rx", String(transform.rotation.x));
            remoteDoc.setAttribute("ry", String(transform.rotation.y));
            remoteDoc.setAttribute("rz", String(transform.rotation.z));
          }
          if (transform.scale) {
            remoteDoc.setAttribute("sx", String(transform.scale.x));
            remoteDoc.setAttribute("sy", String(transform.scale.y));
            remoteDoc.setAttribute("sz", String(transform.scale.z));
          }
        } else {
          retryCount++;
          if (retryCount >= MAX_RETRIES) {
            console.warn(
              `[headless-scene] Failed to find m-remote-document after ${MAX_RETRIES} retries, giving up on transform for ${wsUrl}`,
            );
            return;
          }
          this.scheduleTimer(applyTransform, 100);
        }
      };
      this.scheduleTimer(applyTransform, 50);
    }

    this.mmlSources.push(source);
    this.documentEntries.set(key, { source, targetElement, url: wsUrl });
  }

  /**
   * Disconnect and clean up a single MML document by key.
   * No-op if the key doesn't exist.
   */
  disconnectFromDocument(key: string): void {
    const entry = this.documentEntries.get(key);
    if (!entry) return;

    debug(`[headless-scene] Disconnecting MML document [${key}]: ${entry.url}`);

    entry.source.dispose();
    entry.targetElement.remove();

    // Remove from the unkeyed arrays too
    const sourceIdx = this.mmlSources.indexOf(entry.source);
    if (sourceIdx !== -1) this.mmlSources.splice(sourceIdx, 1);
    const elIdx = this.documentTargetElements.indexOf(entry.targetElement);
    if (elIdx !== -1) this.documentTargetElements.splice(elIdx, 1);

    this.documentEntries.delete(key);
  }

  /**
   * Apply a full set of MML documents, diffing against the current state.
   * - Documents present in `docs` but not currently connected are added.
   * - Documents whose URL changed are reconnected.
   * - Documents no longer present are disconnected and cleaned up.
   * - Documents whose only change is transform are updated in place.
   */
  setMMLDocuments(
    docs: {
      [key: string]: {
        url: string;
        position?: { x: number; y: number; z: number };
        rotation?: { x: number; y: number; z: number };
        scale?: { x: number; y: number; z: number };
      };
    },
    wsBase: string,
  ): void {
    const newKeys = new Set(Object.keys(docs));

    // Remove documents no longer in the config
    for (const key of this.documentEntries.keys()) {
      if (!newKeys.has(key)) {
        this.disconnectFromDocument(key);
      }
    }

    // Add or update documents
    for (const [key, docConfig] of Object.entries(docs)) {
      const existing = this.documentEntries.get(key);
      const wsUrl = `${wsBase}/mml-documents/${key}`;

      if (existing && existing.url === wsUrl) {
        // Same URL — update transform attributes in place
        this.updateDocumentTransform(existing.targetElement, docConfig);
      } else {
        // New document or URL changed — (re)connect
        this.connectToDocumentByKey(key, wsUrl, docConfig);
      }
    }
  }

  /**
   * Update transform attributes on an already-connected document's target element.
   */
  private updateDocumentTransform(
    targetElement: VirtualHTMLElement,
    transform: {
      position?: { x: number; y: number; z: number };
      rotation?: { x: number; y: number; z: number };
      scale?: { x: number; y: number; z: number };
    },
  ): void {
    const remoteDoc = targetElement.querySelector("m-remote-document");
    if (!remoteDoc) return;

    if (transform.position) {
      remoteDoc.setAttribute("x", String(transform.position.x));
      remoteDoc.setAttribute("y", String(transform.position.y));
      remoteDoc.setAttribute("z", String(transform.position.z));
    }
    if (transform.rotation) {
      remoteDoc.setAttribute("rx", String(transform.rotation.x));
      remoteDoc.setAttribute("ry", String(transform.rotation.y));
      remoteDoc.setAttribute("rz", String(transform.rotation.z));
    }
    if (transform.scale) {
      remoteDoc.setAttribute("sx", String(transform.scale.x));
      remoteDoc.setAttribute("sy", String(transform.scale.y));
      remoteDoc.setAttribute("sz", String(transform.scale.z));
    }
  }

  startTicking(): void {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => {
      this.documentTimeManager.tick();

      const remoteDocElements = this.queryAll("m-remote-document");
      for (let i = 0; i < remoteDocElements.length; i++) {
        const el = remoteDocElements[i] as any;
        if (el.getDocumentTimeManager) {
          el.getDocumentTimeManager().tick();
        }
      }
    }, TICK_MS);
    debug("[headless-scene] Tick loop started (20 Hz)");
  }

  private enableGraphicsAndTriggerCallbacks(): void {
    this.changeHandler.connecting = true;
    this.graphicsEnabled = true;
    try {
      this.traverseAndConnect(this.root);
    } finally {
      // Keep graphicsEnabled=true so late-arriving elements get graphics via connectedCallback
      this.changeHandler.connecting = false;
    }
    debug("[headless-scene] Graphics enabled, callbacks triggered");
  }

  private traverseAndConnect(node: any): void {
    if (node.connectedCallback && node.tagName?.startsWith?.("M-")) {
      try {
        const tag = node.tagName.toLowerCase();
        const hadGraphics = !!node.mElementGraphics;
        node.connectedCallback();
        if (!hadGraphics && node.mElementGraphics) {
          debug(`[headless-scene] Graphics initialised for <${tag}>`);
        }
      } catch (err: any) {
        const tag = node.tagName?.toLowerCase?.() ?? "unknown";
        if (tag === "m-audio") {
          console.debug(`[headless-scene] connectedCallback failed for <${tag}>: ${err.message}`);
        } else {
          console.warn(`[headless-scene] connectedCallback failed for <${tag}>: ${err.message}`);
        }
      }
    }
    const children = node.children || node.childNodes || [];
    for (let i = 0; i < children.length; i++) {
      this.traverseAndConnect(children[i]);
    }
  }

  private setupGraphicsRetryLoop(): void {
    const RETRY_INTERVAL = 2000;
    const MAX_EMPTY_POLLS = 15; // 30 seconds of no elements before giving up
    const MAX_TOTAL_POLLS = 150; // 5 minutes absolute safety net
    let consecutiveEmptyPolls = 0;
    let totalPolls = 0;
    this.graphicsRetryInterval = setInterval(() => {
      totalPolls++;
      if (totalPolls > MAX_TOTAL_POLLS) {
        console.warn(
          `[headless-scene] Graphics retry loop exceeded ${MAX_TOTAL_POLLS} polls, stopping`,
        );
        clearInterval(this.graphicsRetryInterval!);
        this.graphicsRetryInterval = null;
        return;
      }
      const allMML = this.queryAll(MML_GEOMETRY_SELECTOR);
      if (allMML.length === 0) {
        consecutiveEmptyPolls++;
        if (consecutiveEmptyPolls >= MAX_EMPTY_POLLS) {
          console.warn(
            `[headless-scene] No MML elements found after ${consecutiveEmptyPolls} polls, stopping retry loop`,
          );
          clearInterval(this.graphicsRetryInterval!);
          this.graphicsRetryInterval = null;
        }
        return;
      }
      consecutiveEmptyPolls = 0;
      let uninitCount = 0;
      for (let i = 0; i < allMML.length; i++) {
        const el = allMML[i] as any;
        if (el.isConnected && !el.mElementGraphics) {
          uninitCount++;
        }
      }
      if (uninitCount > 0) {
        debug(
          `[headless-scene] Found ${uninitCount} uninitialised MML elements, retriggering callbacks`,
        );
        this.changeHandler.connecting = true;
        this.graphicsEnabled = true;
        try {
          this.traverseAndConnect(this.root);
        } finally {
          this.changeHandler.connecting = false;
        }
      } else {
        // All elements are initialised — stop the retry loop
        clearInterval(this.graphicsRetryInterval!);
        this.graphicsRetryInterval = null;
      }
    }, RETRY_INTERVAL);
  }

  private hasMMLDescendant(node: any): boolean {
    if (node.tagName?.startsWith?.("M-")) return true;
    const children = node.children || [];
    for (let i = 0; i < children.length; i++) {
      if (this.hasMMLDescendant(children[i])) return true;
    }
    return false;
  }

  private cleanupNodeIdMaps(node: any): void {
    const nodeId = this.nodeIdByElement.get(node);
    if (nodeId !== undefined) {
      this.nodeIdByElement.delete(node);
      this.elementByNodeId.delete(nodeId);
    }
    const children = node.children || node.childNodes || [];
    for (let i = 0; i < children.length; i++) {
      this.cleanupNodeIdMaps(children[i]);
    }
  }

  async waitForSceneReady(timeoutMs: number = 15000, pollMs: number = 200): Promise<boolean> {
    const start = Date.now();

    // Phase 1: Wait for MML elements to appear in the virtual DOM
    while (Date.now() - start < timeoutMs) {
      const mmlElements = this.queryAll(MML_GEOMETRY_SELECTOR);
      if (mmlElements.length > 0) {
        debug(`[headless-scene] DOM populated with ${mmlElements.length} MML elements`);
        break;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }

    // Phase 2: Small delay to let DOM mutations settle
    await new Promise((r) => setTimeout(r, 100));

    // Phase 3: Enable graphics and trigger callbacks top-down
    this.enableGraphicsAndTriggerCallbacks();

    // Phase 4: Wait for at least some Three.js meshes to exist
    const meshWaitStart = Date.now();
    const meshTimeout = Math.max(timeoutMs - (Date.now() - start), 3000);
    while (Date.now() - meshWaitStart < meshTimeout) {
      const meshCount = this.countMeshes();
      if (meshCount > 0) {
        debug(`[headless-scene] Scene has ${meshCount} meshes`);
        break;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }

    if (this.countMeshes() === 0) {
      console.warn(`[headless-scene] No meshes found after waiting (${timeoutMs}ms)`);
      return false;
    }

    // Phase 5: Brief stabilisation — wait until the mesh count is stable
    const stabiliseMs = 300;
    const stabiliseTimeout = 1000;
    let prevMeshCount = this.countMeshes();
    let stableFor = 0;
    const stabiliseStart = Date.now();
    while (Date.now() - stabiliseStart < stabiliseTimeout) {
      await new Promise((r) => setTimeout(r, pollMs));
      const current = this.countMeshes();
      if (current === prevMeshCount) {
        stableFor += pollMs;
        if (stableFor >= stabiliseMs) break;
      } else {
        debug(`[headless-scene] Mesh count changed: ${prevMeshCount} → ${current}`);
        prevMeshCount = current;
        stableFor = 0;
      }
    }

    this._loaded = true;
    this.changeHandler.loaded = true;
    if (!this.loadingProgressManager.initialLoad) {
      this.loadingProgressManager.setInitialLoad(true);
    }
    debug(`[headless-scene] Scene ready with ${this.countMeshes()} meshes`);

    {
      const [ratio, complete] = this.loadingProgressManager.toRatio();
      debug(
        `[loading-debug] [scene-level] before waitForLoadingComplete: initialLoad=${this.loadingProgressManager.initialLoad}, ` +
          `ratio=${Math.round(ratio * 100)}% complete=${complete}, ` +
          `assets=${this.loadingProgressManager.summary.totalLoaded}/${this.loadingProgressManager.summary.totalToLoad}, ` +
          `documents=${this.loadingProgressManager.loadingDocuments.size}`,
      );
    }
    const loadingDone = await this.waitForLoadingComplete(timeoutMs, pollMs);
    if (loadingDone) {
      debug("[headless-scene] LoadingProgressManager reports complete");
    } else {
      console.warn("[headless-scene] Loading didn't complete within timeout");
    }

    return loadingDone;
  }

  private waitForLoadingComplete(timeoutMs: number, pollMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const start = Date.now();
      const [, complete] = this.loadingProgressManager.toRatio();
      if (complete) {
        resolve(true);
        return;
      }

      const check = () => {
        const [r, done] = this.loadingProgressManager.toRatio();
        if (done) {
          this.loadingProgressManager.removeProgressCallback(onProgress);
          if (timer) clearInterval(timer);
          resolve(true);
          return true;
        }
        if (Date.now() - start > timeoutMs) {
          this.loadingProgressManager.removeProgressCallback(onProgress);
          if (timer) clearInterval(timer);
          console.warn(
            `[headless-scene] Loading progress at ${Math.round(r * 100)}% when timeout reached`,
          );
          console.warn(
            `[loading-debug] [scene-level] timeout state: initialLoad=${this.loadingProgressManager.initialLoad}, ` +
              `assets=${this.loadingProgressManager.summary.totalLoaded}/${this.loadingProgressManager.summary.totalToLoad} loaded, ` +
              `${this.loadingProgressManager.summary.totalErrored} errored, ` +
              `documents=${this.loadingProgressManager.loadingDocuments.size}`,
          );
          const summary = this.loadingProgressManager.toSummary();
          console.warn(
            `[loading-debug] [scene-level] full summary:\n${LoadingProgressManager.LoadingProgressSummaryToString(summary)}`,
          );
          resolve(false);
          return true;
        }
        return false;
      };

      const onProgress = () => {
        check();
      };
      this.loadingProgressManager.addProgressCallback(onProgress);

      const timer = setInterval(() => {
        check();
      }, pollMs);
    });
  }

  /**
   * Monkey-patch a LoadingProgressManager to log all state transitions for debugging.
   */
  private instrumentLoadingProgressManager(mgr: LoadingProgressManager, label: string): void {
    const origSetInitialLoad = mgr.setInitialLoad.bind(mgr);
    mgr.setInitialLoad = (result: true | Error) => {
      debug(
        `[loading-debug] [${label}] setInitialLoad(${result instanceof Error ? `Error: ${result.message}` : result})`,
      );
      origSetInitialLoad(result);
      const [ratio, complete] = mgr.toRatio();
      debug(
        `[loading-debug] [${label}] after setInitialLoad → ratio=${Math.round(ratio * 100)}% complete=${complete}`,
      );
    };

    const origAddLoadingAsset = mgr.addLoadingAsset.bind(mgr);
    mgr.addLoadingAsset = (ref: unknown, url: string, type: string) => {
      debug(`[loading-debug] [${label}] addLoadingAsset type=${type} url=${url}`);
      origAddLoadingAsset(ref, url, type);
      debug(
        `[loading-debug] [${label}] assets: ${mgr.summary.totalLoaded}/${mgr.summary.totalToLoad} loaded, ${mgr.summary.totalErrored} errored`,
      );
    };

    const origCompletedLoadingAsset = mgr.completedLoadingAsset.bind(mgr);
    mgr.completedLoadingAsset = (ref: unknown) => {
      const asset = mgr.loadingAssets.get(ref);
      debug(
        `[loading-debug] [${label}] completedLoadingAsset type=${asset?.type} url=${asset?.assetUrl}`,
      );
      origCompletedLoadingAsset(ref);
      debug(
        `[loading-debug] [${label}] assets: ${mgr.summary.totalLoaded}/${mgr.summary.totalToLoad} loaded, ${mgr.summary.totalErrored} errored`,
      );
    };

    const origErrorLoadingAsset = mgr.errorLoadingAsset.bind(mgr);
    mgr.errorLoadingAsset = (ref: unknown, err: Error) => {
      const asset = mgr.loadingAssets.get(ref);
      debug(
        `[loading-debug] [${label}] errorLoadingAsset type=${asset?.type} url=${asset?.assetUrl} err=${err.message}`,
      );
      origErrorLoadingAsset(ref, err);
      debug(
        `[loading-debug] [${label}] assets: ${mgr.summary.totalLoaded}/${mgr.summary.totalToLoad} loaded, ${mgr.summary.totalErrored} errored`,
      );
    };

    const origAddLoadingDocument = mgr.addLoadingDocument.bind(mgr);
    mgr.addLoadingDocument = (
      ref: unknown,
      documentUrl: string,
      progressManager: LoadingProgressManager,
    ) => {
      debug(`[loading-debug] [${label}] addLoadingDocument url=${documentUrl}`);
      this.instrumentLoadingProgressManager(progressManager, `doc:${documentUrl}`);
      origAddLoadingDocument(ref, documentUrl, progressManager);
      debug(`[loading-debug] [${label}] documents: ${mgr.loadingDocuments.size} tracked`);
    };

    const origDisposeOfLoadingAsset = mgr.disposeOfLoadingAsset.bind(mgr);
    mgr.disposeOfLoadingAsset = (ref: unknown) => {
      const asset = mgr.loadingAssets.get(ref);
      debug(
        `[loading-debug] [${label}] disposeOfLoadingAsset type=${asset?.type} url=${asset?.assetUrl}`,
      );
      origDisposeOfLoadingAsset(ref);
    };
  }

  private groundColliderGroup: THREE.Group | null = null;

  /**
   * Register the ground plane mesh as a physics collider.
   */
  registerGroundPlaneCollider(): void {
    if (this.groundColliderGroup) return;
    const group = new THREE.Group();
    group.add(this.groundMesh.clone());
    group.name = "ground-collider";
    this.scene.add(group);
    group.updateWorldMatrix(true, true);
    try {
      const collisionMesh = createCollisionMesh(group);
      this.collisionsManager.addMeshesGroup(group, collisionMesh);
      this.groundColliderGroup = group;
      this.colliderCount_++;
      debug("[headless-scene] Ground plane collider registered");
    } catch (err: any) {
      this.scene.remove(group);
      console.warn("[headless-scene] Failed to register ground plane collider:", err.message);
    }
  }

  /**
   * Remove the ground plane physics collider.
   */
  unregisterGroundPlaneCollider(): void {
    if (!this.groundColliderGroup) return;
    this.collisionsManager.removeMeshesGroup(this.groundColliderGroup);
    this.scene.remove(this.groundColliderGroup);
    this.groundColliderGroup = null;
    this.colliderCount_--;
    debug("[headless-scene] Ground plane collider removed");
  }

  get hasGroundPlaneCollider(): boolean {
    return this.groundColliderGroup !== null;
  }

  removeGroundMesh(): void {
    if (this.groundMesh.parent) {
      this.groundMesh.parent.remove(this.groundMesh);
    }
  }

  countMeshes(): number {
    let count = 0;
    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) count++;
    });
    return count;
  }

  collectMeshes(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        meshes.push(obj as THREE.Mesh);
      }
    });
    return meshes;
  }

  getSceneInfo(): Array<{
    name: string;
    type: string;
    position: { x: number; y: number; z: number };
    size: { x: number; y: number; z: number };
  }> {
    const info: Array<{
      name: string;
      type: string;
      position: { x: number; y: number; z: number };
      size: { x: number; y: number; z: number };
    }> = [];

    this.scene.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      mesh.updateWorldMatrix(true, false);
      if (mesh.matrixWorld.elements.some((v) => Number.isNaN(v))) return;
      const worldPos = new THREE.Vector3();
      mesh.getWorldPosition(worldPos);
      const box = new THREE.Box3().setFromObject(mesh);
      const size = new THREE.Vector3();
      box.getSize(size);

      info.push({
        name: mesh.name || mesh.parent?.name || "unnamed",
        type: mesh.geometry?.type || "unknown",
        position: {
          x: Math.round(worldPos.x * 100) / 100,
          y: Math.round(worldPos.y * 100) / 100,
          z: Math.round(worldPos.z * 100) / 100,
        },
        size: {
          x: Math.round(size.x * 100) / 100,
          y: Math.round(size.y * 100) / 100,
          z: Math.round(size.z * 100) / 100,
        },
      });
    });

    return info;
  }

  getSceneSummary(): {
    meshCount: number;
    boundingBox: {
      min: [number, number, number];
      max: [number, number, number];
    };
    landmarks: Array<{ id: string; pos: [number, number, number] }>;
  } {
    const round = (v: number) => Math.round(v * 100) / 100;
    let meshCount = 0;
    const sceneBBox = new THREE.Box3();

    this.scene.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      mesh.updateWorldMatrix(true, false);
      if (mesh.matrixWorld.elements.some((v) => Number.isNaN(v))) return;
      meshCount++;
      const box = new THREE.Box3().setFromObject(mesh);
      sceneBBox.union(box);
    });

    const landmarks: Array<{ id: string; pos: [number, number, number] }> = [];
    const groups = this.queryAll("m-group[id], m-model");
    for (let i = 0; i < groups.length; i++) {
      try {
        const el = groups[i] as any;
        const tag = el.tagName?.toLowerCase() ?? "";
        const id = el.getAttribute("id") || (tag === "m-model" ? `model-${i}` : null);
        if (!id) continue;
        const container = el.getContainer();
        const worldPos = new THREE.Vector3();
        container.getWorldPosition(worldPos);
        landmarks.push({
          id,
          pos: [round(worldPos.x), round(worldPos.y), round(worldPos.z)],
        });
      } catch {
        // Skip elements without graphics containers
      }
    }

    const min = sceneBBox.isEmpty()
      ? ([0, 0, 0] as [number, number, number])
      : ([round(sceneBBox.min.x), round(sceneBBox.min.y), round(sceneBBox.min.z)] as [
          number,
          number,
          number,
        ]);
    const max = sceneBBox.isEmpty()
      ? ([0, 0, 0] as [number, number, number])
      : ([round(sceneBBox.max.x), round(sceneBBox.max.y), round(sceneBBox.max.z)] as [
          number,
          number,
          number,
        ]);

    return { meshCount, boundingBox: { min, max }, landmarks };
  }

  getFilteredSceneInfo(
    avatarPos: { x: number; y: number; z: number },
    radius: number = 20,
    maxResults: number = 50,
  ): Array<{
    name: string;
    type: string;
    pos: [number, number, number];
    size: [number, number, number];
    dist: number;
  }> {
    const round = (v: number) => Math.round(v * 100) / 100;
    const avatarVec = new THREE.Vector3(avatarPos.x, avatarPos.y, avatarPos.z);

    const entries: Array<{
      name: string;
      type: string;
      pos: [number, number, number];
      size: [number, number, number];
      dist: number;
    }> = [];

    this.scene.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      mesh.updateWorldMatrix(true, false);
      if (mesh.matrixWorld.elements.some((v) => Number.isNaN(v))) return;
      const worldPos = new THREE.Vector3();
      mesh.getWorldPosition(worldPos);

      const dist = avatarVec.distanceTo(worldPos);
      if (dist > radius) return;

      const box = new THREE.Box3().setFromObject(mesh);
      const size = new THREE.Vector3();
      box.getSize(size);

      entries.push({
        name: mesh.name || mesh.parent?.name || "unnamed",
        type: mesh.geometry?.type || "unknown",
        pos: [round(worldPos.x), round(worldPos.y), round(worldPos.z)],
        size: [round(size.x), round(size.y), round(size.z)],
        dist: round(dist),
      });
    });

    const seen = new Set<string>();
    const deduped = entries.filter((e) => {
      const key = `${e.name}:${e.pos[0]},${e.pos[1]},${e.pos[2]}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    deduped.sort((a, b) => a.dist - b.dist);
    return deduped.slice(0, maxResults);
  }

  private getOrAssignNodeId(el: any): number {
    let nodeId = this.nodeIdByElement.get(el);
    if (nodeId === undefined) {
      nodeId = this.nextNodeId++;
      this.nodeIdByElement.set(el, nodeId);
      this.elementByNodeId.set(nodeId, el);
    }
    return nodeId;
  }

  private collectAttributes(el: any): Record<string, string> {
    const attrs: Record<string, string> = {};
    const common = ["id", "class", "color", "visible"];
    for (const name of common) {
      const val = el.getAttribute(name);
      if (val !== null && val !== undefined) attrs[name] = val;
    }
    const tag = el.tagName?.toLowerCase() ?? "";
    if (tag === "m-label") {
      const content = el.getAttribute("content");
      if (content !== null && content !== undefined) attrs.content = content;
      for (const a of ["width", "height", "font-size", "alignment"]) {
        const val = el.getAttribute(a);
        if (val !== null && val !== undefined) attrs[a] = val;
      }
    }
    if (tag === "m-interaction") {
      for (const a of ["prompt", "radius", "range", "in-focus", "line-of-sight", "priority"]) {
        const val = el.getAttribute(a);
        if (val !== null && val !== undefined) attrs[a] = val;
      }
    }
    if (tag === "m-frame") {
      const src = el.getAttribute("src");
      if (src !== null && src !== undefined) attrs.src = src;
      for (const a of ["load-range", "unload-range"]) {
        const val = el.getAttribute(a);
        if (val !== null && val !== undefined) attrs[a] = val;
      }
    }
    if (tag === "m-model") {
      for (const a of ["src", "collide"]) {
        const val = el.getAttribute(a);
        if (val !== null && val !== undefined) attrs[a] = val;
      }
    }
    if (tag === "m-image") {
      for (const a of ["src", "alt", "width", "height", "emissive"]) {
        const val = el.getAttribute(a);
        if (val !== null && val !== undefined) attrs[a] = val;
      }
    }
    return attrs;
  }

  private enrichWithNearbyLabels(
    results: Array<{
      nodeId: number;
      tag: string;
      position: { x: number; y: number; z: number };
      attributes: Record<string, string>;
    }>,
  ): void {
    const labels: Array<{ pos: THREE.Vector3; content: string }> = [];
    const labelEls = this.queryAll("m-label");
    for (let i = 0; i < labelEls.length; i++) {
      try {
        const el = labelEls[i] as any;
        const content = el.getAttribute("content");
        if (!content) continue;
        const container = el.getContainer();
        const pos = new THREE.Vector3();
        container.getWorldPosition(pos);
        labels.push({ pos, content });
      } catch {
        // skip
      }
    }
    if (labels.length === 0) return;

    const NEARBY_LABEL_RADIUS = 3;
    for (const result of results) {
      if (result.tag === "m-label") continue;
      const elPos = new THREE.Vector3(result.position.x, result.position.y, result.position.z);
      let closest: { content: string; dist: number } | null = null;
      for (const label of labels) {
        const dist = elPos.distanceTo(label.pos);
        if (dist <= NEARBY_LABEL_RADIUS && (!closest || dist < closest.dist)) {
          closest = { content: label.content, dist };
        }
      }
      if (closest) {
        result.attributes.nearbyLabel = closest.content;
      }
    }
  }

  getClickableElements(): Array<{
    nodeId: number;
    tag: string;
    position: { x: number; y: number; z: number };
    attributes: Record<string, string>;
  }> {
    const results: Array<{
      nodeId: number;
      tag: string;
      position: { x: number; y: number; z: number };
      attributes: Record<string, string>;
    }> = [];
    const elements = this.queryAll(MML_GEOMETRY_SELECTOR);
    for (let i = 0; i < elements.length; i++) {
      try {
        const el = elements[i] as any;
        const tag = el.tagName?.toLowerCase() ?? "";
        if (tag !== "m-model" && (!el.isClickable || !el.isClickable())) continue;
        const container = el.getContainer();
        const worldPos = new THREE.Vector3();
        container.getWorldPosition(worldPos);

        const nodeId = this.getOrAssignNodeId(el);
        const round = (v: number) => Math.round(v * 100) / 100;
        results.push({
          nodeId,
          tag: el.tagName.toLowerCase(),
          position: { x: round(worldPos.x), y: round(worldPos.y), z: round(worldPos.z) },
          attributes: this.collectAttributes(el),
        });
      } catch {
        // Skip elements without graphics containers
      }
    }
    this.enrichWithNearbyLabels(results);
    return results;
  }

  getInteractionElements(): Array<{
    nodeId: number;
    tag: string;
    position: { x: number; y: number; z: number };
    attributes: Record<string, string>;
  }> {
    const results: Array<{
      nodeId: number;
      tag: string;
      position: { x: number; y: number; z: number };
      attributes: Record<string, string>;
    }> = [];
    const elements = this.queryAll("m-interaction");
    for (let i = 0; i < elements.length; i++) {
      try {
        const el = elements[i] as any;
        const worldPos = new THREE.Vector3();
        if (el.getContainer) {
          const container = el.getContainer();
          container.getWorldPosition(worldPos);
        } else {
          const parent = el.parentElement;
          if (parent?.getContainer) {
            parent.getContainer().getWorldPosition(worldPos);
          }
        }

        const nodeId = this.getOrAssignNodeId(el);
        const round = (v: number) => Math.round(v * 100) / 100;
        results.push({
          nodeId,
          tag: "m-interaction",
          position: { x: round(worldPos.x), y: round(worldPos.y), z: round(worldPos.z) },
          attributes: this.collectAttributes(el),
        });
      } catch {
        // Skip elements that can't be queried
      }
    }
    return results;
  }

  getLabelElements(
    avatarPos?: { x: number; y: number; z: number },
    readDistance: number = LABEL_READ_DISTANCE,
  ): Array<{
    nodeId: number;
    tag: string;
    position: { x: number; y: number; z: number };
    attributes: Record<string, string>;
  }> {
    const results: Array<{
      nodeId: number;
      tag: string;
      position: { x: number; y: number; z: number };
      attributes: Record<string, string>;
    }> = [];
    this.rootGroup.updateMatrixWorld(true);

    const elements = this.queryAll("m-label");
    for (let i = 0; i < elements.length; i++) {
      try {
        const el = elements[i] as any;
        if (el.isClickable?.()) continue;
        const worldPos = new THREE.Vector3();
        if (el.getContainer) {
          const container = el.getContainer();
          container.getWorldPosition(worldPos);
        }

        const nodeId = this.getOrAssignNodeId(el);
        const round = (v: number) => Math.round(v * 100) / 100;
        const attrs = this.collectAttributes(el);

        if (avatarPos) {
          const dx = worldPos.x - avatarPos.x;
          const dz = worldPos.z - avatarPos.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > readDistance && attrs.content) {
            attrs.content = "[too far to read — move closer]";
          }
        }

        results.push({
          nodeId,
          tag: "m-label",
          position: { x: round(worldPos.x), y: round(worldPos.y), z: round(worldPos.z) },
          attributes: attrs,
        });
      } catch {
        // Skip elements without graphics containers
      }
    }
    return results;
  }

  getCategorizedElements(
    avatarPos: { x: number; y: number; z: number },
    opts: { radius?: number; maxResults?: number } = {},
  ): Array<{
    nodeId: number;
    tag: string;
    position: { x: number; y: number; z: number };
    attributes: Record<string, string>;
    distance: number;
    categories: string[];
  }> {
    const radius = opts.radius ?? Infinity;
    const maxResults = opts.maxResults ?? 50;

    const round = (v: number) => Math.round(v * 100) / 100;
    const avatarVec = new THREE.Vector3(avatarPos.x, avatarPos.y, avatarPos.z);

    const elements = this.queryAll(MML_GEOMETRY_SELECTOR);
    const results: Array<{
      nodeId: number;
      tag: string;
      position: { x: number; y: number; z: number };
      attributes: Record<string, string>;
      distance: number;
      categories: string[];
    }> = [];

    for (let i = 0; i < elements.length; i++) {
      try {
        const el = elements[i] as any;
        const tag = el.tagName?.toLowerCase() ?? "";

        const worldPos = new THREE.Vector3();
        if (el.getContainer) {
          const container = el.getContainer();
          container.getWorldPosition(worldPos);
        } else if (el.parentElement?.getContainer) {
          el.parentElement.getContainer().getWorldPosition(worldPos);
        } else {
          continue;
        }

        const dist = avatarVec.distanceTo(worldPos);
        if (dist > radius) continue;

        const nodeId = this.getOrAssignNodeId(el);
        const attrs = this.collectAttributes(el);
        const categories: string[] = [];

        if (tag === "m-interaction") {
          categories.push("interaction");
        } else if (tag === "m-model" || el.isClickable?.()) {
          categories.push("clickable");
        } else if (tag === "m-label") {
          categories.push("label");
          if (attrs.content && dist > LABEL_READ_DISTANCE) {
            attrs.content = "[too far to read]";
          }
        }

        results.push({
          nodeId,
          tag,
          position: { x: round(worldPos.x), y: round(worldPos.y), z: round(worldPos.z) },
          attributes: attrs,
          distance: round(dist),
          categories,
        });
      } catch {
        // Skip elements without containers
      }
    }

    results.sort((a, b) => a.distance - b.distance);
    const sliced = results.slice(0, maxResults);
    this.enrichWithNearbyLabels(sliced);
    return sliced;
  }

  getAllElements(
    avatarPos: { x: number; y: number; z: number },
    opts: { radius?: number; maxResults?: number; tagFilter?: string } = {},
  ): Array<{
    nodeId: number;
    tag: string;
    position: { x: number; y: number; z: number };
    attributes: Record<string, string>;
    distance: number;
  }> {
    const radius = opts.radius ?? Infinity;
    const maxResults = opts.maxResults ?? 50;
    const tagFilter = opts.tagFilter;

    const round = (v: number) => Math.round(v * 100) / 100;
    const avatarVec = new THREE.Vector3(avatarPos.x, avatarPos.y, avatarPos.z);

    const elements = this.queryAll(MML_GEOMETRY_SELECTOR);
    const results: Array<{
      nodeId: number;
      tag: string;
      position: { x: number; y: number; z: number };
      attributes: Record<string, string>;
      distance: number;
    }> = [];

    for (let i = 0; i < elements.length; i++) {
      try {
        const el = elements[i] as any;
        const tag = el.tagName?.toLowerCase() ?? "";
        if (tagFilter && tag !== tagFilter) continue;

        const worldPos = new THREE.Vector3();
        if (el.getContainer) {
          const container = el.getContainer();
          container.getWorldPosition(worldPos);
        } else if (el.parentElement?.getContainer) {
          el.parentElement.getContainer().getWorldPosition(worldPos);
        } else {
          continue;
        }

        const dist = avatarVec.distanceTo(worldPos);
        if (dist > radius) continue;

        const nodeId = this.getOrAssignNodeId(el);
        const attrs = this.collectAttributes(el);

        if (tag === "m-label" && attrs.content && dist > LABEL_READ_DISTANCE) {
          attrs.content = "[too far to read]";
        }

        results.push({
          nodeId,
          tag,
          position: { x: round(worldPos.x), y: round(worldPos.y), z: round(worldPos.z) },
          attributes: attrs,
          distance: round(dist),
        });
      } catch {
        // Skip elements without containers
      }
    }

    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, maxResults);
  }

  getElementByNodeId(nodeId: number): {
    nodeId: number;
    tag: string;
    position: { x: number; y: number; z: number };
    attributes: Record<string, string>;
  } | null {
    const el = this.elementByNodeId.get(nodeId);
    if (!el) return null;
    try {
      const tag = el.tagName?.toLowerCase() ?? "";
      const worldPos = new THREE.Vector3();
      if (el.getContainer) {
        el.getContainer().getWorldPosition(worldPos);
      } else if (el.parentElement?.getContainer) {
        el.parentElement.getContainer().getWorldPosition(worldPos);
      } else {
        return null;
      }
      const round = (v: number) => Math.round(v * 100) / 100;
      const result = {
        nodeId,
        tag,
        position: { x: round(worldPos.x), y: round(worldPos.y), z: round(worldPos.z) },
        attributes: this.collectAttributes(el),
      };
      this.enrichWithNearbyLabels([result]);
      return result;
    } catch {
      return null;
    }
  }

  getElementTypeCounts(): Record<string, number> {
    const elements = this.queryAll(MML_GEOMETRY_SELECTOR);
    const counts: Record<string, number> = {};
    for (let i = 0; i < elements.length; i++) {
      const tag = (elements[i] as any).tagName?.toLowerCase() ?? "unknown";
      counts[tag] = (counts[tag] || 0) + 1;
    }
    return counts;
  }

  clickNode(
    nodeId: number,
    avatarPos: { x: number; y: number; z: number },
  ): {
    success: boolean;
    error?: string;
    elementTag?: string;
    hitPosition?: { x: number; y: number; z: number };
    remoteDocForwarded?: boolean;
  } {
    const mElement = this.elementByNodeId.get(nodeId);
    if (!mElement) {
      return { success: false, error: "Unknown node ID. Call get_scene_info to refresh." };
    }

    if (!mElement.isConnected) {
      return {
        success: false,
        error: "Element no longer exists. Call get_scene_info to refresh.",
      };
    }

    let targetWorldPos: THREE.Vector3;
    try {
      const container = mElement.getContainer();
      targetWorldPos = new THREE.Vector3();
      container.getWorldPosition(targetWorldPos);
    } catch {
      return { success: false, error: "Element has no graphics container." };
    }

    const MAX_CLICK_DISTANCE = 20;
    const avatarVec = new THREE.Vector3(avatarPos.x, avatarPos.y, avatarPos.z);
    const clickDist = avatarVec.distanceTo(targetWorldPos);
    if (clickDist > MAX_CLICK_DISTANCE) {
      return {
        success: false,
        error: `Target too far (distance: ${Math.round(clickDist * 10) / 10}, max: ${MAX_CLICK_DISTANCE}). Move closer first.`,
      };
    }

    // Close-range bypass — skip line-of-sight check but still compute hit position
    const CLOSE_RANGE = 4;
    if (clickDist <= CLOSE_RANGE) {
      const container = mElement.getContainer();
      const eyePos = new THREE.Vector3(avatarPos.x, avatarPos.y + 1.5, avatarPos.z);
      const direction = targetWorldPos.clone().sub(eyePos).normalize();
      const dist = eyePos.distanceTo(targetWorldPos);
      const raycaster = new THREE.Raycaster(eyePos, direction, 0, dist + 1);
      const intersections = raycaster.intersectObject(container, true);
      let localPos: { x: number; y: number; z: number };
      let worldHitPos: { x: number; y: number; z: number };
      if (intersections.length > 0) {
        const hitPoint = intersections[0].point;
        const local = container.worldToLocal(hitPoint.clone());
        localPos = {
          x: Math.round(local.x * 100) / 100,
          y: Math.round(local.y * 100) / 100,
          z: Math.round(local.z * 100) / 100,
        };
        worldHitPos = {
          x: Math.round(hitPoint.x * 100) / 100,
          y: Math.round(hitPoint.y * 100) / 100,
          z: Math.round(hitPoint.z * 100) / 100,
        };
      } else {
        localPos = { x: 0, y: 0, z: 0 };
        worldHitPos = {
          x: Math.round(targetWorldPos.x * 100) / 100,
          y: Math.round(targetWorldPos.y * 100) / 100,
          z: Math.round(targetWorldPos.z * 100) / 100,
        };
      }

      const clickEvent = new VirtualCustomEvent("click", {
        bubbles: true,
        detail: { position: localPos },
      });
      (mElement as any).dispatchEvent?.(clickEvent);

      const remoteDoc = (mElement as any).getInitiatedRemoteDocument?.();
      const hasRemoteDoc = !!remoteDoc;
      if (remoteDoc) {
        remoteDoc.dispatchEvent(
          new VirtualCustomEvent("consume-event", {
            bubbles: false,
            detail: { element: mElement, originalEvent: clickEvent },
          }),
        );
      }
      return {
        success: true,
        elementTag: mElement.tagName?.toLowerCase(),
        hitPosition: worldHitPos,
        remoteDocForwarded: hasRemoteDoc,
      };
    }

    // Line-of-sight check
    const eyePos = new THREE.Vector3(avatarPos.x, avatarPos.y + 1.5, avatarPos.z);
    const direction = targetWorldPos.clone().sub(eyePos).normalize();
    const distance = eyePos.distanceTo(targetWorldPos);

    const originalSides = new Map<THREE.Material, THREE.Side>();
    this.rootGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        const mat = mesh.material as THREE.Material;
        if (mat.side !== THREE.DoubleSide) {
          originalSides.set(mat, mat.side);
          mat.side = THREE.DoubleSide;
        }
      }
    });

    let intersections: THREE.Intersection[];
    try {
      const raycaster = new THREE.Raycaster(eyePos, direction, 0, distance + 1);
      intersections = raycaster.intersectObject(this.rootGroup, true);
    } finally {
      // Restore original material sides even if raycasting throws
      for (const [mat, side] of originalSides) {
        mat.side = side;
      }
    }

    const SOLID_BLOCKERS = new Set(["m-cube", "m-sphere", "m-cylinder", "m-model"]);

    for (const hit of intersections) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        const hitElement = MElement.getMElementFromObject(obj);
        if (hitElement) {
          if (hitElement === mElement) {
            const container = mElement.getContainer();
            const local = container.worldToLocal(hit.point.clone());
            const localPos = {
              x: Math.round(local.x * 100) / 100,
              y: Math.round(local.y * 100) / 100,
              z: Math.round(local.z * 100) / 100,
            };
            const worldHitPos = {
              x: Math.round(hit.point.x * 100) / 100,
              y: Math.round(hit.point.y * 100) / 100,
              z: Math.round(hit.point.z * 100) / 100,
            };
            const clickEvent = new VirtualCustomEvent("click", {
              bubbles: true,
              detail: { position: localPos },
            });
            (mElement as any).dispatchEvent?.(clickEvent);

            const remoteDoc = (mElement as any).getInitiatedRemoteDocument?.();
            const hasRemoteDoc = !!remoteDoc;
            if (remoteDoc) {
              remoteDoc.dispatchEvent(
                new VirtualCustomEvent("consume-event", {
                  bubbles: false,
                  detail: { element: mElement, originalEvent: clickEvent },
                }),
              );
            }
            return {
              success: true,
              elementTag: mElement.tagName?.toLowerCase(),
              hitPosition: worldHitPos,
              remoteDocForwarded: hasRemoteDoc,
            };
          }

          const blockerTag = (hitElement as any).tagName?.toLowerCase() ?? "";
          if (SOLID_BLOCKERS.has(blockerTag)) {
            return { success: false, error: `Line of sight blocked by ${blockerTag}` };
          }
          break;
        }
        obj = obj.parent;
      }
    }

    return { success: false, error: "Could not reach element (no intersection found)." };
  }

  triggerInteraction(
    nodeId: number,
    avatarPos: { x: number; y: number; z: number },
  ): {
    success: boolean;
    error?: string;
    prompt?: string;
    remoteDocForwarded?: boolean;
  } {
    const mElement = this.elementByNodeId.get(nodeId);
    if (!mElement) {
      return { success: false, error: "Unknown node ID. Call get_scene_info to refresh." };
    }

    if (!mElement.isConnected) {
      return {
        success: false,
        error: "Element no longer exists. Call get_scene_info to refresh.",
      };
    }

    const tag = mElement.tagName?.toLowerCase();
    if (tag !== "m-interaction") {
      return {
        success: false,
        error: `Element is a <${tag}>, not an m-interaction. Use click for geometry elements.`,
      };
    }

    const range = parseFloat(
      mElement.getAttribute("range") ?? mElement.getAttribute("radius") ?? "5",
    );
    const elementPos = new THREE.Vector3();
    try {
      if (mElement.getContainer) {
        mElement.getContainer().getWorldPosition(elementPos);
      } else if (mElement.parentElement?.getContainer) {
        mElement.parentElement.getContainer().getWorldPosition(elementPos);
      }
    } catch {
      // Use origin if we can't get position
    }

    const avatarVec = new THREE.Vector3(avatarPos.x, avatarPos.y, avatarPos.z);
    const dist = avatarVec.distanceTo(elementPos);
    if (dist > range) {
      return {
        success: false,
        error: `Too far from interaction (distance: ${Math.round(dist * 10) / 10}, range: ${range}). Move closer first.`,
      };
    }

    const remoteDoc = (mElement as any).getInitiatedRemoteDocument?.();
    const hasRemoteDoc = !!remoteDoc;
    if (remoteDoc) {
      const interactEvent = new VirtualCustomEvent("interact", {
        bubbles: false,
        detail: {},
      });
      remoteDoc.dispatchEvent(
        new VirtualCustomEvent("consume-event", {
          bubbles: false,
          detail: { element: mElement, originalEvent: interactEvent },
        }),
      );
    }

    return {
      success: true,
      prompt: mElement.getAttribute("prompt") ?? undefined,
      remoteDocForwarded: hasRemoteDoc,
    };
  }

  get isLoaded(): boolean {
    return this._loaded;
  }

  get colliderCount(): number {
    return this.colliderCount_;
  }

  dispose(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.graphicsRetryInterval) {
      clearInterval(this.graphicsRetryInterval);
      this.graphicsRetryInterval = null;
    }
    if (this.changeDebounceTimer) {
      clearTimeout(this.changeDebounceTimer);
      this.changeDebounceTimer = null;
    }
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    // Unregister this scene's change handler
    handlersByDoc.delete(this.virtualDoc);
    this.sceneChangeEmitter.removeAllListeners();
    this.nodeIdByElement.clear();
    this.elementByNodeId.clear();
    for (const source of this.mmlSources) {
      source.dispose();
    }
    this.mmlSources = [];
    for (const el of this.documentTargetElements) {
      el.remove();
    }
    this.documentTargetElements = [];
    this.documentEntries.clear();
  }
}
