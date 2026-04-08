import * as ex from 'excalibur'

/**
 * Outlines the graphic with a black border
 */
export class OutlineMaterial extends ex.Material {
  constructor(ctx: ex.ExcaliburGraphicsContext, thickness: number = 1) {
    super({
      name: 'outline-material',
      fragmentSource: /*glsl*/ `#version 300 es
        precision mediump float;
        
        uniform float u_time_ms;
        uniform sampler2D u_graphic;

        in vec2 v_uv;
        out vec4 fragColor;

        vec3 hsv2rgb(vec3 c){
          vec4 K=vec4(1.,2./3.,1./3.,3.);
          return c.z*mix(K.xxx,clamp(abs(fract(c.x+K.xyz)*6.-K.w)-K.x, 0., 1.),c.y);
        }

        void main() {
          const float TAU = 6.28318530;
          const float steps = 4.0; // up/down/left/right pixels

          float radius = ${(thickness * 2).toFixed(1)};
          float time_sec = u_time_ms / 1000.;
          vec3 outlineColorHSL = vec3(0,0,0);
          vec2 aspect = 1.0 / vec2(textureSize(u_graphic, 0));
          for (float i = 0.0; i < TAU; i += TAU / steps) {
            vec2 offset = vec2(sin(i), cos(i)) * aspect * radius;
            vec4 col = texture(u_graphic, v_uv + offset);            
            float alpha = smoothstep(0.5, 0.7, col.a);
            fragColor = mix(fragColor, vec4(outlineColorHSL, 1.0), alpha);
          }
          
          vec4 mat = texture(u_graphic, v_uv);
          float factor = smoothstep(0.5, 0.7, mat.a);
          fragColor = mix(fragColor, mat, factor);
        }
      `,
      graphicsContext: ctx,
    })
  }
}
