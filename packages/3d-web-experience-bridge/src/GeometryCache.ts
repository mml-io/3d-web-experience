import * as THREE from "three";

interface CachedBBox {
  matrixHash: string;
  geometryId: number;
  worldBBox: THREE.Box3;
}

interface CachedGeometry {
  matrixHash: string;
  geometryId: number;
  worldPositions: Float32Array;
  indices: ArrayLike<number>;
  worldBBox: THREE.Box3;
}

// Maximum entries per cache layer before LRU eviction
const MAX_CACHE_SIZE = 500;

/**
 * Two-layer geometry cache for navmesh generation:
 *
 * Layer 1 (bboxCache): Cheap world AABBs for all meshes, computed from
 *   local bounding box + world matrix (8 corner transforms). Used for
 *   region filtering without extracting vertex data.
 *
 * Layer 2 (geometryCache): Full world-space vertex positions/indices
 *   only for meshes that pass region filtering. Only these meshes get
 *   the expensive per-vertex world transform.
 *
 * Both layers are bounded to MAX_CACHE_SIZE entries; least-recently-used
 * entries are evicted when the limit is exceeded. Map iteration order
 * in JS reflects insertion order, so re-inserting on access keeps the
 * most-recently-used entries at the end.
 *
 * This avoids extracting 1.6M+ triangles for a model when only ~39
 * region meshes (~53K triangles) are needed.
 */
export class GeometryCache {
  private bboxCache = new Map<number, CachedBBox>();
  private geometryCache = new Map<number, CachedGeometry>();
  private lastFilteredIds = new Set<number>();

  private static readonly _tempVec = new THREE.Vector3();

  /**
   * Check if a mesh's matrixWorld contains any NaN values.
   * Meshes that haven't fully loaded (e.g. GLB models mid-load) can have
   * NaN in their world matrix, which poisons every downstream calculation.
   */
  private static hasNaNMatrix(mesh: THREE.Mesh): boolean {
    const e = mesh.matrixWorld.elements;
    for (let i = 0; i < 16; i++) {
      if (isNaN(e[i])) return true;
    }
    return false;
  }

  private computeMatrixHash(mesh: THREE.Mesh): string {
    const e = mesh.matrixWorld.elements;
    const r = (v: number) => (v * 10000) | 0;
    return `${r(e[0])}|${r(e[1])}|${r(e[2])}|${r(e[4])}|${r(e[5])}|${r(e[6])}|${r(e[8])}|${r(e[9])}|${r(e[10])}|${r(e[12])}|${r(e[13])}|${r(e[14])}`;
  }

  /** Evict the oldest entries from a map until it is within MAX_CACHE_SIZE. */
  private evictIfNeeded<K, V>(map: Map<K, V>): void {
    if (map.size <= MAX_CACHE_SIZE) return;
    const excess = map.size - MAX_CACHE_SIZE;
    let removed = 0;
    for (const key of map.keys()) {
      if (removed >= excess) break;
      map.delete(key);
      removed++;
    }
  }

  /** Move an existing key to the end of Map iteration order (most-recently-used). */
  private touchKey<K, V>(map: Map<K, V>, key: K, value: V): void {
    map.delete(key);
    map.set(key, value);
  }

  private getCheapWorldBBox(mesh: THREE.Mesh): THREE.Box3 {
    const hash = this.computeMatrixHash(mesh);
    const cached = this.bboxCache.get(mesh.id);
    if (cached && cached.matrixHash === hash && cached.geometryId === mesh.geometry.id) {
      this.touchKey(this.bboxCache, mesh.id, cached);
      return cached.worldBBox;
    }

    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox();
    }

    if (!mesh.geometry.boundingBox) {
      return new THREE.Box3();
    }

    const worldBBox = mesh.geometry.boundingBox.clone();
    worldBBox.applyMatrix4(mesh.matrixWorld);

    const entry = { matrixHash: hash, geometryId: mesh.geometry.id, worldBBox };
    this.bboxCache.set(mesh.id, entry);
    this.evictIfNeeded(this.bboxCache);
    return worldBBox;
  }

  getFilteredGeometry(
    allMeshes: THREE.Mesh[],
    regionBox: THREE.Box3 | null,
    minMeshXZ: number,
  ): {
    perMesh: Array<{
      mesh: THREE.Mesh;
      positions: Float32Array;
      indices: ArrayLike<number>;
      bbox: THREE.Box3;
    }>;
    changed: boolean;
  } {
    const filteredMeshes: Array<{ mesh: THREE.Mesh; bbox: THREE.Box3 }> = [];
    let skippedNaN = 0;
    for (const mesh of allMeshes) {
      // Skip meshes with NaN world matrices — these are typically models
      // that haven't finished loading (GLB async load). Their matrixWorld
      // contains NaN which poisons all position calculations downstream.
      if (GeometryCache.hasNaNMatrix(mesh)) {
        skippedNaN++;
        continue;
      }

      // Skip meshes with no position attribute or zero vertices
      const posAttr = mesh.geometry?.attributes?.position;
      if (!posAttr || posAttr.count === 0) continue;

      if (mesh.name === "ground-plane") {
        const bbox = this.getCheapWorldBBox(mesh);
        filteredMeshes.push({ mesh, bbox });
        continue;
      }

      const bbox = this.getCheapWorldBBox(mesh);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      if (size.x < minMeshXZ && size.z < minMeshXZ) continue;
      if (regionBox && !regionBox.intersectsBox(bbox)) continue;
      filteredMeshes.push({ mesh, bbox });
    }
    if (skippedNaN > 0) {
      console.warn(`[geometry-cache] Skipped ${skippedNaN} meshes with NaN matrixWorld`);
    }

    let changed = false;
    const currentFilteredIds = new Set<number>();
    const results: Array<{
      mesh: THREE.Mesh;
      positions: Float32Array;
      indices: ArrayLike<number>;
      bbox: THREE.Box3;
    }> = [];

    for (const { mesh, bbox } of filteredMeshes) {
      currentFilteredIds.add(mesh.id);
      const hash = this.computeMatrixHash(mesh);
      const cached = this.geometryCache.get(mesh.id);

      if (cached && cached.matrixHash === hash && cached.geometryId === mesh.geometry.id) {
        this.touchKey(this.geometryCache, mesh.id, cached);
        results.push({
          mesh,
          positions: cached.worldPositions,
          indices: cached.indices,
          bbox: cached.worldBBox,
        });
      } else {
        changed = true;
        const extracted = this.extractWorldGeometry(mesh);
        const entry = {
          matrixHash: hash,
          geometryId: mesh.geometry.id,
          worldPositions: extracted.positions,
          indices: extracted.indices,
          worldBBox: extracted.bbox,
        };
        this.geometryCache.set(mesh.id, entry);
        this.evictIfNeeded(this.geometryCache);
        results.push({
          mesh,
          positions: extracted.positions,
          indices: extracted.indices,
          bbox: extracted.bbox,
        });
      }
    }

    for (const oldId of this.lastFilteredIds) {
      if (!currentFilteredIds.has(oldId)) {
        changed = true;
        this.geometryCache.delete(oldId);
      }
    }
    this.lastFilteredIds = currentFilteredIds;

    return { perMesh: results, changed };
  }

  mergeGeometry(
    perMesh: Array<{
      positions: Float32Array;
      indices: ArrayLike<number>;
    }>,
  ): [Float32Array, Uint32Array] {
    let totalPositions = 0;
    let totalIndices = 0;
    for (const m of perMesh) {
      totalPositions += m.positions.length;
      totalIndices += m.indices.length;
    }

    const mergedPositions = new Float32Array(totalPositions);
    const mergedIndices = new Uint32Array(totalIndices);
    let posOffset = 0;
    let idxOffset = 0;

    for (const m of perMesh) {
      mergedPositions.set(m.positions, posOffset);
      const vertexOffset = posOffset / 3;
      for (let i = 0; i < m.indices.length; i++) {
        mergedIndices[idxOffset + i] = m.indices[i] + vertexOffset;
      }
      posOffset += m.positions.length;
      idxOffset += m.indices.length;
    }

    return [mergedPositions, mergedIndices];
  }

  /**
   * Extract world-space vertex positions and indices from a single mesh.
   *
   * Uses posAttr.getX/Y/Z() instead of raw array indexing so that
   * InterleavedBufferAttribute (common in GLB models where position,
   * normal, and UV share a single ArrayBuffer) is read correctly.
   * Direct `new Float32Array(posAttr.array)` copies the full interleaved
   * buffer and iterating by stride-3 misaligns after the first vertex.
   */
  private extractWorldGeometry(mesh: THREE.Mesh): {
    positions: Float32Array;
    indices: ArrayLike<number>;
    bbox: THREE.Box3;
  } {
    const posAttr = mesh.geometry.attributes.position;
    const vertexCount = posAttr.count;
    const positions = new Float32Array(vertexCount * 3);
    const v = GeometryCache._tempVec;

    // Read vertices through BufferAttribute accessors (handles interleaved
    // layouts) and transform to world space in one pass.
    for (let i = 0; i < vertexCount; i++) {
      v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      mesh.localToWorld(v);
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
    }

    let indices: ArrayLike<number>;
    const indexAttr = mesh.geometry.getIndex();
    if (indexAttr) {
      indices = indexAttr.array;
    } else {
      const ascending: number[] = [];
      for (let i = 0; i < vertexCount; i++) {
        ascending.push(i);
      }
      indices = ascending;
    }

    const bbox = new THREE.Box3();
    for (let i = 0; i < positions.length; i += 3) {
      v.set(positions[i], positions[i + 1], positions[i + 2]);
      bbox.expandByPoint(v);
    }

    return { positions, indices, bbox };
  }

  invalidateAll(): void {
    this.bboxCache.clear();
    this.geometryCache.clear();
    this.lastFilteredIds.clear();
  }
}
