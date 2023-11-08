import { LoadingManager } from "three";
import { GLTF, GLTFLoader as ThreeGLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

class CachedGLTFLoader extends ThreeGLTFLoader {
  private blobCache: Map<string, string>;

  constructor(manager?: LoadingManager) {
    super(manager);
    this.blobCache = new Map();
  }

  setBlobUrl(originalUrl: string, blobUrl: string) {
    this.blobCache.set(originalUrl, blobUrl);
  }

  getBlobUrl(originalUrl: string): string | undefined {
    return this.blobCache.get(originalUrl);
  }

  load(
    url: string,
    onLoad: (gltf: GLTF) => void,
    onProgress?: ((event: ProgressEvent<EventTarget>) => void) | undefined,
    onError?: ((event: ErrorEvent) => void) | undefined,
  ): void {
    const blobUrl = this.getBlobUrl(url);
    const effectiveUrl = blobUrl || url;
    super.load(effectiveUrl, onLoad, onProgress, onError);
  }
}

class LRUCache<K, V> {
  private maxSize: number;
  private cache: Map<K, V>;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key: K): V | undefined {
    const item = this.cache.get(key);
    if (item) {
      this.cache.delete(key);
      this.cache.set(key, item);
    }
    return item;
  }

  set(key: K, value: V): void {
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, value);
  }
}

interface CachedModel {
  blob: Blob;
}

export class ModelLoader {
  private static instance: ModelLoader | null = null;

  private readonly loadingManager: LoadingManager;
  private readonly gltfLoader: CachedGLTFLoader;
  private modelCache: LRUCache<string, CachedModel>;
  private ongoingLoads: Map<string, Promise<GLTF | undefined>> = new Map();

  constructor(maxCacheSize: number = 100) {
    this.loadingManager = new LoadingManager();
    this.gltfLoader = new CachedGLTFLoader(this.loadingManager);
    this.modelCache = new LRUCache(maxCacheSize);
  }

  static getInstance(): ModelLoader {
    if (!ModelLoader.instance) {
      ModelLoader.instance = new ModelLoader();
    }
    return ModelLoader.instance;
  }

  async load(fileUrl: string): Promise<GLTF | undefined> {
    const cachedModel = this.modelCache.get(fileUrl);

    if (cachedModel) {
      console.log(`Loading ${fileUrl.split("/").pop()} from cache`);
      const blobURL = URL.createObjectURL(cachedModel.blob);
      this.gltfLoader.setBlobUrl(fileUrl, blobURL);
      return this.loadFromUrl(blobURL);
    } else {
      console.log(`Loading ${fileUrl} from server`);
      const ongoingLoad = this.ongoingLoads.get(fileUrl);
      if (ongoingLoad) return ongoingLoad;

      const loadPromise = fetch(fileUrl)
        .then((response) => response.blob())
        .then((blob) => {
          this.modelCache.set(fileUrl, { blob });
          const blobURL = URL.createObjectURL(blob);
          this.ongoingLoads.delete(fileUrl);
          return this.loadFromUrl(blobURL);
        });

      this.ongoingLoads.set(fileUrl, loadPromise);
      return loadPromise;
    }
  }

  private async loadFromUrl(url: string): Promise<GLTF | undefined> {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (object: GLTF) => {
          resolve(object);
        },
        undefined,
        (error) => {
          console.error(`Error loading model from ${url}: ${error}`);
          reject(error);
        },
      );
    });
  }
}
