import * as playcanvas from "playcanvas";

export class CharacterModelLoader {
  constructor(
    private playcanvasApp: playcanvas.AppBase,
    private debug: boolean = false,
  ) {}

  async load(url: string): Promise<playcanvas.Asset> {
    return new Promise<playcanvas.Asset>((resolve, reject) => {
      const asset = new playcanvas.Asset(url, "container", {
        url,
      });
      this.playcanvasApp.assets.add(asset);
      this.playcanvasApp.assets.load(asset);
      asset.ready((asset) => {
        resolve(asset);
      });
      asset.on("error", (err) => {
        reject(err);
      });
    });
  }

  // async load(fileUrl: string, fileType: "model"): Promise<playcanvas.Entity | undefined>;
  // async load(fileUrl: string, fileType: "animation"): Promise<AnimationClip | undefined>;
  // async load(
  //   fileUrl: string,
  //   fileType: "model" | "animation",
  // ): Promise<playcanvas.Entity | AnimationClip | undefined> {
  //   const cachedModel = this.modelCache.get(fileUrl);
  //
  //   if (cachedModel) {
  //     return this.loadFromUrl(fileUrl, fileType, cachedModel.originalExtension);
  //   } else {
  //     if (this.debug === true) {
  //       console.log(`Loading ${fileUrl} from server`);
  //     }
  //     const ongoingLoad = this.ongoingLoads.get(fileUrl);
  //     if (ongoingLoad)
  //       return ongoingLoad.then((loadedModel) => {
  //         const blobURL = URL.createObjectURL(loadedModel.blob);
  //         return this.loadFromUrl(blobURL, fileType, loadedModel.originalExtension);
  //       });
  //
  //     const loadPromise: Promise<CachedModel> = fetch(fileUrl)
  //       .then((response) => response.blob())
  //       .then((blob) => {
  //         const originalExtension = fileUrl.split(".").pop() || "";
  //         const cached = { blob, originalExtension };
  //         this.modelCache.set(fileUrl, cached);
  //         this.ongoingLoads.delete(fileUrl);
  //         return cached;
  //       });
  //
  //     this.ongoingLoads.set(fileUrl, loadPromise);
  //     return loadPromise.then((loadedModel) => {
  //       const blobURL = URL.createObjectURL(loadedModel.blob);
  //       return this.loadFromUrl(blobURL, fileType, loadedModel.originalExtension);
  //     });
  //   }
  // }
  //
  // private async loadFromUrl(
  //   url: string,
  //   fileType: "model" | "animation",
  //   extension: string,
  // ): Promise<Object3D | AnimationClip | undefined> {
  //   return new Promise(async (resolve, reject) => {
  //     const modelLoadResult: ModelLoadResult = await this.modelLoader.load(
  //       url,
  //       (loaded: number, total: number) => {
  //         // no-op
  //       },
  //     );
  //     if (fileType === "model") {
  //       resolve(modelLoadResult.group as Object3D);
  //     } else if (fileType === "animation") {
  //       resolve(modelLoadResult.animations[0] as AnimationClip);
  //     } else {
  //       const error = `Trying to load unknown ${fileType} type of element from file ${url}`;
  //       console.error(error);
  //       reject(error);
  //     }
  //   });
  // }
}
