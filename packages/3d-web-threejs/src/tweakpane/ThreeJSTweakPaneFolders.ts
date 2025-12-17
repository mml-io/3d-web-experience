import { CollisionsManager } from "@mml-io/3d-web-client-core";
import { ThreeJSMemoryInspector } from "@mml-io/mml-web-threejs";
import { Scene, WebGLRenderer } from "three";
import { FolderApi, Pane } from "tweakpane";

import { Composer } from "../composer";
import { PostProcessingManager } from "../post-effects/PostProcessingManager";

import { CollisionsStatsFolder } from "./blades/collisionsStatsFolder";
import { BrightnessContrastSaturationFolder } from "./blades/effects/bcsFolder";
import { BloomAndGrainFolder } from "./blades/effects/bloomAndGrain";
import { SSAOFolder } from "./blades/effects/ssaoFolder";
import { ToneMappingFolder } from "./blades/effects/toneMappingFolder";
import { EnvironmentFolder } from "./blades/environmentFolder";
import { PostProcessingFolder } from "./blades/postProcessingFolder";
import { RendererFolder } from "./blades/rendererFolder";
import { RendererStatsFolder } from "./blades/rendererStatsFolder";

export class ThreeJSTweakPaneFolders {
  private renderStatsFolder!: RendererStatsFolder;
  private rendererFolder!: RendererFolder;
  private postProcessingFolder!: PostProcessingFolder;
  private postProcessingSettingsFolder!: FolderApi;
  private toneMappingFolder!: ToneMappingFolder;
  private ssaoFolder!: SSAOFolder;
  private bcsFolder!: BrightnessContrastSaturationFolder;
  private bloomAndGrainFolder!: BloomAndGrainFolder;
  private environment!: EnvironmentFolder;
  private collisionsStatsFolder!: CollisionsStatsFolder;
  private memoryInspector!: FolderApi;

  private frameStartTime: number = 0;
  private lastFrameRenderTime: number = 0;

  constructor(
    private renderer: WebGLRenderer,
    private scene: Scene,
    private composer: Composer,
    private collisionsManager: CollisionsManager,
    private postProcessingEnabled: boolean | undefined,
  ) {}

  public registerFolders(pane: Pane): void {
    const postProcessingManager = (this.composer as any).postProcessingManager;

    this.renderStatsFolder = new RendererStatsFolder(pane, true);
    this.collisionsStatsFolder = new CollisionsStatsFolder(pane, this.collisionsManager, false);
    this.rendererFolder = new RendererFolder(pane, this.composer.rendererValues, false);
    this.environment = new EnvironmentFolder(
      pane,
      this.composer.sunValues,
      this.composer.envValues,
      false,
    );

    this.postProcessingFolder = new PostProcessingFolder(
      pane,
      postProcessingManager.postProcessingGlobalValues,
      this.postProcessingEnabled,
      false,
    );
    this.postProcessingSettingsFolder = pane.addFolder({
      title: "postProcessingSettings",
      expanded: false,
    });
    this.toneMappingFolder = new ToneMappingFolder(
      this.postProcessingSettingsFolder,
      postProcessingManager.toneMappingValues,
      false,
    );
    this.ssaoFolder = new SSAOFolder(
      this.postProcessingSettingsFolder,
      postProcessingManager.n8ssaoValues,
      false,
    );
    this.bcsFolder = new BrightnessContrastSaturationFolder(
      this.postProcessingSettingsFolder,
      postProcessingManager.bcsValues,
      false,
    );
    this.bloomAndGrainFolder = new BloomAndGrainFolder(
      this.postProcessingSettingsFolder,
      postProcessingManager.bloomAndGrainValues,
      false,
    );

    this.toneMappingFolder.folder.hidden =
      this.composer.rendererValues.toneMapping === 5 ? false : true;

    this.memoryInspector = pane.addFolder({ title: "memory inspector", expanded: false });
    const memoryInspectorButton = this.memoryInspector.addButton({ title: "open memory report" });
    memoryInspectorButton.on("click", () => {
      ThreeJSMemoryInspector.openMemoryReport(this.scene);
    });
  }

  public setupChangeHandlers(): void {
    const postProcessingManager = (this.composer as any)
      .postProcessingManager as PostProcessingManager;
    const hasLighting = (this.composer as any).spawnSun;

    this.collisionsStatsFolder.setupChangeEvent();

    this.rendererFolder.setupChangeEvent(
      this.renderer,
      this.toneMappingFolder.folder,
      postProcessingManager.toneMappingPassInstance,
    );

    this.toneMappingFolder.setupChangeEvent(postProcessingManager.toneMappingEffectInstance);
    this.ssaoFolder.setupChangeEvent(
      postProcessingManager.effectComposer,
      postProcessingManager.n8ssaoPass,
    );
    this.bcsFolder.setupChangeEvent(postProcessingManager.bcsInstance);
    this.bloomAndGrainFolder.setupChangeEvent(
      postProcessingManager.bloomEffectInstance,
      postProcessingManager.gaussGrainEffectInstance,
    );

    this.environment.setupChangeEvent(
      this.scene,
      () => {
        this.composer.updateSkyboxRotation();
        this.composer.setAmbientLight();
        this.composer.setFog();
        this.composer.updateSkyShaderValues();
        this.composer.updateSun();
      },
      () => this.composer.setHDRIFromFile(),
    );
    this.environment.folder.hidden = hasLighting === false;

    this.postProcessingFolder.setupChangeEvent(postProcessingManager);
  }

  public startFrameTiming(): void {
    this.frameStartTime = performance.now();
  }

  public endFrameTiming(): void {
    if (this.frameStartTime > 0) {
      this.lastFrameRenderTime = performance.now() - this.frameStartTime;
    }
  }

  public update(deltaTimeSeconds: number, frameRenderTimeMs: number): void {
    const postProcessingManager = (this.composer as any)
      .postProcessingManager as PostProcessingManager;

    if (postProcessingManager?.effectComposer) {
      this.renderStatsFolder.update(
        this.renderer,
        postProcessingManager.effectComposer,
        deltaTimeSeconds,
        frameRenderTimeMs,
      );
    }

    if (this.postProcessingFolder.isBenchmarkRunning()) {
      this.postProcessingFolder.recordFrameTime();
    }
  }
}
