import { EffectComposer } from "postprocessing";
import { WebGLRenderer } from "three";
import { FolderApi } from "tweakpane";

type StatsData = {
  triangles: string;
  geometries: string;
  textures: string;
  shaders: string;
  postPasses: string;
  drawCalls: string;
  frameTime: string;
  deltaTime: string;
  FPS: string;
};

export class RendererStatsFolder {
  private folder: FolderApi;

  private statsData: StatsData = {
    triangles: "0",
    geometries: "0",
    textures: "0",
    shaders: "0",
    postPasses: "0",
    drawCalls: "0",
    frameTime: "0",
    deltaTime: "0",
    FPS: "0",
  };

  constructor(parentFolder: FolderApi, expanded: boolean = true) {
    this.folder = parentFolder.addFolder({ title: "renderStats", expanded: expanded });
    this.folder.addBinding(this.statsData, "FPS", { readonly: true });
    this.folder.addBinding(this.statsData, "frameTime", {
      readonly: true,
      label: "frame time (ms)",
    });
    this.folder.addBinding(this.statsData, "deltaTime", { readonly: true });
    this.folder.addBinding(this.statsData, "triangles", { readonly: true });
    this.folder.addBinding(this.statsData, "geometries", { readonly: true });
    this.folder.addBinding(this.statsData, "textures", { readonly: true });
    this.folder.addBinding(this.statsData, "shaders", { readonly: true });
    this.folder.addBinding(this.statsData, "postPasses", { readonly: true });
    this.folder.addBinding(this.statsData, "drawCalls", { readonly: true });
  }

  public update(
    renderer: WebGLRenderer,
    composer: EffectComposer,
    deltaTimeSeconds: number,
    frameRenderTimeMs: number,
  ): void {
    const { geometries, textures } = renderer.info.memory;
    const { triangles, calls } = renderer.info.render;
    this.statsData.triangles = triangles.toString();
    this.statsData.geometries = geometries.toString();
    this.statsData.textures = textures.toString();
    this.statsData.shaders = renderer.info.programs!.length.toString();
    const passesMinusRender = composer.passes.length - 1;
    this.statsData.postPasses = passesMinusRender.toString();
    this.statsData.drawCalls = calls.toString();
    this.statsData.frameTime = frameRenderTimeMs.toFixed(2) + "ms";
    this.statsData.deltaTime = (deltaTimeSeconds * 1000).toFixed(2) + "ms";
    this.statsData.FPS = (1 / deltaTimeSeconds).toFixed(2);
  }
}
