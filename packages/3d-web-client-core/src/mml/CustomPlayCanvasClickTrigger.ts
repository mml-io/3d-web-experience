import {
  EventHandlerCollection,
  getRelativePositionAndRotationRelativeToObject,
  MElement,
  TransformableElement,
} from "@mml-io/mml-web";
import * as playcanvas from "playcanvas";

import { CollisionsManager } from "../collisions/CollisionsManager";
import { Ray } from "../math";

const mouseMovePixelsThreshold = 10;
const mouseMoveTimeThresholdMilliseconds = 500;

/**
 * The CustomPlayCanvasClickTrigger class is responsible for handling click events on the MML scene and raycasts into the scene to
 * determine which object was clicked and then dispatches events to those elements.
 *
 * It differs from the PlayCanvasClickTrigger class in the MML library in that is uses the CollisionManager to perform
 * raycasts rather than the PlayCanvas rigidbody system.
 */
export class CustomPlayCanvasClickTrigger {
  private eventHandlerCollection: EventHandlerCollection = new EventHandlerCollection();
  private mouseDownTime: number | null = null;
  private mouseMoveDelta = 0;
  private ray: Ray = new Ray();

  static init(
    collisionManager: CollisionsManager,
    clickTarget: Document | HTMLElement,
    camera: playcanvas.Entity,
  ): CustomPlayCanvasClickTrigger {
    return new CustomPlayCanvasClickTrigger(collisionManager, clickTarget, camera);
  }

  private constructor(
    private collisionManager: CollisionsManager,
    private clickTarget: Document | HTMLElement,
    private camera: playcanvas.Entity,
  ) {
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
      this.handleClick(event);
    }
  }

  private handleMouseMove(event: MouseEvent) {
    if (this.mouseDownTime) {
      this.mouseMoveDelta += Math.abs(event.movementX) + Math.abs(event.movementY);
    }
  }

  private handleClick(event: MouseEvent) {
    if ((event.detail as any).element) {
      // Avoid infinite loop of handling click events that originated from this trigger
      return;
    }
    let x = 0;
    let y = 0;
    if (!document.pointerLockElement) {
      x = event.offsetX;
      y = event.offsetY;
    }

    const cameraEntity = this.camera;
    const from = cameraEntity.getPosition();
    const cameraComponent = cameraEntity.camera;
    if (!cameraComponent) {
      console.warn("No camera component found on the camera entity. Cannot raycast.");
      return;
    }

    // The pc.Vec3 to raycast to (the click position projected onto the camera's far clip plane)
    const direction = cameraComponent
      .screenToWorld(x, y, cameraComponent.farClip)
      .sub(from)
      .normalize();
    this.ray.set(from, direction);

    const result = this.collisionManager.raycastFirst(this.ray);

    // If there was a hit, store the entity
    if (result) {
      const hitEntity = result[2].source;
      let mElement;
      for (let entity: playcanvas.GraphNode = hitEntity; entity; entity = entity.parent) {
        mElement = MElement.getMElementFromObject(entity);
        if (mElement) {
          break;
        }
      }
      if (
        mElement &&
        TransformableElement.isTransformableElement(mElement) &&
        mElement.isClickable()
      ) {
        // let's get the intersection point relative to the element origin

        const elementRelative = getRelativePositionAndRotationRelativeToObject(
          {
            position: result[3],
            rotation: {
              x: 0,
              y: 0,
              z: 0,
            },
          },
          mElement,
        );

        mElement.dispatchEvent(
          new CustomEvent("click", {
            bubbles: true,
            detail: {
              position: {
                ...elementRelative.position,
              },
            },
          }),
        );
        return;
      }
    }
  }

  dispose() {
    this.eventHandlerCollection.clear();
  }
}
