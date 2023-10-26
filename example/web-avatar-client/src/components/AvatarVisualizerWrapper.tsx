import { AvatarVisualizer } from "@mml-io/3d-web-standalone-avatar-editor";
import React, { useRef, useEffect, useCallback } from "react";
import { Object3D } from "three";

type AvatarVisualizerType = {
  character: Object3D;
};

export const AvatarVisualizerWrapper: React.FC<AvatarVisualizerType> = ({ character }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const visualizerRef = useRef<AvatarVisualizer | null>(null);
  const currentCharacterRef = useRef<Object3D | null>(null);
  const requestRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visualizerRef.current) {
      visualizerRef.current = new AvatarVisualizer();
      const canvasContainer = containerRef.current;
      if (canvasContainer && visualizerRef.current.renderer) {
        canvasContainer.appendChild(visualizerRef.current.renderer.domElement);
      }
    }
  }, []);

  useEffect(() => {
    const visualizer = visualizerRef.current;
    if (!character) return;
    if (visualizer) {
      visualizer.animateCharacter(character);
      const scene = visualizer.scene;
      scene.add(character);
      if (currentCharacterRef.current) scene.remove(currentCharacterRef.current);
      currentCharacterRef.current = character;
      visualizer.update();
    }
  }, [character]);

  const animationLoop = useCallback(() => {
    if (visualizerRef.current) {
      visualizerRef.current.update();
      requestRef.current = requestAnimationFrame(animationLoop);
    }
  }, []);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animationLoop);
    return () => {
      if (requestRef.current !== null) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [animationLoop]);

  return <div ref={containerRef} id="avatar-canvas-container"></div>;
};
