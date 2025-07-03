import { Document, WebIO, TextureInfo } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

interface WorkerRequest {
  id: string;
  type: 'process-gltf' | 'clear-cache' | 'get-cache-stats';
  fileUrl?: string;
  maxTextureSize?: number;
}

interface WorkerResponse {
  id: string;
  type: 'success' | 'error';
  gltfBuffer?: ArrayBuffer;
  cacheStats?: { totalSize: number; entryCount: number };
  error?: string;
}

interface CacheEntry {
  data: ArrayBuffer;
  lastAccessed: number;
  size: number;
  key: string;
}

interface CacheMetadata {
  totalSize: number;
  keys: string[];
}

class GLTFDiskCache {
  private readonly dbName = 'gltf-texture-cache';
  private readonly version = 1;
  private readonly storeName = 'processed-gltf';
  private readonly metadataStoreName = 'cache-metadata';
  private readonly maxCacheSize = 1 * 1024 * 1024 * 1024; // 1GB
  private readonly metadataKey = 'cache-metadata';
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create object stores
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'key' });
        }
        
        if (!db.objectStoreNames.contains(this.metadataStoreName)) {
          db.createObjectStore(this.metadataStoreName);
        }
      };
    });
  }

  private generateCacheKey(fileUrl: string, maxTextureSize: number): string {
    // Simple hash function for cache key
    const str = `${fileUrl}:${maxTextureSize}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  async get(fileUrl: string, maxTextureSize: number): Promise<ArrayBuffer | null> {
    if (!this.db) await this.init();
    
    const key = this.generateCacheKey(fileUrl, maxTextureSize);
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result as CacheEntry | undefined;
        if (result) {
          // Update last accessed time
          result.lastAccessed = Date.now();
          store.put(result);
          resolve(result.data);
        } else {
          resolve(null);
        }
      };
    });
  }

  async set(fileUrl: string, maxTextureSize: number, data: ArrayBuffer): Promise<void> {
    if (!this.db) await this.init();
    
    const key = this.generateCacheKey(fileUrl, maxTextureSize);
    const size = data.byteLength;
    const entry: CacheEntry = {
      key,
      data,
      lastAccessed: Date.now(),
      size
    };
    
    // Check if we need to evict items
    await this.evictIfNeeded(size);
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName, this.metadataStoreName], 'readwrite');
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      
      const store = transaction.objectStore(this.storeName);
      const metadataStore = transaction.objectStore(this.metadataStoreName);
      
      // Add/update the entry
      store.put(entry);
      
      // Update metadata
      const metadataRequest = metadataStore.get(this.metadataKey);
      metadataRequest.onsuccess = () => {
        const metadata: CacheMetadata = metadataRequest.result || { totalSize: 0, keys: [] };
        
        // Check if entry already exists and get its size
        const existingIndex = metadata.keys.indexOf(key);
        let existingSize = 0;
        
        if (existingIndex !== -1) {
          // Get the existing entry to calculate its size
          const existingEntryRequest = store.get(key);
          existingEntryRequest.onsuccess = () => {
            const existingEntry = existingEntryRequest.result as CacheEntry | undefined;
            if (existingEntry) {
              existingSize = existingEntry.size;
            }
            
            // Update metadata
            if (existingIndex !== -1) {
              metadata.keys.splice(existingIndex, 1);
              metadata.totalSize -= existingSize;
            }
            
            // Add new entry
            metadata.keys.push(key);
            metadata.totalSize += size;
            
            metadataStore.put(metadata, this.metadataKey);
          };
        } else {
          // New entry
          metadata.keys.push(key);
          metadata.totalSize += size;
          
          metadataStore.put(metadata, this.metadataKey);
        }
      };
    });
  }

  private async evictIfNeeded(newItemSize: number): Promise<void> {
    if (!this.db) return;
    
    const metadata = await this.getMetadata();
    if (metadata.totalSize + newItemSize <= this.maxCacheSize) {
      return;
    }
    
    // Get all entries sorted by last accessed time
    const entries = await this.getAllEntries();
    entries.sort((a, b) => a.lastAccessed - b.lastAccessed);
    
    let currentSize = metadata.totalSize;
    const keysToRemove: string[] = [];
    
    // Remove least recently used items until we have enough space
    for (const entry of entries) {
      if (currentSize + newItemSize <= this.maxCacheSize) {
        break;
      }
      
      keysToRemove.push(entry.key);
      currentSize -= entry.size;
    }
    
    // Remove the entries
    if (keysToRemove.length > 0) {
      await this.removeEntries(keysToRemove);
    }
  }

  private async getMetadata(): Promise<CacheMetadata> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.metadataStoreName], 'readonly');
      const store = transaction.objectStore(this.metadataStoreName);
      const request = store.get(this.metadataKey);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        resolve(request.result || { totalSize: 0, keys: [] });
      };
    });
  }

  private async getAllEntries(): Promise<CacheEntry[]> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  private async removeEntries(keysToRemove: string[]): Promise<void> {
    if (!this.db) return;
    
    // Get the entries to calculate their total size
    const entriesToRemove = await this.getAllEntries();
    const entryMap = new Map(entriesToRemove.map(entry => [entry.key, entry]));
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName, this.metadataStoreName], 'readwrite');
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      
      const store = transaction.objectStore(this.storeName);
      const metadataStore = transaction.objectStore(this.metadataStoreName);
      
      // Remove entries
      for (const key of keysToRemove) {
        store.delete(key);
      }
      
      // Update metadata
      const metadataRequest = metadataStore.get(this.metadataKey);
      metadataRequest.onsuccess = () => {
        const metadata: CacheMetadata = metadataRequest.result || { totalSize: 0, keys: [] };
        
        // Calculate removed size and remove keys
        let removedSize = 0;
        for (const key of keysToRemove) {
          const index = metadata.keys.indexOf(key);
          if (index !== -1) {
            metadata.keys.splice(index, 1);
          }
          
          const entry = entryMap.get(key);
          if (entry) {
            removedSize += entry.size;
          }
        }
        
        metadata.totalSize = Math.max(0, metadata.totalSize - removedSize);
        metadataStore.put(metadata, this.metadataKey);
      };
    });
  }

  async clear(): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName, this.metadataStoreName], 'readwrite');
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      
      const store = transaction.objectStore(this.storeName);
      const metadataStore = transaction.objectStore(this.metadataStoreName);
      
      store.clear();
      metadataStore.clear();
    });
  }

  async getCacheStats(): Promise<{ totalSize: number; entryCount: number }> {
    if (!this.db) await this.init();
    
    const metadata = await this.getMetadata();
    return {
      totalSize: metadata.totalSize,
      entryCount: metadata.keys.length
    };
  }
}

class GLTFTextureProcessor {
  private io: WebIO;
  private sourceCanvas: OffscreenCanvas;
  private sourceCtx: OffscreenCanvasRenderingContext2D;
  private targetCanvas: OffscreenCanvas;
  private targetCtx: OffscreenCanvasRenderingContext2D;
  private cache: GLTFDiskCache;

  constructor() {
    this.io = new WebIO().registerExtensions(ALL_EXTENSIONS);
    this.cache = new GLTFDiskCache();
    
    // Initialize reusable canvases
    this.sourceCanvas = new OffscreenCanvas(1, 1);
    this.targetCanvas = new OffscreenCanvas(1, 1);
    
    const sourceCtx = this.sourceCanvas.getContext('2d');
    const targetCtx = this.targetCanvas.getContext('2d');
    
    if (!sourceCtx || !targetCtx) {
      throw new Error('Could not get 2D contexts');
    }
    
    this.sourceCtx = sourceCtx;
    this.targetCtx = targetCtx;
  }

  private resizeImageData(
    imageData: ImageData,
    maxSize: number
  ): { data: ImageData; width: number; height: number } {
    const { width: originalWidth, height: originalHeight } = imageData;
    
    // Check if resize is needed
    if (originalWidth <= maxSize && originalHeight <= maxSize) {
      return { data: imageData, width: originalWidth, height: originalHeight };
    }

    // Calculate new dimensions maintaining aspect ratio
    const aspectRatio = originalWidth / originalHeight;
    let newWidth = originalWidth;
    let newHeight = originalHeight;

    if (originalWidth > maxSize) {
      newWidth = maxSize;
      newHeight = Math.round(newWidth / aspectRatio);
    }
    if (newHeight > maxSize) {
      newHeight = maxSize;
      newWidth = Math.round(newHeight * aspectRatio);
    }

    // Resize canvases if needed
    if (this.sourceCanvas.width !== originalWidth || this.sourceCanvas.height !== originalHeight) {
      this.sourceCanvas.width = originalWidth;
      this.sourceCanvas.height = originalHeight;
    }
    
    if (this.targetCanvas.width !== newWidth || this.targetCanvas.height !== newHeight) {
      this.targetCanvas.width = newWidth;
      this.targetCanvas.height = newHeight;
    }

    // Put original data and resize
    this.sourceCtx.putImageData(imageData, 0, 0);
    this.targetCtx.drawImage(this.sourceCanvas, 0, 0, newWidth, newHeight);

    const resizedImageData = this.targetCtx.getImageData(0, 0, newWidth, newHeight);
    return { data: resizedImageData, width: newWidth, height: newHeight };
  }

  private async processTexture(
    texture: any,
    maxSize: number
  ): Promise<void> {
    const image = texture.getImage();
    if (!image) return;

    try {
      // Create ImageBitmap from the image buffer
      const blob = new Blob([image], { type: texture.getMimeType() });
      const imageBitmap = await createImageBitmap(blob);

      // Extract ImageData
      const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(imageBitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, imageBitmap.width, imageBitmap.height);
      
      // Resize if needed
      const resized = this.resizeImageData(imageData, maxSize);
      
      if (resized.width !== imageBitmap.width || resized.height !== imageBitmap.height) {
        // Convert back to buffer
        const outputCanvas = new OffscreenCanvas(resized.width, resized.height);
        const outputCtx = outputCanvas.getContext('2d');
        if (!outputCtx) return;

        outputCtx.putImageData(resized.data, 0, 0);
        
        // Convert to blob and then to array buffer
        const outputBlob = await outputCanvas.convertToBlob({ type: 'image/png' });
        const outputBuffer = await outputBlob.arrayBuffer();
        
        // Update the texture
        texture.setImage(new Uint8Array(outputBuffer)).setMimeType('image/png');
      }

      imageBitmap.close();
    } catch (error) {
      console.warn('Failed to process texture:', error);
    }
  }

  async processGLTF(fileUrl: string, maxTextureSize: number): Promise<ArrayBuffer> {
    console.time("processGLTF - " + fileUrl);
    
    // Try to get from cache first
    console.time("cache lookup - " + fileUrl);
    try {
      const cachedResult = await this.cache.get(fileUrl, maxTextureSize);
      if (cachedResult) {
        console.timeEnd("cache lookup - " + fileUrl);
        console.timeEnd("processGLTF - " + fileUrl);
        console.log("Cache hit for:", fileUrl);
        return cachedResult;
      }
    } catch (error) {
      console.warn("Cache lookup failed:", error);
    }
    console.timeEnd("cache lookup - " + fileUrl);
    
    console.log("Cache miss for:", fileUrl);
    
    // Fetch the gLTF file
    console.time("fetch gLTF file - " + fileUrl);
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch gLTF file: ${response.statusText}`);
    }
    console.timeEnd("fetch gLTF file - " + fileUrl);

    console.time("convert to array buffer - " + fileUrl);
    const buffer = await response.arrayBuffer();
    console.timeEnd("convert to array buffer - " + fileUrl);
    
    // Parse the document
    console.time("parse document - " + fileUrl);
    const document = await this.io.readBinary(new Uint8Array(buffer));
    console.timeEnd("parse document - " + fileUrl);
    
    // Process all textures in the document
    console.time("list textures - " + fileUrl);
    const textures = document.getRoot().listTextures();
    console.timeEnd("list textures - " + fileUrl);
    
    console.time("process textures - " + fileUrl);
    for (const texture of textures) {
      await this.processTexture(texture, maxTextureSize);
    }
    console.timeEnd("process textures - " + fileUrl);

    console.time("write binary - " + fileUrl);
    const result = await this.io.writeBinary(document);
    console.timeEnd("write binary - " + fileUrl);
    
    // Cache the result
    console.time("cache store - " + fileUrl);
    try {
      await this.cache.set(fileUrl, maxTextureSize, result);
    } catch (error) {
      console.warn("Failed to cache result:", error);
    }
    console.timeEnd("cache store - " + fileUrl);
    
    console.timeEnd("processGLTF - " + fileUrl);
    return result;
  }

  async clearCache(): Promise<void> {
    return this.cache.clear();
  }

  async getCacheStats(): Promise<{ totalSize: number; entryCount: number }> {
    return this.cache.getCacheStats();
  }
}

// Worker concurrency manager
class WorkerConcurrencyManager {
  private readonly maxConcurrentRequests = 2;
  private activeRequests = 0;
  private requestQueue: Array<() => Promise<void>> = [];

  async enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.activeRequests--;
          this.processQueue();
        }
      };

      this.requestQueue.push(wrappedTask);
      this.processQueue();
    });
  }

  private processQueue(): void {
    while (this.activeRequests < this.maxConcurrentRequests && this.requestQueue.length > 0) {
      const task = this.requestQueue.shift()!;
      this.activeRequests++;
      task().catch(() => {
        // Error handling is done in the wrappedTask
      });
    }
  }

  getStats(): { active: number; queued: number; maxConcurrent: number } {
    return {
      active: this.activeRequests,
      queued: this.requestQueue.length,
      maxConcurrent: this.maxConcurrentRequests
    };
  }
}

// Worker message handler
const processor = new GLTFTextureProcessor();
const concurrencyManager = new WorkerConcurrencyManager();

self.onmessage = async function(e: MessageEvent<WorkerRequest>) {
  const { id, type, fileUrl, maxTextureSize } = e.data;

  try {
    if (type === 'process-gltf') {
      if (!fileUrl || maxTextureSize === undefined) {
        throw new Error('fileUrl and maxTextureSize are required for process-gltf');
      }
      
      // Queue the request to respect concurrency limit
      const gltfBuffer = await concurrencyManager.enqueue(async () => {
        return processor.processGLTF(fileUrl, maxTextureSize);
      });
      
      const response: WorkerResponse = {
        id,
        type: 'success',
        gltfBuffer
      };
      
      self.postMessage(response);
    } else if (type === 'clear-cache') {
      await processor.clearCache();
      
      const response: WorkerResponse = {
        id,
        type: 'success'
      };
      
      self.postMessage(response);
    } else if (type === 'get-cache-stats') {
      const cacheStats = await processor.getCacheStats();
      
      const response: WorkerResponse = {
        id,
        type: 'success',
        cacheStats
      };
      
      self.postMessage(response);
    }
  } catch (error) {
    const response: WorkerResponse = {
      id,
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    
    self.postMessage(response);
  }
}; 