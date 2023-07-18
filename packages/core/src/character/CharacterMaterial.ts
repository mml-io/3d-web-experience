import { Color, MeshPhysicalMaterial, UniformsUtils } from "three";

import { bayerDither } from "../rendering/shaders/bayer-dither";
import {
  injectBefore,
  injectBeforeMain,
  injectInsideMain,
} from "../rendering/shaders/shader-helpers";

type TUniform<TValue = any> = { value: TValue };

export class CharacterMaterial extends MeshPhysicalMaterial {
  public uniforms: Record<string, TUniform> = {};



    super();
    this.color = new Color(0xffffff);
    this.transmission = 0.5;
    this.metalness = 0.5;
    this.roughness = 0.3;
    this.ior = 2.0;
    this.thickness = 0.1;
    this.specularColor = new Color(0x0077ff);
    this.specularIntensity = 0.1;
    this.envMapIntensity = 1.8;
    this.sheenColor = new Color(0x770077);
    this.sheen = 0.35;

    this.onBeforeCompile = (shader) => {
      this.uniforms = UniformsUtils.clone(shader.uniforms);
      this.uniforms.nearClip = { value: 0.01 };
      this.uniforms.farClip = { value: 1000.0 };
      this.uniforms.ditheringNear = { value: 0.25 };
      this.uniforms.ditheringRange = { value: 0.5 };
      this.uniforms.time = { value: 0.0 };
      this.uniforms.diffuseRandomColor = { value: new Color() };
      shader.uniforms = this.uniforms;





































          float s = clamp(0.35 + 0.35 * sin(5.0 * -time + suv.y * 500.0), 0.0, 1.0);


          outgoingLight += smoothstep(0.1, 0.0, scanLines) * 0.1;







  private generateColorCube() {













