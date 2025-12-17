import { CollisionsManager } from "@mml-io/3d-web-client-core";
import { FolderApi } from "tweakpane";

export class CollisionsStatsFolder {
  private folder: FolderApi;
  private debugCheckbox: { enabled: boolean };

  constructor(
    parentFolder: FolderApi,
    private collisionsManager: CollisionsManager,
    expanded: boolean = true,
  ) {
    this.folder = parentFolder.addFolder({ title: "collisions", expanded: expanded });
    this.debugCheckbox = { enabled: collisionsManager.isDebugEnabled() };
  }

  public setupChangeEvent(): void {
    this.folder
      .addBinding(this.debugCheckbox, "enabled", {
        label: "Debug Geometry",
      })
      .on("change", (ev) => {
        this.collisionsManager.toggleDebug(ev.value);
      });
  }
}
