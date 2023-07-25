import { ShaderMaterial } from "three";

export const NormalBuffer = new ShaderMaterial({
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    void main(void) {
      vNormal = normalize(normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec3 vNormal;
    void main(void) {
      gl_FragColor = vec4(vNormal * 0.5 + 0.5, 1.0);
    }
  `,
});
