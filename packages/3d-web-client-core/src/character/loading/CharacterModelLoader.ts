import { ModelLoader, ModelLoadResult } from "@mml-io/model-loader";
import { AnimationClip, Object3D } from "three";

import { GLTFLoadingWorkerPool } from "./GLTFLoadingWorkerPool";

export class CharacterModelLoader {
  private readonly modelLoader: ModelLoader = new ModelLoader();
  private workerPool: GLTFLoadingWorkerPool;

  constructor(
    private debug: boolean = false,
    private maxTextureSize: number = 128,
  ) {
    this.maxTextureSize = maxTextureSize;
    this.workerPool = new GLTFLoadingWorkerPool();
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
      const processedBuffer = await this.processGLTFInWorker(fileUrl, abortController);
      return await this.loadFromBuffer(processedBuffer, fileUrl, fileType);
    } catch (error) {
      // Check if the error is due to cancellation
      if (abortController?.signal.aborted) {
        console.log(`Loading canceled for ${fileUrl}`);
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
      const absoluteFileUrl = new URL(fileUrl, window.location.href).href;
      const processedBuffer = await this.workerPool.processGLTF(
        absoluteFileUrl,
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
        throw new Error("Operation canceled");
      }

      throw error;
    }
  }

  private async loadFromBuffer(
    buffer: ArrayBuffer,
    pathName: string,
    fileType: "model" | "animation" = "model",
  ): Promise<Object3D | AnimationClip | undefined> {
    const modelLoadResult: ModelLoadResult = await this.modelLoader.loadFromBuffer(
      buffer,
      pathName,
    );

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
