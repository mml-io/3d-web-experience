import { jest, describe, expect, test, beforeEach } from "@jest/globals";

import type { MMLCharacterDescriptionPart } from "../src/helpers/parseMMLDescription";

// Mock @mml-io/model-loader
jest.unstable_mockModule("@mml-io/model-loader", () => ({
  ModelLoader: jest.fn(),
}));

// Minimal Three.js mocks
class MockBone {
  name: string;
  isBone = true;
  children: any[] = [];
  constructor(name: string) {
    this.name = name;
  }
  add(...children: any[]) {
    this.children.push(...children);
  }
}

class MockSkeleton {
  bones: MockBone[];
  constructor(bones: MockBone[]) {
    this.bones = bones;
  }
}

class MockSkinIndexAttr {
  count: number;
  data: number[];
  constructor(count: number) {
    this.count = count;
    this.data = new Array(count).fill(0);
  }
  getComponent(i: number, _c: number) {
    return this.data[i];
  }
  setComponent(i: number, _c: number, val: number) {
    this.data[i] = val;
  }
}

class MockSkinnedMesh {
  isSkinnedMesh = true;
  isBone = false;
  castShadow = false;
  receiveShadow = false;
  boundingSphere: any = null;
  skeleton: MockSkeleton;
  matrixWorld: any = {};
  geometry = {
    attributes: {
      skinIndex: new MockSkinIndexAttr(4),
    },
  };
  children: any[] = [];
  name = "mesh";
  constructor(skeleton: MockSkeleton) {
    this.skeleton = skeleton;
  }
  bind(_skel: any, _matrix: any) {}
}

class MockGroup {
  children: any[] = [];
  position = { set: jest.fn() };
  rotation = { set: jest.fn() };
  scale = { set: jest.fn() };
  add(...children: any[]) {
    this.children.push(...children);
  }
  traverse(fn: (child: any) => void) {
    fn(this);
    for (const child of this.children) {
      fn(child);
      if (child.children) {
        for (const grandchild of child.children) {
          fn(grandchild);
        }
      }
    }
  }
}

// Mock three.js
jest.unstable_mockModule("three", () => ({
  Group: MockGroup,
  Bone: MockBone,
  Skeleton: MockSkeleton,
  SkinnedMesh: MockSkinnedMesh,
  MathUtils: {
    degToRad: (deg: number) => (deg * Math.PI) / 180,
  },
  Sphere: jest.fn().mockImplementation(() => ({})),
  Vector3: jest.fn().mockImplementation(() => ({})),
  Object3D: jest.fn(),
}));

const { MMLCharacter } = await import("../src/character/MMLCharacter");

describe("MMLCharacter", () => {
  function createModelLoader(results: Map<string, any>) {
    return {
      load: jest.fn<any>().mockImplementation((url: string) => {
        return Promise.resolve(results.get(url) ?? null);
      }),
    };
  }

  function createBodyGroup() {
    const bones = [new MockBone("root"), new MockBone("head"), new MockBone("spine")];
    const skeleton = new MockSkeleton(bones);
    const skinnedMesh = new MockSkinnedMesh(skeleton);
    const group = new MockGroup();
    group.add(skinnedMesh);
    group.add(bones[0]);
    return { group, skinnedMesh, skeleton, bones };
  }

  test("load returns group with skinned mesh from body", async () => {
    const bodyData = createBodyGroup();
    const modelLoader = createModelLoader(new Map([["body.glb", { group: bodyData.group }]]));

    const result = await MMLCharacter.load("body.glb", [], modelLoader);
    expect(result).not.toBeNull();
  });

  test("load returns null when fullBodyAsset fails to load", async () => {
    const modelLoader = createModelLoader(new Map());
    const result = await MMLCharacter.load("missing.glb", [], modelLoader);
    expect(result).toBeNull();
  });

  test("load returns null when aborted before fullBody loads", async () => {
    const abortController = new AbortController();
    const modelLoader = {
      load: jest.fn<any>().mockImplementation(() => {
        abortController.abort();
        return Promise.resolve({ group: createBodyGroup().group });
      }),
    };

    const result = await MMLCharacter.load("body.glb", [], modelLoader, abortController);
    expect(result).toBeNull();
  });

  test("load returns null when aborted before body parts load", async () => {
    const abortController = new AbortController();
    const bodyData = createBodyGroup();

    let callCount = 0;
    const modelLoader = {
      load: jest.fn<any>().mockImplementation(() => {
        callCount++;
        if (callCount > 1) {
          abortController.abort();
        }
        return Promise.resolve({ group: bodyData.group });
      }),
    };

    const parts: MMLCharacterDescriptionPart[] = [{ url: "part.glb" }];
    const result = await MMLCharacter.load("body.glb", parts, modelLoader, abortController);
    expect(result).toBeNull();
  });

  test("load throws when no skinned mesh in base model", async () => {
    const emptyGroup = new MockGroup();
    const modelLoader = createModelLoader(new Map([["body.glb", { group: emptyGroup }]]));

    await expect(MMLCharacter.load("body.glb", [], modelLoader)).rejects.toThrow(
      "No skinned mesh in base model file",
    );
  });

  test("load attaches socketed parts to named bone", async () => {
    const bodyData = createBodyGroup();
    const partGroup = new MockGroup();
    const modelLoader = createModelLoader(
      new Map([
        ["body.glb", { group: bodyData.group }],
        ["hat.glb", { group: partGroup }],
      ]),
    );

    const parts: MMLCharacterDescriptionPart[] = [
      {
        url: "hat.glb",
        socket: {
          socket: "head",
          position: { x: 0, y: 0.5, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
    ];

    const result = await MMLCharacter.load("body.glb", parts, modelLoader);
    expect(result).not.toBeNull();
  });

  test("load falls back to root bone when socket bone not found", async () => {
    const bodyData = createBodyGroup();
    const partGroup = new MockGroup();
    const modelLoader = createModelLoader(
      new Map([
        ["body.glb", { group: bodyData.group }],
        ["hat.glb", { group: partGroup }],
      ]),
    );

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const parts: MMLCharacterDescriptionPart[] = [
      {
        url: "hat.glb",
        socket: {
          socket: "nonexistent_bone",
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
    ];

    await MMLCharacter.load("body.glb", parts, modelLoader);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("nonexistent_bone"));
    warnSpy.mockRestore();
  });

  test("load skips null body parts", async () => {
    const bodyData = createBodyGroup();
    const modelLoader = createModelLoader(new Map([["body.glb", { group: bodyData.group }]]));

    const parts: MMLCharacterDescriptionPart[] = [{ url: "missing_part.glb" }];
    const result = await MMLCharacter.load("body.glb", parts, modelLoader);
    expect(result).not.toBeNull();
  });

  test("load remaps bone indices for non-socketed parts", async () => {
    const bodyData = createBodyGroup();
    const partBones = [new MockBone("root"), new MockBone("head")];
    const partSkeleton = new MockSkeleton(partBones);
    const partSkinnedMesh = new MockSkinnedMesh(partSkeleton);
    const partGroup = new MockGroup();
    partGroup.add(partSkinnedMesh);

    const modelLoader = createModelLoader(
      new Map([
        ["body.glb", { group: bodyData.group }],
        ["part.glb", { group: partGroup }],
      ]),
    );

    const parts: MMLCharacterDescriptionPart[] = [{ url: "part.glb" }];
    const result = await MMLCharacter.load("body.glb", parts, modelLoader);
    expect(result).not.toBeNull();
  });

  test("load sets castShadow and receiveShadow on skinned meshes", async () => {
    const bodyData = createBodyGroup();
    bodyData.skinnedMesh.castShadow = false;
    bodyData.skinnedMesh.receiveShadow = false;

    const modelLoader = createModelLoader(new Map([["body.glb", { group: bodyData.group }]]));

    await MMLCharacter.load("body.glb", [], modelLoader);
    expect(bodyData.skinnedMesh.castShadow).toBe(true);
    expect(bodyData.skinnedMesh.receiveShadow).toBe(true);
  });
});
