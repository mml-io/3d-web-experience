// Stub for @mml-io/mml-web-threejs — prevents loading Three.js rendering code in Node.js tests.

import * as THREE from "three";

function createStubContainer(): THREE.Object3D {
  return new THREE.Object3D();
}

function createElementAdapter() {
  const container = createStubContainer();
  return {
    getContainer: () => container,
    getCollisionObj: () => container,
    dispose: () => {},
    enable: () => {},
    disable: () => {},
    setVisible: () => {},
    getWorldPosition: (target: THREE.Vector3) => target,
  };
}

const elementAdapterFactory = () => createElementAdapter();

export const ThreeJSGraphicsInterface = {
  MElementGraphicsInterface: elementAdapterFactory,
  MMLCubeGraphicsInterface: elementAdapterFactory,
  MMLCylinderGraphicsInterface: elementAdapterFactory,
  MMLSphereGraphicsInterface: elementAdapterFactory,
  MMLPlaneGraphicsInterface: elementAdapterFactory,
  MMLModelGraphicsInterface: elementAdapterFactory,
  MMLImageGraphicsInterface: elementAdapterFactory,
  MMLLabelGraphicsInterface: elementAdapterFactory,
  MMLLightGraphicsInterface: elementAdapterFactory,
  MMLFrameGraphicsInterface: elementAdapterFactory,
  MMLLinkGraphicsInterface: elementAdapterFactory,
  MMLTransformableGraphicsInterface: elementAdapterFactory,
  MMLDebugHelperGraphicsInterface: elementAdapterFactory,
  MMLAudioGraphicsInterface: elementAdapterFactory,
  MMLVideoGraphicsInterface: elementAdapterFactory,
  MMLChatProbeGraphicsInterface: elementAdapterFactory,
  MMLInteractionGraphicsInterface: elementAdapterFactory,
  MMLPositionProbeGraphicsInterface: elementAdapterFactory,
  MMLPromptGraphicsInterface: elementAdapterFactory,
  MMLOverlayGraphicsInterface: elementAdapterFactory,
  MMLAnimationGraphicsInterface: elementAdapterFactory,
  RemoteDocumentGraphicsInterface: elementAdapterFactory,
};

export class ThreeJSResourceManager {}
export type ThreeJSGraphicsAdapter = any;
