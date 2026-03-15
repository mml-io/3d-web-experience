/**
 * Node.js polyfills for running Three.js in headless mode.
 *
 * Uses @napi-rs/canvas for proper Canvas/Image support rather than stubs.
 * Images are loaded as 1x1 blank pixels to avoid texture processing overhead
 * in headless mode — the bridge only needs the scene graph and geometry for
 * navigation and collision, not rendered textures.
 *
 * Usage:
 *   import { installNodePolyfills } from "...";
 *   installNodePolyfills();  // synchronous, idempotent
 */
import { Worker as NodeWorker } from "worker_threads";

import { Canvas, createCanvas, Image, ImageData, loadImage } from "@napi-rs/canvas";

// Pre-compute a 1x1 blank PNG buffer for use as placeholder texture data
const blankCanvas = createCanvas(1, 1);
const BLANK_PNG_BUFFER = blankCanvas.toBuffer("image/png");

/**
 * Create an img element proxy that loads a 1x1 blank image when src is set.
 *
 * Three.js ImageLoader creates elements via document.createElementNS, adds
 * event listeners, then sets src. This proxy fires the load event with a
 * valid @napi-rs/canvas Image to satisfy Three.js without network overhead.
 */
function createImgElement() {
  let loadCallback: ((ev: any) => void) | null = null;
  let errorCallback: ((ev: any) => void) | null = null;

  const element: Record<string, any> = {
    image: undefined as Image | undefined,
    width: 0,
    height: 0,
    crossOrigin: null as string | null,
    addEventListener(event: string, listener: (ev: any) => void) {
      if (event === "load") loadCallback = listener;
      else if (event === "error") errorCallback = listener;
    },
    removeEventListener() {},
  };

  return new Proxy(element, {
    set(target, prop, value) {
      if (prop === "src") {
        loadImage(BLANK_PNG_BUFFER)
          .then((img) => {
            target.image = img;
            target.width = img.width;
            target.height = img.height;
            if (loadCallback) loadCallback.call(target, {});
          })
          .catch((err) => {
            if (errorCallback) errorCallback.call(target, err);
          });
      } else {
        target[prop as string] = value;
      }
      return true;
    },
    get(target, prop) {
      return target[prop as string];
    },
  });
}

class StubProgressEvent {
  type: string;
  lengthComputable: boolean;
  loaded: number;
  total: number;
  constructor(
    type: string,
    init?: { lengthComputable?: boolean; loaded?: number; total?: number },
  ) {
    this.type = type;
    this.lengthComputable = init?.lengthComputable ?? false;
    this.loaded = init?.loaded ?? 0;
    this.total = init?.total ?? 0;
  }
}

const stubDocument = {
  createElement(tag: string) {
    if (tag === "canvas") return createCanvas(1, 1);
    if (tag === "img") return createImgElement();
    return { style: {} };
  },
  createElementNS(_ns: string, tag: string) {
    return this.createElement(tag);
  },
  body: {
    appendChild() {},
    removeChild() {},
  },
  timeline: {
    _startTime: Date.now(),
    get currentTime() {
      return Date.now() - this._startTime;
    },
  },
};

// ---------------------------------------------------------------------------
// Blob source tracking for Worker polyfill
// ---------------------------------------------------------------------------
const blobSources = new Map<string, string>();
let blobCounter = 0;

/**
 * Install polyfills needed by Three.js in Node.js.
 *
 * This function is synchronous and idempotent — safe to call multiple times.
 */
export function installNodePolyfills(): void {
  // Guard against double-install
  if ((globalThis as any).__nodePolyfillsInstalled) return;
  (globalThis as any).__nodePolyfillsInstalled = true;

  // -------------------------------------------------------------------------
  // DOM globals needed by Three.js (not by MML — MML uses VirtualDocument)
  // -------------------------------------------------------------------------
  if (!("document" in globalThis)) {
    (globalThis as any).document = stubDocument;
  }
  if (!("HTMLCanvasElement" in globalThis)) {
    (globalThis as any).HTMLCanvasElement = Canvas;
  }
  if (!("Image" in globalThis)) {
    (globalThis as any).Image = Image;
  }
  if (!("HTMLImageElement" in globalThis)) {
    (globalThis as any).HTMLImageElement = Image;
  }
  if (!("ImageData" in globalThis)) {
    (globalThis as any).ImageData = ImageData;
  }
  if (!("ProgressEvent" in globalThis)) {
    (globalThis as any).ProgressEvent = StubProgressEvent;
  }

  // requestAnimationFrame / cancelAnimationFrame are available in Node.js 16+
  if (!("requestAnimationFrame" in globalThis)) {
    (globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 16);
  }
  if (!("cancelAnimationFrame" in globalThis)) {
    (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
  }

  if (typeof globalThis.window === "undefined") {
    (globalThis as any).window = globalThis;
  }

  // Three.js GLTFLoader uses `self.URL` to create blob URLs for textures
  if (typeof (globalThis as any).self === "undefined") {
    (globalThis as any).self = globalThis;
  }

  // Ensure document.timeline exists
  if ((globalThis as any).document && !(globalThis as any).document.timeline) {
    const startTime = Date.now();
    (globalThis as any).document.timeline = {
      get currentTime() {
        return Date.now() - startTime;
      },
    };
  }

  // -------------------------------------------------------------------------
  // Stub AudioContext for Three.js (no audio in headless mode)
  // -------------------------------------------------------------------------
  if (typeof (globalThis as any).AudioContext === "undefined") {
    (globalThis as any).AudioContext = class AudioContextStub {
      state = "suspended";
      createGain() {
        return { connect() {}, gain: { value: 1 } };
      }
      createPanner() {
        return { connect() {}, setPosition() {} };
      }
      get destination() {
        return {};
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    };
  }

  // -------------------------------------------------------------------------
  // Wrap fetch to prevent Three.js FileLoader streaming hang.
  //
  // Node.js provides ReadableStream on response.body, which causes Three.js
  // FileLoader to enter a streaming code path that silently hangs. Masking
  // response.body forces the simpler response.arrayBuffer() / .text() fallback.
  // -------------------------------------------------------------------------
  const origFetch = globalThis.fetch;
  globalThis.fetch = function (...args: Parameters<typeof fetch>) {
    return origFetch.apply(globalThis, args).then((response: Response) => {
      return new Proxy(response, {
        get(target, prop) {
          if (prop === "body") return undefined;
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });
  };

  // -------------------------------------------------------------------------
  // Blob: extend native to track source strings for the Worker polyfill.
  // Three.js DRACOLoader creates Workers from blob URLs containing source
  // code. We capture that source to replay it via worker_threads.
  // -------------------------------------------------------------------------
  const OrigBlob = globalThis.Blob;
  (globalThis as any).Blob = class extends OrigBlob {
    _source?: string;
    constructor(parts?: any[], options?: any) {
      super(parts, options);
      if (parts?.length && typeof parts[0] === "string") {
        this._source = parts.map((p: any) => (typeof p === "string" ? p : "")).join("");
      }
    }
  };

  // URL.createObjectURL / revokeObjectURL — wrap to capture blob sources
  const MAX_BLOB_SOURCES = 1000;
  const origCreateObjectURL = (URL as any).createObjectURL as ((blob: any) => string) | undefined;
  (URL as any).createObjectURL = (blob: any) => {
    const url = origCreateObjectURL
      ? origCreateObjectURL.call(URL, blob)
      : `blob:node:${blobCounter++}`;
    if (blob._source) blobSources.set(url, blob._source);
    // Prune oldest entries when the map exceeds the size limit
    if (blobSources.size > MAX_BLOB_SOURCES) {
      const excess = blobSources.size - MAX_BLOB_SOURCES;
      const iter = blobSources.keys();
      for (let i = 0; i < excess; i++) {
        const oldest = iter.next().value;
        if (oldest !== undefined) blobSources.delete(oldest);
      }
    }
    return url;
  };
  const origRevokeObjectURL = (URL as any).revokeObjectURL as ((url: string) => void) | undefined;
  (URL as any).revokeObjectURL = (url: string) => {
    blobSources.delete(url);
    if (origRevokeObjectURL) origRevokeObjectURL.call(URL, url);
  };

  // -------------------------------------------------------------------------
  // Worker polyfill — Three.js DRACOLoader creates Web Workers from blob URLs.
  // We bridge this to Node.js worker_threads.
  // -------------------------------------------------------------------------
  if (typeof (globalThis as any).Worker === "undefined") {
    (globalThis as any).Worker = class WorkerShim {
      onmessage: ((ev: { data: any }) => void) | null = null;
      onerror: ((ev: any) => void) | null = null;
      private _w: InstanceType<typeof NodeWorker>;
      private _messageListeners: Array<(ev: any) => void> = [];
      private _errorListeners: Array<(ev: any) => void> = [];

      constructor(url: string | URL) {
        const urlStr = String(url);
        const src = blobSources.get(urlStr);
        if (src) {
          const wrapped = [
            "const { parentPort } = require('worker_threads');",
            "const self = globalThis;",
            "self.postMessage = (d, t) => parentPort.postMessage(d, t);",
            "parentPort.on('message', d => { if (globalThis.onmessage) globalThis.onmessage({ data: d }); });",
            src,
          ].join("\n");
          this._w = new NodeWorker(wrapped, { eval: true });
        } else {
          this._w = new NodeWorker(new URL(urlStr));
        }

        this._w.on("message", (d: any) => {
          const ev = { data: d };
          if (this.onmessage) this.onmessage(ev);
          for (const listener of this._messageListeners) {
            listener(ev);
          }
        });
        this._w.on("error", (e: any) => {
          if (this.onerror) this.onerror(e);
          for (const listener of this._errorListeners) {
            listener(e);
          }
        });
      }

      postMessage(data: any, transfer?: any) {
        this._w.postMessage(data, transfer);
      }
      terminate() {
        this._w.removeAllListeners();
        this._w.terminate();
      }
      addEventListener(type: string, fn: any) {
        if (type === "message") this._messageListeners.push(fn);
        if (type === "error") this._errorListeners.push(fn);
      }
      removeEventListener(type: string, fn: any) {
        if (type === "message") {
          this._messageListeners = this._messageListeners.filter((l) => l !== fn);
        }
        if (type === "error") {
          this._errorListeners = this._errorListeners.filter((l) => l !== fn);
        }
      }
    };
  }
}
