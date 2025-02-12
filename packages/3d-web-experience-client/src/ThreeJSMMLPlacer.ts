import {
  EventHandlerCollection,
  getRelativePositionAndRotationRelativeToObject,
  MElement,
  TransformableElement,
} from "@mml-io/mml-web";
import * as THREE from "three";

const mouseMovePixelsThreshold = 10;
const mouseMoveTimeThresholdMilliseconds = 500;

/**
 * The ThreeJSClickTrigger class is responsible for handling click events on the MML scene and raycasts into the scene to
 * determine which object was clicked and then dispatches events to those elements.
 */
export class ThreeJSMMLPlacer {
  private eventHandlerCollection: EventHandlerCollection = new EventHandlerCollection();
  private raycaster: THREE.Raycaster;
  private mouseDownTime: number | null = null;
  private mouseMoveDelta = 0;

  static init(
    clickTarget: Document | HTMLElement,
    rootContainer: THREE.Object3D,
    camera: THREE.Camera,
    updatePosition: (vec: THREE.Vector3, isClick: boolean) => void,
  ): ThreeJSMMLPlacer {
    return new ThreeJSMMLPlacer(clickTarget, rootContainer, camera, updatePosition);
  }

  private constructor(
    private clickTarget: Document | HTMLElement,
    private rootContainer: THREE.Object3D,
    private camera: THREE.Camera,
    private updatePosition: (vec: THREE.Vector3, isClick: boolean) => void,
  ) {
    this.raycaster = new THREE.Raycaster();

    this.eventHandlerCollection.add(clickTarget, "mousedown", this.handleMouseDown.bind(this));
    this.eventHandlerCollection.add(clickTarget, "mouseup", this.handleMouseUp.bind(this));
    this.eventHandlerCollection.add(clickTarget, "mousemove", this.handleMouseMove.bind(this));
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
      this.handleClick(event, true);
    }
  }

  private handleMouseMove(event: MouseEvent) {
    if (this.mouseDownTime) {
      this.mouseMoveDelta += Math.abs(event.movementX) + Math.abs(event.movementY);
    }
    this.handleClick(event, false);
  }

  private handleClick(event: MouseEvent, isClick: boolean) {
    if ((event.detail as any).element) {
      // Avoid infinite loop of handling click events that originated from this trigger
      return;
    }
    let x = 0;
    let y = 0;
    if (!document.pointerLockElement) {
      let width = window.innerWidth;
      let height = window.innerHeight;
      if (this.clickTarget instanceof HTMLElement) {
        width = this.clickTarget.offsetWidth;
        height = this.clickTarget.offsetHeight;
      }
      x = (event.offsetX / width) * 2 - 1;
      y = -((event.offsetY / height) * 2 - 1);
    }
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const intersections = this.raycaster.intersectObject(this.rootContainer, true);
    if (intersections.length > 0) {
      for (const intersection of intersections) {
        const obj: THREE.Object3D | null = intersection.object;
        if (obj) {
          this.updatePosition(intersection.point, isClick);
          return;
        }
      }
    }
  }

  dispose() {
    this.eventHandlerCollection.clear();
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
