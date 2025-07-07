export class GLTFLoadingWorkerBrowserCache {
  private readonly cacheName = "gltf-processed-v1";
  private cache: Cache | null = null;

  async init(): Promise<void> {
    try {
      this.cache = await caches.open(this.cacheName);
    } catch (error) {
      console.warn("Cache API not available, cache will be disabled:", error);
    }
  }

  private generateCacheKey(fileUrl: string, maxTextureSize: number): string {
    // Create a unique URL that includes the processing parameters
    return `${fileUrl}?processed=true&maxTextureSize=${maxTextureSize}`;
  }

  async get(fileUrl: string, maxTextureSize: number): Promise<ArrayBuffer | null> {
    if (fileUrl.startsWith("data:")) {
      return null;
    }

    if (!this.cache) {
      console.warn("Cache not initialized");
      return null;
    }

    try {
      const cacheKey = this.generateCacheKey(fileUrl, maxTextureSize);
      const cachedResponse = await this.cache.match(cacheKey);
      
      if (cachedResponse) {
        return await cachedResponse.arrayBuffer();
      }
    } catch (error) {
      console.warn("Cache lookup failed:", error);
    }
    
    return null;
  }

  async set(fileUrl: string, maxTextureSize: number, data: ArrayBuffer): Promise<void> {
    if (fileUrl.startsWith("data:")) {
      return;
    }

    if (!this.cache) {
      return;
    }

    try {
      const cacheKey = this.generateCacheKey(fileUrl, maxTextureSize);
      const response = new Response(data, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'max-age=31536000', // 1 year
        }
      });
      
      await this.cache.put(cacheKey, response);
    } catch (error) {
      console.warn("Failed to cache processed GLTF:", error);
    }
  }

  // Method to manually clean up old entries if needed
  async cleanupOldEntries(maxAge: number = 30 * 24 * 60 * 60 * 1000): Promise<void> {
    if (!this.cache) {
      return;
    }

    try {
      const keys = await this.cache.keys();
      const now = Date.now();
      
      for (const request of keys) {
        const response = await this.cache.match(request);
        if (response) {
          const dateHeader = response.headers.get('date');
          if (dateHeader) {
            const responseDate = new Date(dateHeader).getTime();
            if (now - responseDate > maxAge) {
              await this.cache.delete(request);
            }
          }
        }
      }
    } catch (error) {
      console.warn("Failed to cleanup old cache entries:", error);
    }
  }
} 