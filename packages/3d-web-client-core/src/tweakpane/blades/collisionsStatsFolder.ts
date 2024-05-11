import { ButtonApi, FolderApi } from "tweakpane";

export class CollisionsStatsFolder {
  private folder: FolderApi;
  private debugButton: ButtonApi;

  constructor(parentFolder: FolderApi, expanded: boolean = true) {
    this.folder = parentFolder.addFolder({ title: "collisions", expanded: expanded });
    this.debugButton = this.folder.addButton({ title: "Toggle Debug" });
  }

  public setupChangeEvent(toggleDebug: () => void): void {
    this.debugButton.on("click", () => {
      toggleDebug();
    });
  }
}
