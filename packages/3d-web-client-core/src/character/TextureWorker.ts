// Import the worker as a URL using the esbuild plugin
import gltfWorkerUrl from "./gltf-texture.worker";

console.log("gltfWorkerUrl", gltfWorkerUrl);

interface GLTFWorkerRequest {
  id: string;
  type: "process-gltf";
  fileUrl: string;
  maxTextureSize: number;
}

interface GLTFWorkerResponse {
  id: string;
  type: "success" | "error";
  gltfBuffer?: ArrayBuffer;
  error?: string;
}

export class GLTFTextureWorkerPool {
  private static instance: GLTFTextureWorkerPool;
  private workers: Worker[] = [];
  private activeJobs = new Map<
    string,
    {
      resolve: (result: ArrayBuffer) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
      abortController?: AbortController;
    }
  >();
  private workerIndex = 0;
  private readonly maxWorkers = Math.min(navigator.hardwareConcurrency || 4, 2);

  static getInstance(): GLTFTextureWorkerPool {
    if (!GLTFTextureWorkerPool.instance) {
      GLTFTextureWorkerPool.instance = new GLTFTextureWorkerPool();
    }
    return GLTFTextureWorkerPool.instance;
  }

  constructor() {
    this.initializeWorkers();
  }

  private initializeWorkers(): void {
    // Create worker pool using the compiled worker URL
    for (let i = 0; i < this.maxWorkers; i++) {
      const worker = new Worker(gltfWorkerUrl);
      worker.onmessage = this.handleWorkerMessage.bind(this);
      worker.onerror = this.handleWorkerError.bind(this);
      this.workers.push(worker);
    }

    console.log(`GLTFTextureWorkerPool initialized with ${this.workers.length} workers`);
  }

  private handleWorkerMessage(e: MessageEvent<GLTFWorkerResponse>): void {
    const { id, type, gltfBuffer, error } = e.data;
    const job = this.activeJobs.get(id);

    if (!job) return;

    // Clear timeout and remove job
    clearTimeout(job.timeout);
    this.activeJobs.delete(id);

    if (type === "success" && gltfBuffer) {
      job.resolve(gltfBuffer);
    } else if (type === "error") {
      job.reject(new Error(error || "Unknown worker error"));
    }
  }

  private handleWorkerError(error: ErrorEvent): void {
    console.error("gLTF texture worker error:", error);
  }

  private getNextWorker(): Worker {
    const worker = this.workers[this.workerIndex];
    this.workerIndex = (this.workerIndex + 1) % this.workers.length;
    return worker;
  }

  public async processGLTF(
    fileUrl: string,
    maxTextureSize: number,
    abortController?: AbortController,
  ): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const id = `gltf_${Date.now()}_${Math.random()}`;
      const message: GLTFWorkerRequest = {
        id,
        type: "process-gltf",
        fileUrl,
        maxTextureSize,
      };

      // Set up timeout
      const timeout = setTimeout(() => {
        if (this.activeJobs.has(id)) {
          this.activeJobs.delete(id);
          reject(new Error("gLTF process timeout"));
        }
      }, 60000);

      // Set up cancellation handler
      let abortHandler: (() => void) | undefined;
      if (abortController) {
        if (abortController.signal.aborted) {
          // Already cancelled
          clearTimeout(timeout);
          reject(new Error("Operation cancelled"));
          return;
        }

        abortHandler = () => {
          if (this.activeJobs.has(id)) {
            clearTimeout(timeout);
            this.activeJobs.delete(id);
            reject(new Error("Operation cancelled"));
          }
        };
        abortController.signal.addEventListener("abort", abortHandler);
      }

      this.activeJobs.set(id, {
        resolve: (result: ArrayBuffer) => {
          if (abortHandler && abortController) {
            abortController.signal.removeEventListener("abort", abortHandler);
          }
          resolve(result);
        },
        reject: (error: Error) => {
          if (abortHandler && abortController) {
            abortController.signal.removeEventListener("abort", abortHandler);
          }
          reject(error);
        },
        timeout,
        abortController,
      });

      const worker = this.getNextWorker();
      worker.postMessage(message);
    });
  }

  public dispose(): void {
    // Clear active jobs and their timeouts
    for (const [id, job] of this.activeJobs) {
      clearTimeout(job.timeout);
      // Clean up abort listeners if they exist
      if (job.abortController && job.abortController.signal) {
        // Note: We can't remove specific listeners without references, but they will be cleaned up
        // when the AbortController is garbage collected
      }
      job.reject(new Error("GLTFTextureWorkerPool disposed"));
    }
    this.activeJobs.clear();

    // Terminate workers
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
  }
}

// Legacy export for backwards compatibility
export const TextureWorkerPool = GLTFTextureWorkerPool;
