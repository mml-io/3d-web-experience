import { ShaderMaterial, Uniform, Vector2 } from "three";

import { vertexShader } from "../shaders/vertex-shader";

export const GaussGrainEffect = new ShaderMaterial({

    tDiffuse: new Uniform(null),
    resolution: new Uniform(new Vector2()),
    time: new Uniform(0.0),
    amount: new Uniform(0.0),
    alpha: new Uniform(0.0),

  vertexShader: vertexShader,
  fragmentShader: /* glsl */ `



































      gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
    }
  `,
});
