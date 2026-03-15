/**
 * Integration tests for GLB model loading with node polyfills.
 *
 * Uses Node.js built-in test runner (node:test) instead of Jest because
 * Three.js examples are ESM-only and Jest's experimental ESM support
 * cannot reliably transform them.
 *
 * Run: npx tsx --test test/model-loading.test.ts
 */
import { readFileSync } from "fs";
import assert from "node:assert";
import { describe, it, before } from "node:test";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { installNodePolyfills } from "../src/node-polyfills";

installNodePolyfills();

const __dirname_test = dirname(fileURLToPath(import.meta.url));

function loadGlbBuffer(filename: string): ArrayBuffer {
  const filePath = resolve(__dirname_test, "fixtures", filename);
  const buf = readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * Create a DRACOLoader that reads the JS decoder from node_modules.
 *
 * Three.js DRACOLoader normally fetches the decoder via HTTP, but Node.js
 * fetch doesn't support file:// URLs. We patch _loadLibrary to read the
 * decoder files directly from disk.
 */
function createPreloadedDracoLoader(DRACOLoader: any): any {
  const dracoDir = resolve(
    __dirname_test,
    "..",
    "..",
    "..",
    "node_modules",
    "three",
    "examples",
    "jsm",
    "libs",
    "draco",
    "gltf",
  );

  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderConfig({ type: "js" });

  dracoLoader._loadLibrary = (url: string, responseType: string) => {
    const filePath = resolve(dracoDir, url);
    if (responseType === "arraybuffer") {
      const buf = readFileSync(filePath);
      return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    }
    return Promise.resolve(readFileSync(filePath, "utf-8"));
  };

  return dracoLoader;
}

let THREE: typeof import("three");
let GLTFLoader: any;
let DRACOLoader: any;

describe("model loading with polyfills", async () => {
  before(async () => {
    THREE = await import("three");
    const gltfMod = await import("three/examples/jsm/loaders/GLTFLoader.js");
    GLTFLoader = gltfMod.GLTFLoader;
    const dracoMod = await import("three/examples/jsm/loaders/DRACOLoader.js");
    DRACOLoader = dracoMod.DRACOLoader;
  });

  it("GLTFLoader parses a standard (non-Draco) GLB", async () => {
    const loader = new GLTFLoader();
    const buffer = loadGlbBuffer("duck.glb");

    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(buffer, "", resolve, reject);
    });

    assert.ok(gltf, "gltf result should be defined");
    assert.ok(gltf.scene instanceof THREE.Group, "scene should be a THREE.Group");

    const meshes: any[] = [];
    gltf.scene.traverse((child: any) => {
      if (child.isMesh) meshes.push(child);
    });
    assert.ok(meshes.length > 0, `expected at least one mesh, got ${meshes.length}`);

    const mesh = meshes[0];
    assert.ok(mesh.geometry instanceof THREE.BufferGeometry, "mesh should have BufferGeometry");
    const positions = mesh.geometry.getAttribute("position");
    assert.ok(positions, "mesh should have position attribute");
    assert.ok(positions.count > 0, `expected position count > 0, got ${positions.count}`);
  });

  it("GLTFLoader + DRACOLoader parses a Draco-compressed GLB", { timeout: 30000 }, async () => {
    const dracoLoader = createPreloadedDracoLoader(DRACOLoader);

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    const buffer = loadGlbBuffer("draco-duck.glb");

    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(buffer, "", resolve, reject);
    });

    assert.ok(gltf, "gltf result should be defined");
    assert.ok(gltf.scene instanceof THREE.Group, "scene should be a THREE.Group");

    const meshes: any[] = [];
    gltf.scene.traverse((child: any) => {
      if (child.isMesh) meshes.push(child);
    });
    assert.ok(meshes.length > 0, `expected at least one mesh, got ${meshes.length}`);

    const mesh = meshes[0];
    assert.ok(mesh.geometry instanceof THREE.BufferGeometry);
    const positions = mesh.geometry.getAttribute("position");
    assert.ok(positions && positions.count > 0, "draco mesh should have positions");
    assert.ok(mesh.geometry.getAttribute("normal"), "draco mesh should have normals");
    assert.ok(mesh.geometry.getAttribute("uv"), "draco mesh should have UVs");

    dracoLoader.dispose();
  });

  it("loaded model has correct bounding box dimensions", async () => {
    const loader = new GLTFLoader();
    const buffer = loadGlbBuffer("duck.glb");

    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(buffer, "", resolve, reject);
    });

    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = new THREE.Vector3();
    box.getSize(size);

    assert.ok(size.x > 0, `width should be > 0, got ${size.x}`);
    assert.ok(size.y > 0, `height should be > 0, got ${size.y}`);
    assert.ok(size.z > 0, `depth should be > 0, got ${size.z}`);
  });

  it("fetch proxy prevents FileLoader streaming hang", async () => {
    const response = await fetch("data:application/octet-stream;base64,AAAA");
    assert.strictEqual(response.body, undefined, "response.body should be masked");

    const ab = await response.arrayBuffer();
    assert.ok(ab.byteLength > 0, "arrayBuffer() should still work");
  });

  it("document.createElement returns functional canvas and img", () => {
    const doc = (globalThis as any).document;

    const canvas = doc.createElement("canvas");
    assert.ok(canvas, "canvas should be created");
    const ctx = canvas.getContext("2d");
    assert.ok(ctx, "canvas should have 2d context");

    const img = doc.createElement("img");
    assert.ok(img, "img should be created");
    assert.strictEqual(typeof img.addEventListener, "function");
  });

  it("Worker polyfill is available for DRACOLoader", () => {
    assert.ok((globalThis as any).Worker, "Worker should be defined");

    const blob = new Blob(["console.log('test')"], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    assert.strictEqual(typeof url, "string", "createObjectURL should return a string");
    URL.revokeObjectURL(url);
  });

  it("AudioContext stub provides required interface", () => {
    const ctx = new (globalThis as any).AudioContext();
    assert.strictEqual(ctx.state, "suspended");
    assert.strictEqual(typeof ctx.createGain, "function");
    assert.strictEqual(typeof ctx.createPanner, "function");
    assert.ok(ctx.destination !== undefined);
    assert.ok(ctx.resume() instanceof Promise);
    assert.ok(ctx.close() instanceof Promise);
  });

  it("img element fires load event with 1x1 blank image on src set", async () => {
    const doc = (globalThis as any).document;
    const img = doc.createElement("img");

    const loaded = await new Promise<boolean>((resolve) => {
      img.addEventListener("load", () => resolve(true));
      img.addEventListener("error", () => resolve(false));
      img.src = "https://example.com/texture.png";
    });

    assert.strictEqual(loaded, true, "img should fire load event");
    assert.strictEqual(img.width, 1, "img width should be 1");
    assert.strictEqual(img.height, 1, "img height should be 1");
  });
});
