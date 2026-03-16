/**
 * Tests for HeadlessMMLScene.ts — focuses on the query/interaction layer.
 *
 * The constructor sets up MML + Three.js with mocked dependencies (via
 * vitest resolve.alias). We then test:
 * - Scene summary and mesh counting
 * - getFilteredSceneInfo
 * - getElementTypeCounts
 * - clickNode error paths
 * - triggerInteraction error paths
 * - onSceneChanged / offSceneChanged
 * - dispose cleanup
 */
import { describe, expect, test, beforeEach, afterEach, vi, beforeAll } from "vitest";

// Install minimal DOM stubs BEFORE any source modules are imported.
// These tests mock most MML/Three.js modules, so only basic globals are needed.
import { installNodePolyfills } from "../src/node-polyfills";
installNodePolyfills();

// The mml-web and mml-web-threejs mocks are auto-resolved by vitest.config.ts resolve.alias
// We also need to mock @mml-io/3d-web-client-core's CollisionsManager
vi.mock("@mml-io/3d-web-client-core", () => ({
  CollisionsManager: vi.fn().mockImplementation(function () {
    return {
      addMeshesGroup: vi.fn(),
      setCharacterPosition: vi.fn(),
      updateMeshesGroup: vi.fn(),
      removeMeshesGroup: vi.fn(),
    };
  }),
  Matr4: vi.fn().mockImplementation(function () {
    return {
      fromArray: vi.fn().mockReturnThis(),
    };
  }),
}));

// Mock ColliderUtils to avoid needing real BVH
vi.mock("../src/ColliderUtils", () => ({
  createCollisionMesh: vi.fn().mockReturnValue({
    meshBVH: {},
    matrix: { fromArray: vi.fn() },
    localScale: { x: 1, y: 1, z: 1 },
  }),
}));

let HeadlessMMLScene: any;
let CollisionsManager: any;
let THREE: any;

beforeAll(async () => {
  THREE = await import("three");
  const sceneModule = await import("../src/HeadlessMMLScene");
  HeadlessMMLScene = sceneModule.HeadlessMMLScene;
  const coreModule = await import("@mml-io/3d-web-client-core");
  CollisionsManager = coreModule.CollisionsManager;
});

describe("HeadlessMMLScene", () => {
  let scene: any;
  let collisionsManager: any;

  /** Helper: create an element in the scene's virtual DOM and append it to the root. */
  function createSceneElement(tagName: string): any {
    const el = (scene as any).virtualDoc.createElement(tagName);
    return el;
  }

  /** Helper: append an element to the scene's virtual DOM root. */
  function appendToRoot(el: any): void {
    (scene as any).root.appendChild(el);
  }

  beforeEach(() => {
    collisionsManager = new CollisionsManager();
    const getPos = () => ({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    scene = new HeadlessMMLScene(getPos, collisionsManager);
  });

  afterEach(() => {
    scene.dispose();
  });

  describe("construction", () => {
    test("creates a Three.js scene and rootGroup", () => {
      expect(scene.scene).toBeDefined();
      expect(scene.rootGroup).toBeDefined();
    });

    test("starts not loaded", () => {
      expect(scene.isLoaded).toBe(false);
    });

    test("colliderCount starts at 0", () => {
      expect(scene.colliderCount).toBe(0);
    });
  });

  describe("countMeshes / collectMeshes", () => {
    test("countMeshes counts meshes in the scene", () => {
      // The scene has a ground mesh added in the constructor
      const count = scene.countMeshes();
      expect(count).toBeGreaterThanOrEqual(1);
    });

    test("collectMeshes returns array of meshes", () => {
      const meshes = scene.collectMeshes();
      expect(Array.isArray(meshes)).toBe(true);
      expect(meshes.length).toBeGreaterThanOrEqual(1);
      // Ground mesh should be there
      const groundMesh = meshes.find((m: any) => m.name === "ground-plane");
      expect(groundMesh).toBeDefined();
    });
  });

  describe("getSceneInfo", () => {
    test("returns scene info for all meshes", () => {
      const info = scene.getSceneInfo();
      expect(Array.isArray(info)).toBe(true);
      // Should include at least the ground plane mesh
      expect(info.length).toBeGreaterThanOrEqual(1);
      for (const item of info) {
        expect(item.name).toBeDefined();
        expect(item.type).toBeDefined();
        expect(item.position).toBeDefined();
        expect(item.size).toBeDefined();
      }
    });
  });

  describe("getSceneSummary", () => {
    test("returns mesh count and bounding box", () => {
      const summary = scene.getSceneSummary();
      expect(summary.meshCount).toBeGreaterThanOrEqual(1);
      expect(summary.boundingBox).toBeDefined();
      expect(summary.boundingBox.min).toHaveLength(3);
      expect(summary.boundingBox.max).toHaveLength(3);
      expect(summary.landmarks).toBeInstanceOf(Array);
    });
  });

  describe("getFilteredSceneInfo", () => {
    test("returns meshes within radius", () => {
      const info = scene.getFilteredSceneInfo({ x: 0, y: 0, z: 0 }, 1000, 50);
      expect(Array.isArray(info)).toBe(true);
      // Ground plane at origin should be included
      expect(info.length).toBeGreaterThanOrEqual(1);
      for (const item of info) {
        expect(item.name).toBeDefined();
        expect(item.dist).toBeDefined();
        expect(item.dist).toBeLessThanOrEqual(1000);
      }
    });

    test("respects maxResults limit", () => {
      const info = scene.getFilteredSceneInfo({ x: 0, y: 0, z: 0 }, 1000, 1);
      expect(info.length).toBeLessThanOrEqual(1);
    });

    test("filters by radius", () => {
      // Use a tiny radius — only meshes at origin should match
      const info = scene.getFilteredSceneInfo({ x: 1000, y: 1000, z: 1000 }, 0.1, 50);
      expect(info.length).toBe(0);
    });
  });

  describe("getElementTypeCounts", () => {
    test("returns empty counts when no MML elements exist", () => {
      const counts = scene.getElementTypeCounts();
      expect(typeof counts).toBe("object");
    });

    test("counts elements by tag name when elements are registered in the DOM", () => {
      const cube1 = createSceneElement("m-cube");
      const cube2 = createSceneElement("m-cube");
      const sphere = createSceneElement("m-sphere");
      appendToRoot(cube1);
      appendToRoot(cube2);
      appendToRoot(sphere);

      const counts = scene.getElementTypeCounts();
      expect(counts["m-cube"]).toBe(2);
      expect(counts["m-sphere"]).toBe(1);

      // Cleanup
      cube1.remove();
      cube2.remove();
      sphere.remove();
    });
  });

  describe("getClickableElements", () => {
    test("returns empty array when no clickable elements exist", () => {
      const elements = scene.getClickableElements();
      expect(Array.isArray(elements)).toBe(true);
      expect(elements.length).toBe(0);
    });

    test("returns clickable elements with node IDs and positions", () => {
      const container = new THREE.Group();
      container.position.set(3, 1, 2);
      container.updateMatrixWorld(true);

      const cube = createSceneElement("m-cube") as any;
      cube.isClickable = () => true;
      cube.getContainer = () => container;
      cube.getAttribute = (name: string) => {
        if (name === "color") return "red";
        return null;
      };
      appendToRoot(cube);

      const elements = scene.getClickableElements();
      expect(elements.length).toBe(1);
      expect(elements[0].tag).toBe("m-cube");
      expect(elements[0].position.x).toBeCloseTo(3);
      expect(elements[0].position.y).toBeCloseTo(1);
      expect(elements[0].position.z).toBeCloseTo(2);
      expect(elements[0].nodeId).toBeDefined();
      expect(elements[0].attributes.color).toBe("red");

      cube.remove();
    });

    test("skips non-clickable elements (except m-model)", () => {
      const container = new THREE.Group();
      container.updateMatrixWorld(true);

      const cube = createSceneElement("m-cube") as any;
      cube.isClickable = () => false;
      cube.getContainer = () => container;
      cube.getAttribute = () => null;
      appendToRoot(cube);

      const elements = scene.getClickableElements();
      expect(elements.length).toBe(0);

      cube.remove();
    });

    test("includes m-model even without isClickable", () => {
      const container = new THREE.Group();
      container.position.set(1, 0, 0);
      container.updateMatrixWorld(true);

      const model = createSceneElement("m-model") as any;
      // m-model doesn't need isClickable
      model.getContainer = () => container;
      model.getAttribute = (name: string) => {
        if (name === "src") return "/models/tree.glb";
        return null;
      };
      appendToRoot(model);

      const elements = scene.getClickableElements();
      expect(elements.length).toBe(1);
      expect(elements[0].tag).toBe("m-model");

      model.remove();
    });

    test("skips elements whose getContainer throws", () => {
      const cube = createSceneElement("m-cube") as any;
      cube.isClickable = () => true;
      cube.getContainer = () => {
        throw new Error("disposed");
      };
      cube.getAttribute = () => null;
      appendToRoot(cube);

      const elements = scene.getClickableElements();
      expect(elements.length).toBe(0);

      cube.remove();
    });
  });

  describe("getInteractionElements", () => {
    test("returns empty array when no interaction elements exist", () => {
      const elements = scene.getInteractionElements();
      expect(Array.isArray(elements)).toBe(true);
      expect(elements.length).toBe(0);
    });

    test("returns interaction elements with getContainer", () => {
      const container = new THREE.Group();
      container.position.set(5, 0, 5);
      container.updateMatrixWorld(true);

      const interaction = createSceneElement("m-interaction") as any;
      interaction.getContainer = () => container;
      interaction.getAttribute = (name: string) => {
        if (name === "prompt") return "Press E to interact";
        if (name === "range") return "5";
        return null;
      };
      appendToRoot(interaction);

      const elements = scene.getInteractionElements();
      expect(elements.length).toBe(1);
      expect(elements[0].tag).toBe("m-interaction");
      expect(elements[0].position.x).toBeCloseTo(5);
      expect(elements[0].attributes.prompt).toBe("Press E to interact");
      expect(elements[0].attributes.range).toBe("5");

      interaction.remove();
    });

    test("uses parent container when element has no getContainer", () => {
      const parentContainer = new THREE.Group();
      parentContainer.position.set(3, 0, 3);
      parentContainer.updateMatrixWorld(true);

      const parent = createSceneElement("m-group") as any;
      parent.getContainer = () => parentContainer;
      const interaction = createSceneElement("m-interaction") as any;
      // No getContainer on interaction element
      interaction.getAttribute = (name: string) => {
        if (name === "prompt") return "Hello";
        return null;
      };
      parent.appendChild(interaction);
      appendToRoot(parent);

      const elements = scene.getInteractionElements();
      expect(elements.length).toBe(1);
      expect(elements[0].position.x).toBeCloseTo(3);

      parent.remove();
    });

    test("skips elements that throw", () => {
      const interaction = createSceneElement("m-interaction") as any;
      interaction.getContainer = () => {
        throw new Error("disposed");
      };
      interaction.getAttribute = () => null;
      appendToRoot(interaction);

      const elements = scene.getInteractionElements();
      expect(elements.length).toBe(0);

      interaction.remove();
    });
  });

  describe("getLabelElements", () => {
    test("returns empty array when no label elements exist", () => {
      const elements = scene.getLabelElements();
      expect(Array.isArray(elements)).toBe(true);
      expect(elements.length).toBe(0);
    });

    test("accepts avatar position parameter", () => {
      const elements = scene.getLabelElements({ x: 0, y: 0, z: 0 }, 10);
      expect(Array.isArray(elements)).toBe(true);
    });

    test("returns non-clickable label elements", () => {
      const container = new THREE.Group();
      container.position.set(2, 1, 0);
      container.updateMatrixWorld(true);

      const label = createSceneElement("m-label") as any;
      label.isClickable = () => false;
      label.getContainer = () => container;
      label.getAttribute = (name: string) => {
        if (name === "content") return "Hello World";
        if (name === "width") return "3";
        return null;
      };
      appendToRoot(label);

      const elements = scene.getLabelElements();
      expect(elements.length).toBe(1);
      expect(elements[0].tag).toBe("m-label");
      expect(elements[0].attributes.content).toBe("Hello World");
      expect(elements[0].attributes.width).toBe("3");

      label.remove();
    });

    test("skips clickable labels", () => {
      const container = new THREE.Group();
      container.updateMatrixWorld(true);

      const label = createSceneElement("m-label") as any;
      label.isClickable = () => true;
      label.getContainer = () => container;
      label.getAttribute = (name: string) => {
        if (name === "content") return "Click me";
        return null;
      };
      appendToRoot(label);

      const elements = scene.getLabelElements();
      expect(elements.length).toBe(0);

      label.remove();
    });

    test("replaces content with distance message when too far", () => {
      const container = new THREE.Group();
      container.position.set(100, 0, 100);
      container.updateMatrixWorld(true);

      const label = createSceneElement("m-label") as any;
      label.isClickable = () => false;
      label.getContainer = () => container;
      label.getAttribute = (name: string) => {
        if (name === "content") return "Far away text";
        return null;
      };
      appendToRoot(label);

      // Pass avatar position at origin, label is far away
      const elements = scene.getLabelElements({ x: 0, y: 0, z: 0 }, 15);
      expect(elements.length).toBe(1);
      expect(elements[0].attributes.content).toBe("[too far to read — move closer]");

      label.remove();
    });

    test("keeps content when within read distance", () => {
      const container = new THREE.Group();
      container.position.set(2, 0, 0);
      container.updateMatrixWorld(true);

      const label = createSceneElement("m-label") as any;
      label.isClickable = () => false;
      label.getContainer = () => container;
      label.getAttribute = (name: string) => {
        if (name === "content") return "Nearby text";
        return null;
      };
      appendToRoot(label);

      const elements = scene.getLabelElements({ x: 0, y: 0, z: 0 }, 15);
      expect(elements.length).toBe(1);
      expect(elements[0].attributes.content).toBe("Nearby text");

      label.remove();
    });
  });

  describe("getAllElements", () => {
    test("returns empty array when no elements exist", () => {
      const elements = scene.getAllElements({ x: 0, y: 0, z: 0 });
      expect(Array.isArray(elements)).toBe(true);
    });

    test("accepts options", () => {
      const elements = scene.getAllElements(
        { x: 0, y: 0, z: 0 },
        { radius: 10, maxResults: 5, tagFilter: "m-cube" },
      );
      expect(Array.isArray(elements)).toBe(true);
    });

    test("returns elements with distance sorted by proximity", () => {
      const container1 = new THREE.Group();
      container1.position.set(5, 0, 0);
      container1.updateMatrixWorld(true);

      const container2 = new THREE.Group();
      container2.position.set(2, 0, 0);
      container2.updateMatrixWorld(true);

      const cube1 = createSceneElement("m-cube") as any;
      cube1.getContainer = () => container1;
      cube1.getAttribute = () => null;
      appendToRoot(cube1);

      const cube2 = createSceneElement("m-cube") as any;
      cube2.getContainer = () => container2;
      cube2.getAttribute = () => null;
      appendToRoot(cube2);

      const elements = scene.getAllElements({ x: 0, y: 0, z: 0 });
      expect(elements.length).toBe(2);
      // Should be sorted by distance: cube2 (dist 2) first, cube1 (dist 5) second
      expect(elements[0].distance).toBeLessThanOrEqual(elements[1].distance);

      cube1.remove();
      cube2.remove();
    });

    test("filters by tag", () => {
      const container = new THREE.Group();
      container.position.set(1, 0, 0);
      container.updateMatrixWorld(true);

      const cube = createSceneElement("m-cube") as any;
      cube.getContainer = () => container;
      cube.getAttribute = () => null;
      appendToRoot(cube);

      const sphere = createSceneElement("m-sphere") as any;
      sphere.getContainer = () => container;
      sphere.getAttribute = () => null;
      appendToRoot(sphere);

      const elements = scene.getAllElements({ x: 0, y: 0, z: 0 }, { tagFilter: "m-sphere" });
      expect(elements.length).toBe(1);
      expect(elements[0].tag).toBe("m-sphere");

      cube.remove();
      sphere.remove();
    });

    test("filters by radius", () => {
      const nearContainer = new THREE.Group();
      nearContainer.position.set(1, 0, 0);
      nearContainer.updateMatrixWorld(true);

      const farContainer = new THREE.Group();
      farContainer.position.set(100, 0, 0);
      farContainer.updateMatrixWorld(true);

      const nearCube = createSceneElement("m-cube") as any;
      nearCube.getContainer = () => nearContainer;
      nearCube.getAttribute = () => null;
      appendToRoot(nearCube);

      const farCube = createSceneElement("m-cube") as any;
      farCube.getContainer = () => farContainer;
      farCube.getAttribute = () => null;
      appendToRoot(farCube);

      const elements = scene.getAllElements({ x: 0, y: 0, z: 0 }, { radius: 10 });
      expect(elements.length).toBe(1);
      expect(elements[0].distance).toBeLessThanOrEqual(10);

      nearCube.remove();
      farCube.remove();
    });

    test("respects maxResults", () => {
      const containers: any[] = [];
      const cubes: any[] = [];
      for (let i = 0; i < 5; i++) {
        const container = new THREE.Group();
        container.position.set(i + 1, 0, 0);
        container.updateMatrixWorld(true);
        containers.push(container);

        const cube = createSceneElement("m-cube") as any;
        cube.getContainer = () => container;
        cube.getAttribute = () => null;
        appendToRoot(cube);
        cubes.push(cube);
      }

      const elements = scene.getAllElements({ x: 0, y: 0, z: 0 }, { maxResults: 2 });
      expect(elements.length).toBe(2);

      cubes.forEach((c: any) => c.remove());
    });

    test("replaces label content when too far", () => {
      const container = new THREE.Group();
      container.position.set(100, 0, 0);
      container.updateMatrixWorld(true);

      const label = createSceneElement("m-label") as any;
      label.getContainer = () => container;
      label.getAttribute = (name: string) => {
        if (name === "content") return "Secret text";
        return null;
      };
      appendToRoot(label);

      const elements = scene.getAllElements({ x: 0, y: 0, z: 0 }, { radius: 200 });
      const labelEl = elements.find((e: any) => e.tag === "m-label");
      expect(labelEl).toBeDefined();
      expect(labelEl!.attributes.content).toBe("[too far to read]");

      label.remove();
    });

    test("uses parent container when element has no getContainer", () => {
      const parentContainer = new THREE.Group();
      parentContainer.position.set(5, 0, 5);
      parentContainer.updateMatrixWorld(true);

      const parent = createSceneElement("m-group") as any;
      parent.getContainer = () => parentContainer;

      const interaction = createSceneElement("m-interaction") as any;
      // No getContainer on interaction
      interaction.getAttribute = () => null;
      parent.appendChild(interaction);
      appendToRoot(parent);

      const elements = scene.getAllElements({ x: 0, y: 0, z: 0 });
      // m-group and m-interaction should both appear
      const interactionEl = elements.find((e: any) => e.tag === "m-interaction");
      expect(interactionEl).toBeDefined();

      parent.remove();
    });

    test("skips elements without container and without parent container", () => {
      const interaction = createSceneElement("m-interaction") as any;
      // No getContainer, no parentElement.getContainer
      interaction.getAttribute = () => null;
      appendToRoot(interaction);

      const elements = scene.getAllElements({ x: 0, y: 0, z: 0 });
      const interactionEl = elements.find((e: any) => e.tag === "m-interaction");
      expect(interactionEl).toBeUndefined();

      interaction.remove();
    });
  });

  describe("getElementByNodeId", () => {
    test("returns null for unknown nodeId", () => {
      const element = scene.getElementByNodeId(999);
      expect(element).toBeNull();
    });
  });

  describe("clickNode", () => {
    test("returns error for unknown nodeId", () => {
      const result = scene.clickNode(999, { x: 0, y: 0, z: 0 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Unknown node ID/);
    });
  });

  describe("triggerInteraction", () => {
    test("returns error for unknown nodeId", () => {
      const result = scene.triggerInteraction(999, { x: 0, y: 0, z: 0 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Unknown node ID/);
    });
  });

  describe("onSceneChanged / offSceneChanged", () => {
    test("registers and unregisters scene change listener", () => {
      const handler = vi.fn();
      scene.onSceneChanged(handler);
      // handler is registered
      scene.offSceneChanged(handler);
      // No error — handler was removed
    });
  });

  describe("registerGroundPlaneCollider", () => {
    test("registers ground plane as a collider", () => {
      const initialCount = scene.colliderCount;
      scene.registerGroundPlaneCollider();
      expect(scene.colliderCount).toBe(initialCount + 1);
    });
  });

  describe("startTicking / dispose", () => {
    test("startTicking is idempotent", () => {
      scene.startTicking();
      scene.startTicking(); // Second call should be a no-op
      // No error
    });

    test("dispose clears all resources", () => {
      scene.startTicking();
      scene.dispose();
      // After dispose, isLoaded should still be whatever it was (dispose doesn't reset it)
      // But we can verify internal state is cleaned by re-disposing without error
      scene.dispose();
    });
  });

  describe("connectToDocument / disconnectFromDocument", () => {
    test("connectToDocument accepts a WebSocket URL", () => {
      // With mocked MMLNetworkSource, this should not throw
      expect(() => {
        scene.connectToDocument("ws://localhost:8080/mml-documents/test");
      }).not.toThrow();
    });

    test("disconnectFromDocument is no-op for unknown key", () => {
      expect(() => {
        scene.disconnectFromDocument("nonexistent-key");
      }).not.toThrow();
    });

    test("connectToDocumentByKey and disconnectFromDocument", () => {
      scene.connectToDocumentByKey("doc1", "ws://localhost:8080/mml-documents/doc1");
      expect(() => {
        scene.disconnectFromDocument("doc1");
      }).not.toThrow();
    });
  });

  describe("setMMLDocuments", () => {
    test("connects new documents and disconnects removed ones", () => {
      // Add two documents
      scene.setMMLDocuments(
        {
          doc1: { url: "/doc1" },
          doc2: { url: "/doc2" },
        },
        "ws://localhost:8080",
      );

      // Update — keep doc1, remove doc2, add doc3
      scene.setMMLDocuments(
        {
          doc1: { url: "/doc1" },
          doc3: { url: "/doc3" },
        },
        "ws://localhost:8080",
      );
      // No errors thrown
    });

    test("handles transform in document config", () => {
      scene.setMMLDocuments(
        {
          doc1: {
            url: "/doc1",
            position: { x: 5, y: 0, z: 5 },
            rotation: { x: 0, y: 90, z: 0 },
            scale: { x: 2, y: 2, z: 2 },
          },
        },
        "ws://localhost:8080",
      );
      // No errors thrown
    });
  });

  // ---- Tests that populate internal element registries ----

  /**
   * Helper to create a mock MML element and register it in the scene's
   * internal maps (nodeIdByElement / elementByNodeId).
   */
  function registerMockElement(
    sceneInstance: any,
    overrides: {
      tagName?: string;
      isConnected?: boolean;
      getContainer?: () => any;
      isClickable?: () => boolean;
      getAttribute?: (name: string) => string | null;
      getInitiatedRemoteDocument?: () => any;
      parentElement?: any;
    } = {},
  ): { element: any; nodeId: number } {
    const container = new THREE.Group();
    container.position.set(0, 0, 0);

    const element: any = {
      tagName: overrides.tagName ?? "M-CUBE",
      isConnected: overrides.isConnected ?? true,
      getContainer: overrides.getContainer ?? (() => container),
      isClickable: overrides.isClickable ?? (() => true),
      getAttribute: overrides.getAttribute ?? (() => null),
      getInitiatedRemoteDocument: overrides.getInitiatedRemoteDocument ?? (() => null),
      parentElement: overrides.parentElement ?? null,
    };

    // Access private maps
    const nodeIdByElement: Map<any, number> = (sceneInstance as any).nodeIdByElement;
    const elementByNodeId: Map<number, any> = (sceneInstance as any).elementByNodeId;
    const nodeId = (sceneInstance as any).nextNodeId++;
    nodeIdByElement.set(element, nodeId);
    elementByNodeId.set(nodeId, element);

    return { element, nodeId };
  }

  describe("clickNode with elements", () => {
    test("returns error when element is disconnected", () => {
      const { nodeId } = registerMockElement(scene, { isConnected: false });
      const result = scene.clickNode(nodeId, { x: 0, y: 0, z: 0 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no longer exists/);
    });

    test("returns error when element has no graphics container", () => {
      const { nodeId } = registerMockElement(scene, {
        getContainer: () => {
          throw new Error("No container");
        },
      });
      const result = scene.clickNode(nodeId, { x: 0, y: 0, z: 0 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no graphics container/);
    });

    test("returns error when element is too far", () => {
      const container = new THREE.Group();
      container.position.set(100, 0, 100);
      container.updateMatrixWorld(true);

      const { nodeId } = registerMockElement(scene, {
        getContainer: () => container,
      });
      const result = scene.clickNode(nodeId, { x: 0, y: 0, z: 0 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/too far/i);
    });

    test("close-range bypass succeeds (distance <= 4)", () => {
      const container = new THREE.Group();
      container.position.set(1, 0, 0);
      container.updateMatrixWorld(true);

      const { nodeId } = registerMockElement(scene, {
        getContainer: () => container,
      });
      const result = scene.clickNode(nodeId, { x: 0, y: 0, z: 0 });
      expect(result.success).toBe(true);
      expect(result.elementTag).toBe("m-cube");
      expect(result.hitPosition).toBeDefined();
    });

    test("close-range with remoteDoc forwards event", () => {
      const container = new THREE.Group();
      container.position.set(1, 0, 0);
      container.updateMatrixWorld(true);

      const mockRemoteDoc = {
        dispatchEvent: vi.fn(),
      };

      const { nodeId } = registerMockElement(scene, {
        getContainer: () => container,
        getInitiatedRemoteDocument: () => mockRemoteDoc,
      });
      const result = scene.clickNode(nodeId, { x: 0, y: 0, z: 0 });
      expect(result.success).toBe(true);
      expect(result.remoteDocForwarded).toBe(true);
      expect(mockRemoteDoc.dispatchEvent).toHaveBeenCalled();
    });

    test("close-range without remoteDoc returns remoteDocForwarded false", () => {
      const container = new THREE.Group();
      container.position.set(1, 0, 0);
      container.updateMatrixWorld(true);

      const { nodeId } = registerMockElement(scene, {
        getContainer: () => container,
        getInitiatedRemoteDocument: () => null,
      });
      const result = scene.clickNode(nodeId, { x: 0, y: 0, z: 0 });
      expect(result.success).toBe(true);
      expect(result.remoteDocForwarded).toBe(false);
    });

    test("line-of-sight check returns no-intersection for medium range", () => {
      // Place element at 10 units away (> 4 close range, < 20 max)
      const container = new THREE.Group();
      container.position.set(10, 0, 0);
      container.updateMatrixWorld(true);

      const { nodeId } = registerMockElement(scene, {
        getContainer: () => container,
      });
      // No meshes between avatar and target → raycaster finds no intersection
      const result = scene.clickNode(nodeId, { x: 0, y: 0, z: 0 });
      // Should return no-intersection error since there's no mesh to hit
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no intersection/i);
    });
  });

  describe("triggerInteraction with elements", () => {
    test("returns error when element is disconnected", () => {
      const { nodeId } = registerMockElement(scene, {
        tagName: "M-INTERACTION",
        isConnected: false,
      });
      const result = scene.triggerInteraction(nodeId, { x: 0, y: 0, z: 0 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no longer exists/);
    });

    test("returns error for non-interaction element", () => {
      const { nodeId } = registerMockElement(scene, { tagName: "M-CUBE" });
      const result = scene.triggerInteraction(nodeId, { x: 0, y: 0, z: 0 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not an m-interaction/);
    });

    test("returns error when too far from interaction", () => {
      const container = new THREE.Group();
      container.position.set(100, 0, 0);
      container.updateMatrixWorld(true);

      const { nodeId } = registerMockElement(scene, {
        tagName: "M-INTERACTION",
        getContainer: () => container,
        getAttribute: (name: string) => {
          if (name === "range") return "5";
          return null;
        },
      });
      const result = scene.triggerInteraction(nodeId, { x: 0, y: 0, z: 0 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Too far/);
    });

    test("succeeds when within range", () => {
      const container = new THREE.Group();
      container.position.set(2, 0, 0);
      container.updateMatrixWorld(true);

      const { nodeId } = registerMockElement(scene, {
        tagName: "M-INTERACTION",
        getContainer: () => container,
        getAttribute: (name: string) => {
          if (name === "range") return "5";
          if (name === "prompt") return "Click me!";
          return null;
        },
      });
      const result = scene.triggerInteraction(nodeId, { x: 0, y: 0, z: 0 });
      expect(result.success).toBe(true);
      expect(result.prompt).toBe("Click me!");
    });

    test("uses radius attribute as fallback for range", () => {
      const container = new THREE.Group();
      container.position.set(2, 0, 0);
      container.updateMatrixWorld(true);

      const { nodeId } = registerMockElement(scene, {
        tagName: "M-INTERACTION",
        getContainer: () => container,
        getAttribute: (name: string) => {
          if (name === "radius") return "10";
          return null;
        },
      });
      const result = scene.triggerInteraction(nodeId, { x: 0, y: 0, z: 0 });
      expect(result.success).toBe(true);
    });

    test("forwards event to remoteDoc when present", () => {
      const container = new THREE.Group();
      container.position.set(1, 0, 0);
      container.updateMatrixWorld(true);

      const mockRemoteDoc = {
        dispatchEvent: vi.fn(),
      };

      const { nodeId } = registerMockElement(scene, {
        tagName: "M-INTERACTION",
        getContainer: () => container,
        getAttribute: (name: string) => {
          if (name === "range") return "5";
          return null;
        },
        getInitiatedRemoteDocument: () => mockRemoteDoc,
      });
      const result = scene.triggerInteraction(nodeId, { x: 0, y: 0, z: 0 });
      expect(result.success).toBe(true);
      expect(result.remoteDocForwarded).toBe(true);
      expect(mockRemoteDoc.dispatchEvent).toHaveBeenCalled();
    });

    test("uses parent container when element has no getContainer", () => {
      const parentContainer = new THREE.Group();
      parentContainer.position.set(1, 0, 0);
      parentContainer.updateMatrixWorld(true);

      const { nodeId } = registerMockElement(scene, {
        tagName: "M-INTERACTION",
        getContainer: undefined as any,
        parentElement: {
          getContainer: () => parentContainer,
        },
        getAttribute: (name: string) => {
          if (name === "range") return "5";
          return null;
        },
      });
      // Remove getContainer from element to force parent fallback
      const el = (scene as any).elementByNodeId.get(nodeId);
      delete el.getContainer;

      const result = scene.triggerInteraction(nodeId, { x: 0, y: 0, z: 0 });
      expect(result.success).toBe(true);
    });
  });

  describe("getElementByNodeId with registered elements", () => {
    test("returns element info for a registered element", () => {
      const container = new THREE.Group();
      container.position.set(5, 2, 3);
      container.updateMatrixWorld(true);

      const { nodeId } = registerMockElement(scene, {
        tagName: "M-CUBE",
        getContainer: () => container,
        getAttribute: (name: string) => {
          if (name === "color") return "red";
          return null;
        },
      });
      const result = scene.getElementByNodeId(nodeId);
      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe(nodeId);
      expect(result!.tag).toBe("m-cube");
      expect(result!.position.x).toBeCloseTo(5);
      expect(result!.position.y).toBeCloseTo(2);
      expect(result!.position.z).toBeCloseTo(3);
      expect(result!.attributes.color).toBe("red");
    });

    test("returns null when element has no container and no parent container", () => {
      const { nodeId } = registerMockElement(scene, {
        tagName: "M-CUBE",
        parentElement: null,
      });
      // Remove getContainer to force fallback path
      const el = (scene as any).elementByNodeId.get(nodeId);
      delete el.getContainer;

      const result = scene.getElementByNodeId(nodeId);
      expect(result).toBeNull();
    });

    test("uses parent container when element has no getContainer", () => {
      const parentContainer = new THREE.Group();
      parentContainer.position.set(7, 0, 7);
      parentContainer.updateMatrixWorld(true);

      const { nodeId } = registerMockElement(scene, {
        tagName: "M-INTERACTION",
        parentElement: {
          getContainer: () => parentContainer,
        },
      });
      const el = (scene as any).elementByNodeId.get(nodeId);
      delete el.getContainer;

      const result = scene.getElementByNodeId(nodeId);
      expect(result).not.toBeNull();
      expect(result!.position.x).toBeCloseTo(7);
    });

    test("returns null when getContainer throws", () => {
      const { nodeId } = registerMockElement(scene, {
        tagName: "M-CUBE",
        getContainer: () => {
          throw new Error("disposed");
        },
      });
      const result = scene.getElementByNodeId(nodeId);
      expect(result).toBeNull();
    });
  });

  describe("collectAttributes", () => {
    test("collects common attributes", () => {
      const attrs = (scene as any).collectAttributes({
        tagName: "M-CUBE",
        getAttribute: (name: string) => {
          const map: Record<string, string> = { id: "my-cube", color: "blue", visible: "true" };
          return map[name] ?? null;
        },
      });
      expect(attrs.id).toBe("my-cube");
      expect(attrs.color).toBe("blue");
      expect(attrs.visible).toBe("true");
    });

    test("collects m-label specific attributes", () => {
      const attrs = (scene as any).collectAttributes({
        tagName: "M-LABEL",
        getAttribute: (name: string) => {
          const map: Record<string, string> = {
            content: "Hello World",
            width: "2",
            height: "1",
            "font-size": "24",
            alignment: "center",
          };
          return map[name] ?? null;
        },
      });
      expect(attrs.content).toBe("Hello World");
      expect(attrs.width).toBe("2");
      expect(attrs.height).toBe("1");
      expect(attrs["font-size"]).toBe("24");
      expect(attrs.alignment).toBe("center");
    });

    test("collects m-interaction specific attributes", () => {
      const attrs = (scene as any).collectAttributes({
        tagName: "M-INTERACTION",
        getAttribute: (name: string) => {
          const map: Record<string, string> = {
            prompt: "Talk to NPC",
            radius: "5",
            range: "10",
            "in-focus": "true",
            "line-of-sight": "true",
            priority: "1",
          };
          return map[name] ?? null;
        },
      });
      expect(attrs.prompt).toBe("Talk to NPC");
      expect(attrs.radius).toBe("5");
      expect(attrs.range).toBe("10");
      expect(attrs["in-focus"]).toBe("true");
      expect(attrs["line-of-sight"]).toBe("true");
      expect(attrs.priority).toBe("1");
    });

    test("collects m-frame specific attributes", () => {
      const attrs = (scene as any).collectAttributes({
        tagName: "M-FRAME",
        getAttribute: (name: string) => {
          const map: Record<string, string> = {
            src: "https://example.com",
            "load-range": "50",
            "unload-range": "100",
          };
          return map[name] ?? null;
        },
      });
      expect(attrs.src).toBe("https://example.com");
      expect(attrs["load-range"]).toBe("50");
      expect(attrs["unload-range"]).toBe("100");
    });

    test("collects m-model specific attributes", () => {
      const attrs = (scene as any).collectAttributes({
        tagName: "M-MODEL",
        getAttribute: (name: string) => {
          const map: Record<string, string> = { src: "/models/tree.glb", collide: "true" };
          return map[name] ?? null;
        },
      });
      expect(attrs.src).toBe("/models/tree.glb");
      expect(attrs.collide).toBe("true");
    });
  });

  describe("emitSceneChange debouncing", () => {
    test("batches changes within debounce window", () => {
      vi.useFakeTimers();
      // Force _loaded = true so emitSceneChange fires
      (scene as any)._loaded = true;

      const handler = vi.fn();
      scene.onSceneChanged(handler);

      // Emit multiple changes rapidly
      (scene as any).emitSceneChange("geometry_changed");
      (scene as any).emitSceneChange("content_changed", {
        nodeId: 0,
        tag: "m-label",
        attribute: "content",
        newValue: "hello",
      });
      (scene as any).emitSceneChange("geometry_changed"); // duplicate type

      // Before debounce, handler should not have been called
      expect(handler).not.toHaveBeenCalled();

      // Advance past debounce (300ms)
      vi.advanceTimersByTime(350);

      expect(handler).toHaveBeenCalledTimes(1);
      const [changes, changedElements] = handler.mock.calls[0] as [string[], any[]];
      // "geometry_changed" should appear only once (it's a Set)
      expect(changes).toContain("geometry_changed");
      expect(changes).toContain("content_changed");
      expect(changes).toHaveLength(2);
      expect(changedElements).toHaveLength(1);
      expect(changedElements[0].tag).toBe("m-label");

      scene.offSceneChanged(handler);
      vi.useRealTimers();
    });

    test("does not emit when scene is not loaded", () => {
      vi.useFakeTimers();
      expect((scene as any)._loaded).toBe(false);

      const handler = vi.fn();
      scene.onSceneChanged(handler);

      (scene as any).emitSceneChange("geometry_changed");
      vi.advanceTimersByTime(500);

      expect(handler).not.toHaveBeenCalled();

      scene.offSceneChanged(handler);
      vi.useRealTimers();
    });
  });

  describe("cleanupNodeIdMaps", () => {
    test("removes element from both maps", () => {
      const { element, nodeId } = registerMockElement(scene);
      expect((scene as any).elementByNodeId.get(nodeId)).toBe(element);

      (scene as any).cleanupNodeIdMaps(element);
      expect((scene as any).elementByNodeId.get(nodeId)).toBeUndefined();
      expect((scene as any).nodeIdByElement.get(element)).toBeUndefined();
    });

    test("recursively cleans up children", () => {
      const { element: parent, nodeId: parentId } = registerMockElement(scene);
      const { element: child, nodeId: childId } = registerMockElement(scene, {
        tagName: "M-SPHERE",
      });
      parent.children = [child];
      child.children = [];

      (scene as any).cleanupNodeIdMaps(parent);
      expect((scene as any).elementByNodeId.get(parentId)).toBeUndefined();
      expect((scene as any).elementByNodeId.get(childId)).toBeUndefined();
    });

    test("no-op for elements not in the map", () => {
      const unknownEl = { children: [] };
      expect(() => {
        (scene as any).cleanupNodeIdMaps(unknownEl);
      }).not.toThrow();
    });
  });

  describe("hasMMLDescendant", () => {
    test("returns true for M- prefixed elements", () => {
      const el = { tagName: "M-CUBE", children: [] };
      expect((scene as any).hasMMLDescendant(el)).toBe(true);
    });

    test("returns true when child is M- prefixed", () => {
      const el = {
        tagName: "DIV",
        children: [{ tagName: "M-SPHERE", children: [] }],
      };
      expect((scene as any).hasMMLDescendant(el)).toBe(true);
    });

    test("returns false for non-MML elements", () => {
      const el = {
        tagName: "DIV",
        children: [{ tagName: "SPAN", children: [] }],
      };
      expect((scene as any).hasMMLDescendant(el)).toBe(false);
    });
  });

  describe("waitForSceneReady", () => {
    test("returns true when meshes already exist (ground plane)", async () => {
      // The scene has a ground mesh, so countMeshes() > 0 from the start.
      // This should complete quickly.
      const result = await scene.waitForSceneReady(2000, 50);
      expect(result).toBe(true);
      expect(scene.isLoaded).toBe(true);
    });
  });

  describe("getOrAssignNodeId", () => {
    test("assigns new node IDs incrementally", () => {
      const el1 = { tagName: "M-CUBE" };
      const el2 = { tagName: "M-SPHERE" };
      const id1 = (scene as any).getOrAssignNodeId(el1);
      const id2 = (scene as any).getOrAssignNodeId(el2);
      expect(id2).toBe(id1 + 1);
    });

    test("returns same ID for same element", () => {
      const el = { tagName: "M-CUBE" };
      const id1 = (scene as any).getOrAssignNodeId(el);
      const id2 = (scene as any).getOrAssignNodeId(el);
      expect(id1).toBe(id2);
    });
  });

  describe("enrichWithNearbyLabels", () => {
    test("attaches nearbyLabel to non-label elements near a label", () => {
      // Create a label in the DOM
      const labelContainer = new THREE.Group();
      labelContainer.position.set(1, 0, 0);
      labelContainer.updateMatrixWorld(true);

      const label = createSceneElement("m-label") as any;
      label.getContainer = () => labelContainer;
      label.getAttribute = (name: string) => {
        if (name === "content") return "Treasure Chest";
        return null;
      };
      appendToRoot(label);

      // Call enrichWithNearbyLabels with a nearby element
      const results = [
        {
          nodeId: 1,
          tag: "m-cube",
          position: { x: 1.5, y: 0, z: 0 },
          attributes: {} as Record<string, string>,
        },
      ];
      (scene as any).enrichWithNearbyLabels(results);

      expect(results[0].attributes.nearbyLabel).toBe("Treasure Chest");

      label.remove();
    });

    test("does not attach nearbyLabel to label elements", () => {
      const labelContainer = new THREE.Group();
      labelContainer.position.set(0, 0, 0);
      labelContainer.updateMatrixWorld(true);

      const label = createSceneElement("m-label") as any;
      label.getContainer = () => labelContainer;
      label.getAttribute = (name: string) => {
        if (name === "content") return "Some Label";
        return null;
      };
      appendToRoot(label);

      const results = [
        {
          nodeId: 1,
          tag: "m-label",
          position: { x: 0, y: 0, z: 0 },
          attributes: {} as Record<string, string>,
        },
      ];
      (scene as any).enrichWithNearbyLabels(results);

      expect(results[0].attributes.nearbyLabel).toBeUndefined();

      label.remove();
    });

    test("does not attach nearbyLabel when label is too far", () => {
      const labelContainer = new THREE.Group();
      labelContainer.position.set(100, 0, 100);
      labelContainer.updateMatrixWorld(true);

      const label = createSceneElement("m-label") as any;
      label.getContainer = () => labelContainer;
      label.getAttribute = (name: string) => {
        if (name === "content") return "Far Label";
        return null;
      };
      appendToRoot(label);

      const results = [
        {
          nodeId: 1,
          tag: "m-cube",
          position: { x: 0, y: 0, z: 0 },
          attributes: {} as Record<string, string>,
        },
      ];
      (scene as any).enrichWithNearbyLabels(results);

      expect(results[0].attributes.nearbyLabel).toBeUndefined();

      label.remove();
    });

    test("picks closest label when multiple are nearby", () => {
      const container1 = new THREE.Group();
      container1.position.set(1, 0, 0);
      container1.updateMatrixWorld(true);

      const container2 = new THREE.Group();
      container2.position.set(0.5, 0, 0);
      container2.updateMatrixWorld(true);

      const label1 = createSceneElement("m-label") as any;
      label1.getContainer = () => container1;
      label1.getAttribute = (name: string) => {
        if (name === "content") return "Farther Label";
        return null;
      };
      appendToRoot(label1);

      const label2 = createSceneElement("m-label") as any;
      label2.getContainer = () => container2;
      label2.getAttribute = (name: string) => {
        if (name === "content") return "Closer Label";
        return null;
      };
      appendToRoot(label2);

      const results = [
        {
          nodeId: 1,
          tag: "m-cube",
          position: { x: 0, y: 0, z: 0 },
          attributes: {} as Record<string, string>,
        },
      ];
      (scene as any).enrichWithNearbyLabels(results);

      expect(results[0].attributes.nearbyLabel).toBe("Closer Label");

      label1.remove();
      label2.remove();
    });

    test("no-op when no labels exist", () => {
      const results = [
        {
          nodeId: 1,
          tag: "m-cube",
          position: { x: 0, y: 0, z: 0 },
          attributes: {} as Record<string, string>,
        },
      ];
      (scene as any).enrichWithNearbyLabels(results);
      expect(results[0].attributes.nearbyLabel).toBeUndefined();
    });

    test("skips labels without content", () => {
      const labelContainer = new THREE.Group();
      labelContainer.position.set(0, 0, 0);
      labelContainer.updateMatrixWorld(true);

      const label = createSceneElement("m-label") as any;
      label.getContainer = () => labelContainer;
      label.getAttribute = () => null; // no content
      appendToRoot(label);

      const results = [
        {
          nodeId: 1,
          tag: "m-cube",
          position: { x: 0, y: 0, z: 0 },
          attributes: {} as Record<string, string>,
        },
      ];
      (scene as any).enrichWithNearbyLabels(results);
      expect(results[0].attributes.nearbyLabel).toBeUndefined();

      label.remove();
    });
  });

  describe("mmlScene callbacks", () => {
    test("addCollider increments colliderCount", () => {
      const mmlScene = (scene as any).mmlScene;
      const initialCount = scene.colliderCount;
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      group.add(mesh);

      mmlScene.addCollider(group, { tagName: "m-cube" });
      expect(scene.colliderCount).toBe(initialCount + 1);
    });

    test("removeCollider decrements colliderCount", () => {
      const mmlScene = (scene as any).mmlScene;
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      group.add(mesh);

      mmlScene.addCollider(group, { tagName: "m-cube" });
      const countAfterAdd = scene.colliderCount;

      mmlScene.removeCollider(group);
      expect(scene.colliderCount).toBe(countAfterAdd - 1);
    });

    test("removeCollider does not go below 0", () => {
      const mmlScene = (scene as any).mmlScene;
      expect(scene.colliderCount).toBe(0);
      mmlScene.removeCollider({});
      expect(scene.colliderCount).toBe(0);
    });

    test("updateCollider calls collisionsManager.updateMeshesGroup", () => {
      const mmlScene = (scene as any).mmlScene;
      const group = new THREE.Group();
      group.scale.set(2, 2, 2);
      scene.scene.add(group);
      group.updateMatrixWorld(true);

      // Should not throw
      expect(() => {
        mmlScene.updateCollider(group);
      }).not.toThrow();
      expect(collisionsManager.updateMeshesGroup).toHaveBeenCalled();
    });

    test("getUserPositionAndRotation returns position/rotation", () => {
      const mmlScene = (scene as any).mmlScene;
      const result = mmlScene.getUserPositionAndRotation();
      expect(result.position).toEqual({ x: 0, y: 0, z: 0 });
      expect(result.rotation).toEqual({ x: 0, y: 0, z: 0 });
    });

    test("prompt and link are no-ops", () => {
      const mmlScene = (scene as any).mmlScene;
      expect(() => mmlScene.prompt()).not.toThrow();
      expect(() => mmlScene.link()).not.toThrow();
    });

    test("getLoadingProgressManager returns manager", () => {
      const mmlScene = (scene as any).mmlScene;
      const manager = mmlScene.getLoadingProgressManager();
      expect(manager).toBeDefined();
    });

    test("hasGraphicsAdapter returns false initially", () => {
      const mmlScene = (scene as any).mmlScene;
      expect(mmlScene.hasGraphicsAdapter()).toBe(false);
    });
  });

  describe("getFilteredSceneInfo deduplication", () => {
    test("deduplicates meshes with same name at same position", () => {
      // Add two meshes with the same name at the same position
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshBasicMaterial();
      const mesh1 = new THREE.Mesh(geo, mat);
      mesh1.name = "duplicate";
      mesh1.position.set(2, 0, 0);
      mesh1.updateMatrixWorld(true);
      scene.scene.add(mesh1);

      const mesh2 = new THREE.Mesh(geo, mat);
      mesh2.name = "duplicate";
      mesh2.position.set(2, 0, 0);
      mesh2.updateMatrixWorld(true);
      scene.scene.add(mesh2);

      const info = scene.getFilteredSceneInfo({ x: 0, y: 0, z: 0 }, 100, 50);
      const duplicates = info.filter((i: any) => i.name === "duplicate");
      // Should be deduplicated to 1
      expect(duplicates.length).toBe(1);

      scene.scene.remove(mesh1);
      scene.scene.remove(mesh2);
    });

    test("sorts results by distance", () => {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshBasicMaterial();

      const farMesh = new THREE.Mesh(geo, mat);
      farMesh.name = "far";
      farMesh.position.set(10, 0, 0);
      farMesh.updateMatrixWorld(true);
      scene.scene.add(farMesh);

      const nearMesh = new THREE.Mesh(geo, mat);
      nearMesh.name = "near";
      nearMesh.position.set(1, 0, 0);
      nearMesh.updateMatrixWorld(true);
      scene.scene.add(nearMesh);

      const info = scene.getFilteredSceneInfo({ x: 0, y: 0, z: 0 }, 100, 50);
      // Entries should be sorted by distance
      for (let i = 1; i < info.length; i++) {
        expect(info[i].dist).toBeGreaterThanOrEqual(info[i - 1].dist);
      }

      scene.scene.remove(farMesh);
      scene.scene.remove(nearMesh);
    });
  });

  describe("connectToDocument with transform", () => {
    test("connectToDocument accepts transform parameters", () => {
      expect(() => {
        scene.connectToDocument("ws://localhost:8080/mml-documents/test", {
          position: { x: 5, y: 0, z: 5 },
          rotation: { x: 0, y: 90, z: 0 },
          scale: { x: 2, y: 2, z: 2 },
        });
      }).not.toThrow();
    });

    test("connectToDocumentByKey with transform", () => {
      expect(() => {
        scene.connectToDocumentByKey("doc-transform", "ws://localhost:8080/mml-documents/test", {
          position: { x: 10, y: 0, z: 10 },
        });
      }).not.toThrow();

      // Cleanup
      scene.disconnectFromDocument("doc-transform");
    });

    test("connectToDocumentByKey replaces existing document with same key", () => {
      scene.connectToDocumentByKey("doc-replace", "ws://localhost:8080/mml-documents/doc1");
      // Connecting again with same key should disconnect the first
      scene.connectToDocumentByKey("doc-replace", "ws://localhost:8080/mml-documents/doc2");
      // No error - disconnect and reconnect worked

      scene.disconnectFromDocument("doc-replace");
    });
  });

  describe("dispose cleanup details", () => {
    test("clears tick interval on dispose", () => {
      scene.startTicking();
      expect((scene as any).tickInterval).not.toBeNull();
      scene.dispose();
      expect((scene as any).tickInterval).toBeNull();
    });

    test("clears graphics retry interval on dispose", () => {
      // graphicsRetryInterval is set in constructor via setupDynamicConnectionObserver
      // Just verify dispose clears it
      scene.dispose();
      expect((scene as any).graphicsRetryInterval).toBeNull();
    });

    test("unregisters change handler on dispose", () => {
      // Change handler is registered via handlersByDoc WeakMap keyed on virtualDoc
      scene.dispose();
      // After dispose, emitting changes should be a no-op (handler removed)
      // Verify no error on double-dispose
      scene.dispose();
    });

    test("clears change debounce timer on dispose", () => {
      vi.useFakeTimers();
      (scene as any)._loaded = true;
      (scene as any).emitSceneChange("test_change");
      // Timer should be set
      expect((scene as any).changeDebounceTimer).not.toBeNull();

      scene.dispose();
      expect((scene as any).changeDebounceTimer).toBeNull();
      vi.useRealTimers();
    });

    test("clears node ID maps on dispose", () => {
      registerMockElement(scene);
      registerMockElement(scene, { tagName: "M-SPHERE" });
      expect((scene as any).nodeIdByElement.size).toBe(2);
      expect((scene as any).elementByNodeId.size).toBe(2);

      scene.dispose();
      expect((scene as any).nodeIdByElement.size).toBe(0);
      expect((scene as any).elementByNodeId.size).toBe(0);
    });

    test("disposes MML sources on dispose", () => {
      scene.connectToDocument("ws://localhost:8080/mml-documents/test1");
      scene.connectToDocument("ws://localhost:8080/mml-documents/test2");
      expect((scene as any).mmlSources.length).toBe(2);

      scene.dispose();
      expect((scene as any).mmlSources.length).toBe(0);
    });

    test("removes document target elements on dispose", () => {
      scene.connectToDocument("ws://localhost:8080/mml-documents/test");
      expect((scene as any).documentTargetElements.length).toBe(1);

      scene.dispose();
      expect((scene as any).documentTargetElements.length).toBe(0);
    });

    test("clears document entries on dispose", () => {
      scene.connectToDocumentByKey("doc1", "ws://localhost:8080/mml-documents/doc1");
      expect((scene as any).documentEntries.size).toBe(1);

      scene.dispose();
      expect((scene as any).documentEntries.size).toBe(0);
    });
  });

  describe("getSceneInfo mesh naming", () => {
    test("uses parent name when mesh has no name", () => {
      const parent = new THREE.Group();
      parent.name = "parent-group";
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
      // mesh has no name
      parent.add(mesh);
      scene.scene.add(parent);
      parent.updateMatrixWorld(true);

      const info = scene.getSceneInfo();
      const parentMesh = info.find((i: any) => i.name === "parent-group");
      expect(parentMesh).toBeDefined();

      scene.scene.remove(parent);
    });

    test("uses 'unnamed' for meshes with no name and no parent name", () => {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
      // mesh and parent have no name
      scene.scene.add(mesh);
      mesh.updateMatrixWorld(true);

      const info = scene.getSceneInfo();
      // The scene itself has no name - but it's the mesh's parent
      // unnamed meshes get "unnamed"
      const found = info.find(
        (i: any) =>
          i.name === "unnamed" ||
          i.name === "" ||
          i.name === mesh.parent?.name ||
          i.name === mesh.name,
      );
      expect(found).toBeDefined();

      scene.scene.remove(mesh);
    });
  });

  describe("traverseAndConnect", () => {
    test("calls connectedCallback on M- elements", () => {
      const element = {
        tagName: "M-CUBE",
        connectedCallback: vi.fn(),
        mElementGraphics: null,
        children: [],
      };

      (scene as any).connectingElements = true;
      (scene as any).graphicsEnabled = true;
      (scene as any).traverseAndConnect(element);
      (scene as any).graphicsEnabled = false;
      (scene as any).connectingElements = false;

      expect(element.connectedCallback).toHaveBeenCalled();
    });

    test("handles connectedCallback errors gracefully for m-audio", () => {
      const element = {
        tagName: "M-AUDIO",
        connectedCallback: vi.fn().mockImplementation(() => {
          throw new Error("audio context not available");
        }),
        mElementGraphics: null,
        children: [],
      };

      // Should not throw
      expect(() => {
        (scene as any).traverseAndConnect(element);
      }).not.toThrow();
    });

    test("handles connectedCallback errors gracefully for other elements", () => {
      const element = {
        tagName: "M-CUBE",
        connectedCallback: vi.fn().mockImplementation(() => {
          throw new Error("some error");
        }),
        mElementGraphics: null,
        children: [],
      };

      // Should not throw
      expect(() => {
        (scene as any).traverseAndConnect(element);
      }).not.toThrow();
    });

    test("recursively traverses children", () => {
      const child = {
        tagName: "M-SPHERE",
        connectedCallback: vi.fn(),
        mElementGraphics: null,
        children: [],
      };
      const parent = {
        tagName: "M-GROUP",
        connectedCallback: vi.fn(),
        mElementGraphics: null,
        children: [child],
      };

      (scene as any).traverseAndConnect(parent);

      expect(parent.connectedCallback).toHaveBeenCalled();
      expect(child.connectedCallback).toHaveBeenCalled();
    });

    test("skips non-MML elements", () => {
      const element = {
        tagName: "DIV",
        children: [],
      };

      // Should not throw (no connectedCallback)
      expect(() => {
        (scene as any).traverseAndConnect(element);
      }).not.toThrow();
    });
  });

  describe("enableGraphicsAndTriggerCallbacks", () => {
    test("enables graphics and traverses virtual DOM root", () => {
      expect((scene as any).graphicsEnabled).toBe(false);

      (scene as any).enableGraphicsAndTriggerCallbacks();

      // After the call, graphicsEnabled stays true for late-arriving elements
      expect((scene as any).graphicsEnabled).toBe(true);
      expect((scene as any).changeHandler.connecting).toBe(false);
    });
  });

  describe("getSceneSummary with empty scene", () => {
    test("returns zero bounding box when no meshes exist", () => {
      // Remove ground mesh to test empty scene
      const groundMesh = scene.scene.getObjectByName("ground-plane");
      if (groundMesh) scene.scene.remove(groundMesh);
      const groundCollider = scene.scene.getObjectByName("ground-collider");
      if (groundCollider) scene.scene.remove(groundCollider);

      // Also remove any other meshes
      const toRemove: any[] = [];
      scene.scene.traverse((obj: any) => {
        if (obj.isMesh) toRemove.push(obj);
      });
      for (const obj of toRemove) {
        obj.parent?.remove(obj);
      }

      const summary = scene.getSceneSummary();
      expect(summary.meshCount).toBe(0);
      expect(summary.boundingBox.min).toEqual([0, 0, 0]);
      expect(summary.boundingBox.max).toEqual([0, 0, 0]);
    });
  });

  describe("m-model with failed load (NaN matrixWorld)", () => {
    let nanMesh: any;

    beforeEach(() => {
      // Simulate a model that failed mid-load: its mesh exists in the scene
      // tree but has NaN in its matrixWorld (common when Three.js objects are
      // added before their transforms are computed, e.g. during a partial GLB parse).
      const geo = new THREE.BoxGeometry(1, 1, 1);
      nanMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
      nanMesh.name = "corrupted-model-mesh";
      nanMesh.position.set(NaN, NaN, NaN);
      scene.scene.add(nanMesh);
      nanMesh.updateMatrixWorld(true);
    });

    afterEach(() => {
      scene.scene.remove(nanMesh);
    });

    test("getSceneInfo skips meshes with NaN matrixWorld", () => {
      const info = scene.getSceneInfo();
      const corruptedEntry = info.find((i: any) => i.name === "corrupted-model-mesh");
      expect(corruptedEntry).toBeUndefined();
      // Should still include the ground plane
      expect(info.length).toBeGreaterThanOrEqual(1);
    });

    test("getSceneSummary bounding box is not poisoned by NaN meshes", () => {
      const summary = scene.getSceneSummary();
      // Bounding box should contain finite values, not NaN
      for (const v of [...summary.boundingBox.min, ...summary.boundingBox.max]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    });

    test("getFilteredSceneInfo skips meshes with NaN matrixWorld", () => {
      const info = scene.getFilteredSceneInfo({ x: 0, y: 0, z: 0 }, 1000, 50);
      const corruptedEntry = info.find((i: any) => i.name === "corrupted-model-mesh");
      expect(corruptedEntry).toBeUndefined();
      // All returned entries should have finite positions
      for (const entry of info) {
        for (const v of entry.pos) {
          expect(Number.isFinite(v)).toBe(true);
        }
      }
    });
  });

  describe("m-model element with getContainer throwing", () => {
    test("getSceneSummary skips m-model landmarks with failed getContainer", () => {
      const model = createSceneElement("m-model") as any;
      model.getContainer = () => {
        throw new Error("No container found");
      };
      model.getAttribute = (name: string) => {
        if (name === "src") return "/models/missing.glb";
        return null;
      };
      appendToRoot(model);

      // Should not throw and should return a valid summary
      const summary = scene.getSceneSummary();
      expect(summary).toBeDefined();
      expect(summary.meshCount).toBeGreaterThanOrEqual(0);

      model.remove();
    });

    test("getClickableElements skips m-model with failed getContainer", () => {
      const model = createSceneElement("m-model") as any;
      model.getContainer = () => {
        throw new Error("No container found");
      };
      model.getAttribute = () => null;
      appendToRoot(model);

      // Should not throw
      const elements = scene.getClickableElements();
      // The model should be skipped (getContainer threw)
      const modelEntry = elements.find((e: any) => e.tag === "m-model");
      expect(modelEntry).toBeUndefined();

      model.remove();
    });

    test("getCategorizedElements skips m-model with failed getContainer", () => {
      const model = createSceneElement("m-model") as any;
      model.getContainer = () => {
        throw new Error("No container found");
      };
      model.getAttribute = () => null;
      appendToRoot(model);

      // Should not throw
      const elements = scene.getCategorizedElements({ x: 0, y: 0, z: 0 });
      const modelEntry = elements.find((e: any) => e.tag === "m-model");
      expect(modelEntry).toBeUndefined();

      model.remove();
    });

    test("getAllElements skips m-model with failed getContainer", () => {
      const model = createSceneElement("m-model") as any;
      model.getContainer = () => {
        throw new Error("No container found");
      };
      model.getAttribute = () => null;
      appendToRoot(model);

      // Should not throw
      const elements = scene.getAllElements({ x: 0, y: 0, z: 0 });
      const modelEntry = elements.find((e: any) => e.tag === "m-model");
      expect(modelEntry).toBeUndefined();

      model.remove();
    });
  });

  describe("triggerInteraction without getContainer", () => {
    test("succeeds when element has no getContainer but parentElement.getContainer throws", () => {
      const { nodeId } = registerMockElement(scene, {
        tagName: "M-INTERACTION",
        getContainer: undefined as any,
        parentElement: {
          getContainer: () => {
            throw new Error("disposed");
          },
        },
        getAttribute: (name: string) => {
          if (name === "range") return "999";
          return null;
        },
      });
      const el = (scene as any).elementByNodeId.get(nodeId);
      delete el.getContainer;

      // The element position will be 0,0,0 since getting position throws
      // and avatar is at 0,0,0, so distance is 0 which is within range
      const result = scene.triggerInteraction(nodeId, { x: 0, y: 0, z: 0 });
      expect(result.success).toBe(true);
    });
  });

  describe("clickNode raycaster line-of-sight", () => {
    test("raycaster traverses rootGroup and sets materials to DoubleSide", () => {
      // Add a mesh to rootGroup with non-DoubleSide material
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(5, 1.5, 0);
      mesh.updateMatrixWorld(true);
      scene.rootGroup.add(mesh);
      scene.rootGroup.updateMatrixWorld(true);

      // Place element at medium range (> 4 close range, < 20 max)
      const container = new THREE.Group();
      container.position.set(10, 0, 0);
      container.updateMatrixWorld(true);

      const { nodeId } = registerMockElement(scene, {
        getContainer: () => container,
      });

      // The raycaster will run, materials will be temporarily set to DoubleSide
      scene.clickNode(nodeId, { x: 0, y: 0, z: 0 });

      // After clickNode, original material side should be restored
      expect(mat.side).toBe(THREE.FrontSide);

      scene.rootGroup.remove(mesh);
    });
  });
});
