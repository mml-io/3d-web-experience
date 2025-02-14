import { Key, KeyInputManager } from "@mml-io/3d-web-client-core";
import { degToRad, EventHandlerCollection, MElement, PositionAndRotation } from "@mml-io/mml-web";
import * as THREE from "three";
import { Euler } from "three";

const mouseMovePixelsThreshold = 10;
const mouseMoveTimeThresholdMilliseconds = 500;

type ThreeJSMMLPlacerConfig = {
  clickTarget: Document | HTMLElement;
  rootContainer: THREE.Object3D;
  camera: THREE.Camera;
  keyInputManager: KeyInputManager;
  placementGhostRoot: THREE.Object3D;
  updatePosition: (
    positionAndRotation: PositionAndRotation | null,
    isClick: boolean,
    existingElement: MElement | null,
  ) => void;
  selectedEditFrame: (mElement: MElement) => void;
};

/**
 * The ThreeJSClickTrigger class is responsible for handling click events on the MML scene and raycasts into the scene to
 * determine which object was clicked and then dispatches events to those elements.
 */
export class ThreeJSMMLPlacer {
  private eventHandlerCollection: EventHandlerCollection = new EventHandlerCollection();
  private raycaster: THREE.Raycaster;
  private mouseDownTime: number | null = null;
  private mouseMoveDelta = 0;
  private rotationY: number = 0;
  private latestMousePosition: { x: number; y: number } = { x: 0, y: 0 };
  private latestWorldPositionAndRotation: PositionAndRotation | null = null;
  private editMode: boolean = false;
  private selectedFrame: MElement | null = null;

  static init(config: ThreeJSMMLPlacerConfig): ThreeJSMMLPlacer {
    return new ThreeJSMMLPlacer(config);
  }

  private constructor(private config: ThreeJSMMLPlacerConfig) {
    this.raycaster = new THREE.Raycaster();

    this.eventHandlerCollection.add(
      this.config.clickTarget,
      "mousedown",
      this.handleMouseDown.bind(this),
    );
    this.eventHandlerCollection.add(
      this.config.clickTarget,
      "mouseup",
      this.handleMouseUp.bind(this),
    );
    this.eventHandlerCollection.add(
      this.config.clickTarget,
      "mousemove",
      this.handleMouseMove.bind(this),
    );
  }

  private handleMouseDown() {
    this.mouseDownTime = Date.now();
    this.mouseMoveDelta = 0;
  }

  private handleMouseUp(event: MouseEvent) {
    if (!this.mouseDownTime) {
      return;
    }
    const duration = Date.now() - this.mouseDownTime;
    this.mouseDownTime = null;
    if (
      this.mouseMoveDelta < mouseMovePixelsThreshold &&
      duration < mouseMoveTimeThresholdMilliseconds
    ) {
      this.handleMovePlacement(event);
      if (this.editMode && !this.selectedFrame) {
        const editFrame = this.raycastToGetRootMFrame();
        if (editFrame) {
          this.selectedFrame = editFrame;
          const ryAttr = parseFloat(editFrame.getAttribute("ry") || "");
          const cameraY = this.getCameraRotationY();
          if (!isNaN(ryAttr)) {
            this.rotationY = degToRad(ryAttr) - cameraY;
          } else {
            this.rotationY = -cameraY;
          }
          this.config.selectedEditFrame(editFrame);
        }
        return;
      }
      this.update();
      if (this.latestWorldPositionAndRotation) {
        this.config.updatePosition(this.latestWorldPositionAndRotation, true, this.selectedFrame);
        this.selectedFrame = null;
        this.editMode = false;
      }
    }
  }

  private handleMouseMove(event: MouseEvent) {
    if (this.mouseDownTime) {
      this.mouseMoveDelta += Math.abs(event.movementX) + Math.abs(event.movementY);
    }
    this.handleMovePlacement(event);
  }

  private handleMovePlacement(event: MouseEvent) {
    if ((event.detail as any).element) {
      // Avoid infinite loop of handling click events that originated from this trigger
      return;
    }
    let x = 0;
    let y = 0;
    if (!document.pointerLockElement) {
      let width = window.innerWidth;
      let height = window.innerHeight;
      if (this.config.clickTarget instanceof HTMLElement) {
        width = this.config.clickTarget.offsetWidth;
        height = this.config.clickTarget.offsetHeight;
      }
      x = (event.offsetX / width) * 2 - 1;
      y = -((event.offsetY / height) * 2 - 1);
    }
    this.latestMousePosition = { x, y };
  }

  public findRootMFrameFromElement(mElement: MElement): MElement | null {
    let parent: HTMLElement | null = mElement;
    let lastFrame: MElement | null = null;
    while (parent !== null) {
      if (parent.tagName === "M-FRAME") {
        lastFrame = parent as MElement;
      }
      parent = parent.parentElement;
    }
    return lastFrame;
  }

  public raycastToGetRootMFrame(): MElement | null {
    const { x, y } = this.latestMousePosition;
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.config.camera);
    const intersections = this.raycaster.intersectObject(this.config.rootContainer, true);
    if (intersections.length > 0) {
      for (const intersection of intersections) {
        let obj: THREE.Object3D | null = intersection.object;
        while (obj) {
          /*
             Ignore scene objects that have a transparent or wireframe material
            */
          if (this.isMaterialIgnored(obj)) {
            break;
          }

          const mElement = MElement.getMElementFromObject(obj);
          if (mElement) {
            return this.findRootMFrameFromElement(mElement);
          }
          obj = obj.parent;
        }
      }
    }
    return null;
  }

  private getCameraRotationY() {
    const eulerYXZ = new Euler();
    eulerYXZ.copy(this.config.camera.rotation);
    eulerYXZ.reorder("YZX");
    return eulerYXZ.y;
  }

  public update() {
    if (this.config.keyInputManager.isKeyPressed(Key.Q)) {
      this.rotationY += 0.025;
    } else if (this.config.keyInputManager.isKeyPressed(Key.E)) {
      this.rotationY -= 0.025;
    }

    const cameraY = this.getCameraRotationY();

    const { x, y } = this.latestMousePosition;
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.config.camera);
    const intersections = this.raycaster.intersectObject(this.config.rootContainer, true);
    if (intersections.length > 0) {
      for (const intersection of intersections) {
        const obj: THREE.Object3D | null = intersection.object;
        if (
          obj &&
          !hasAncestor(obj, this.config.placementGhostRoot) &&
          !(this.selectedFrame && hasAncestor(obj, this.selectedFrame.getContainer()))
        ) {
          this.latestWorldPositionAndRotation = {
            position: intersection.point,
            rotation: {
              x: 0,
              y: this.rotationY + cameraY,
              z: 0,
            },
          };
          break;
        }
      }
    }
    this.config.updatePosition(this.latestWorldPositionAndRotation, false, null);
  }

  dispose() {
    this.eventHandlerCollection.clear();
  }

  toggleEditMode() {
    this.editMode = !this.editMode;
  }

  private isMaterialIgnored(obj: THREE.Object3D): boolean {
    const mesh = obj as THREE.Mesh;
    if (mesh) {
      if (
        ((mesh.material as THREE.Material) &&
          (mesh.material as THREE.Material).transparent &&
          (mesh.material as THREE.Material).opacity < 1) ||
        ((mesh.material as THREE.MeshLambertMaterial) &&
          (mesh.material as THREE.MeshLambertMaterial).wireframe) ||
        ((mesh.material as THREE.MeshPhongMaterial) &&
          (mesh.material as THREE.MeshPhongMaterial).wireframe) ||
        ((mesh.material as THREE.MeshPhysicalMaterial) &&
          (mesh.material as THREE.MeshPhysicalMaterial).wireframe) ||
        ((mesh.material as THREE.MeshStandardMaterial) &&
          (mesh.material as THREE.MeshStandardMaterial).wireframe) ||
        ((mesh.material as THREE.LineBasicMaterial) &&
          (mesh.material as THREE.LineBasicMaterial).isLineBasicMaterial)
      ) {
        return true;
      }
    }
    return false;
  }
}

function hasAncestor(obj: THREE.Object3D, ancestor: THREE.Object3D) {
  let parent: THREE.Object3D | null = obj;
  while (true) {
    if (parent === ancestor) {
      return true;
    }
    if (parent === null) {
      return false;
    }
    parent = parent.parent;
  }
}
