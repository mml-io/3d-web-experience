import * as playcanvas from "playcanvas";
import { FolderApi } from "tweakpane";

import { TimeManager } from "../../time/TimeManager";

type StatsData = {
  triangles: string;
  materials: string;
  shaders: string;
  drawCalls: string;
  rawDeltaTime: string;
  deltaTime: string;
  FPS: string;
};

export class RendererStatsFolder {
  private folder: FolderApi;

  private statsData: StatsData = {
    triangles: "0",
    materials: "0",
    shaders: "0",
    drawCalls: "0",
    rawDeltaTime: "0",
    deltaTime: "0",
    FPS: "0",
  };

  constructor(parentFolder: FolderApi, expanded: boolean = true) {
    this.folder = parentFolder.addFolder({ title: "renderStats", expanded: expanded });
    this.folder.addBinding(this.statsData, "FPS", { readonly: true });
    this.folder.addBinding(this.statsData, "deltaTime", { readonly: true });
    this.folder.addBinding(this.statsData, "rawDeltaTime", { readonly: true });
    this.folder.addBinding(this.statsData, "triangles", { readonly: true });
    this.folder.addBinding(this.statsData, "materials", { readonly: true });
    this.folder.addBinding(this.statsData, "shaders", { readonly: true });
    this.folder.addBinding(this.statsData, "drawCalls", { readonly: true });
  }

  public update(renderer: playcanvas.AppBase, timeManager: TimeManager): void {
    const { triangles, materials } = renderer.stats.frame;
    const { drawCalls } = renderer.stats;
    this.statsData.triangles = triangles.toString();
    this.statsData.materials = materials.toString();
    this.statsData.shaders = renderer.stats.shaders.materialShaders.toString();
    this.statsData.drawCalls = drawCalls.toString();
    this.statsData.rawDeltaTime = (
      Math.round(timeManager.rawDeltaTime * 100000) / 100000
    ).toString();
    this.statsData.deltaTime = (Math.round(timeManager.deltaTime * 100000) / 100000).toString();
    this.statsData.FPS = timeManager.fps.toString();
  }
}
