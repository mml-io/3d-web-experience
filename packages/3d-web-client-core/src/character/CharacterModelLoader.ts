import { ModelLoader, ModelLoadResult } from "@mml-io/model-loader";
import { AnimationClip, Object3D } from "three";

import { GLTFTextureWorkerPool } from "./TextureWorker";

export class CharacterModelLoader {
  private readonly modelLoader: ModelLoader = new ModelLoader();
  private workerPool: GLTFTextureWorkerPool;

  constructor(
    private debug: boolean = false,
    private maxTextureSize: number = 128,
  ) {
    this.maxTextureSize = maxTextureSize;
    this.workerPool = GLTFTextureWorkerPool.getInstance();
  }

  public setMaxTextureSize(size: number): void {
    this.maxTextureSize = Math.max(64, Math.min(4096, size));
    if (this.debug) {
      console.log(`CharacterModelLoader max texture size set to ${this.maxTextureSize}`);
    }
  }

  async load(
    fileUrl: string,
    fileType: "model",
    abortController?: AbortController,
  ): Promise<Object3D | undefined>;
  async load(
    fileUrl: string,
    fileType: "animation",
    abortController?: AbortController,
  ): Promise<AnimationClip | undefined>;
  async load(
    fileUrl: string,
    fileType: "model" | "animation",
    abortController?: AbortController,
  ): Promise<Object3D | AnimationClip | undefined> {
    if (this.debug) {
      console.log(`Loading and processing ${fileUrl} with max texture size ${this.maxTextureSize}`);
    }

    try {
      // Process gLTF in worker (includes fetch + texture processing)
      const processedBuffer = await this.processGLTFInWorker(fileUrl, abortController);

      // Create temporary blob URL for ModelLoader
      const blob = new Blob([processedBuffer], { type: "model/gltf-binary" });
      const blobURL = URL.createObjectURL(blob);

      try {
        // Load using temporary blob URL
        const result = await this.loadFromBlobUrl(blobURL, fileType);
        return result;
      } finally {
        // CRITICAL: Always revoke blob URL to prevent memory leaks
        URL.revokeObjectURL(blobURL);
      }
    } catch (error) {
      // Check if the error is due to cancellation
      if (abortController?.signal.aborted) {
        console.log(`Loading cancelled for ${fileUrl}`);
        return undefined;
      }
      console.error(`Error loading ${fileType} from ${fileUrl}:`, error);
      throw error;
    }
  }

  private async processGLTFInWorker(
    fileUrl: string,
    abortController?: AbortController,
  ): Promise<ArrayBuffer> {
    if (this.debug) {
      console.log(`Processing gLTF in worker: ${fileUrl}`);
    }

    const startTime = performance.now();

    try {
      const processedBuffer = await this.workerPool.processGLTF(
        fileUrl,
        this.maxTextureSize,
        abortController,
      );
      const endTime = performance.now();

      if (this.debug) {
        console.log(`gLTF processing completed in ${(endTime - startTime).toFixed(2)}ms`);
      }

      return processedBuffer;
    } catch (error) {
      if (this.debug) {
        console.warn(
          `Worker processing failed for ${fileUrl}, falling back to regular loading:`,
          error,
        );
      }

      // Check if cancellation was requested
      if (abortController?.signal.aborted) {
        throw new Error("Operation cancelled");
      }

      // Fallback to regular loading if worker fails
      const response = await fetch(fileUrl, {
        signal: abortController?.signal,
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${fileUrl}: ${response.statusText}`);
      }

      return await response.arrayBuffer();
    }
  }

  private async loadFromBuffer(
    arrayBuffer: ArrayBuffer,
    fileType: "model" | "animation" = "model",
  ): Promise<Object3D | AnimationClip | undefined> {
    const modelLoadResult: ModelLoadResult = await this.modelLoader.loadFromBuffer(arrayBuffer);

    if (fileType === "model") {
      const model = modelLoadResult.group as Object3D;

      if (this.debug) {
        console.log(`Model loaded successfully from blob URL`);
      }

      return model;
    } else if (fileType === "animation") {
      return modelLoadResult.animations[0] as AnimationClip;
    } else {
      const error = `Trying to load unknown ${fileType} type of element`;
      console.error(error);
      throw new Error(error);
    }
  }
}
