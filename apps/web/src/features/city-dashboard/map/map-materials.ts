import type { SweepUniforms } from './types';
import { Color, MeshPhongMaterial, ShaderMaterial } from 'three';
import { gsap } from 'gsap';
import { getMapColor, MAP_DEPTH, MAP_ENTRANCE, MAP_YEAR_TRANSITION } from './config';

// 地图厚度共用同一常量，边界、标签与相机同步使用
export { MAP_DEPTH } from './config';

// 顶面与侧面分开着色，灰色状态也保留地图厚度
export function createRegionMaterials(value: number | null, sweepUniforms: SweepUniforms, initial = false) {
  const color = new Color(initial ? MAP_ENTRANCE.color : getMapColor(value));
  const top = new MeshPhongMaterial({ color, specular: '#ACDFFF', shininess: 38, transparent: true, opacity: 0 });
  // 待展示阶段仍允许流光经过，不能借用无数据状态隐藏纹理与扫光
  const dataAvailable = { value: initial || Number.isFinite(value) ? 1 : 0 };
  const hover = { value: 0 };
  // 扫光沿真实地图顶面移动，保留城市着色和灰色无数据语义
  top.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, sweepUniforms, { uDataAvailable: dataAvailable, uHover: hover });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vDashboardPosition;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDashboardPosition = position.xy;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      varying vec2 vDashboardPosition;
      uniform float uSweepPosition;
      uniform float uSweepStrength;
      uniform float uDataAvailable;
      uniform float uHover;
      float dashboardNoise(vec2 p) {
        vec2 cell = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
        float b = fract(sin(dot(cell + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
        float c = fract(sin(dot(cell + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
        float d = fract(sin(dot(cell + vec2(1.0), vec2(127.1, 311.7))) * 43758.5453);
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
    `);
    // 低对比度表面纹理保留分级色，避免像整块纯色塑料
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float textureValue = dashboardNoise(vDashboardPosition * 0.08) * 0.65 + dashboardNoise(vDashboardPosition * 0.3) * 0.35;
      diffuseColor.rgb *= mix(1.0, 0.84 + textureValue * 0.36, uDataAvailable);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      float scanDistance = (dot(vDashboardPosition, vec2(0.82, 0.57)) - uSweepPosition) / 22.0;
      float scanBand = exp(-scanDistance * scanDistance);
      totalEmissiveRadiance += vec3(0.28, 0.72, 0.9) * scanBand * uSweepStrength * uDataAvailable;
      totalEmissiveRadiance += vec3(0.01, 0.045, 0.075) * uHover * uDataAvailable;
    `);
  };
  const sideColor = color.clone();
  const side = new ShaderMaterial({
    transparent: true,
    uniforms: { uColor: { value: sideColor }, uOpacity: { value: 0 }, uDepth: { value: MAP_DEPTH }, uDataAvailable: dataAvailable },
    vertexShader: `
      varying vec3 vPosition;
      varying vec3 vSideNormal;
      void main() {
        vPosition = position;
        vSideNormal = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uDepth;
      uniform float uDataAvailable;
      varying vec3 vPosition;
      varying vec3 vSideNormal;
      void main() {
        float height = clamp(vPosition.z / uDepth, 0.0, 1.0);
        float stripe = 0.88 + 0.12 * sin((vPosition.x + vPosition.y) * 2.6);
        float direction = 0.82 + 0.18 * dot(vSideNormal.xy, normalize(vec2(-0.6, 0.8)));
        vec3 lowerColor = mix(uColor * 0.45, vec3(0.013, 0.08, 0.48), uDataAvailable * 0.72);
        vec3 upperColor = uColor * 1.03 + vec3(0.0, 0.05, 0.09) * uDataAvailable;
        vec3 color = mix(lowerColor, upperColor, pow(height, 1.4)) * stripe * direction;
        gl_FragColor = vec4(color, uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
  return { top, side, sideColor, dataAvailable, hover };
}

// 直接插值材质颜色，避免数值跨过分级阈值时突然跳色
export function updateRegionMaterials(materials: RegionMaterials, value: number | null, duration = 0, onUpdate?: () => void) {
  const color = new Color(getMapColor(value));
  gsap.killTweensOf(materials.top.color);
  if (duration) {
    gsap.to(materials.top.color, {
      r: color.r, g: color.g, b: color.b, duration, ease: MAP_YEAR_TRANSITION.ease, paused: document.hidden,
      onUpdate: () => { materials.sideColor.copy(materials.top.color); onUpdate?.(); }
    });
  } else {
    materials.top.color.copy(color);
    materials.sideColor.copy(color);
  }
  materials.dataAvailable.value = Number.isFinite(value) ? 1 : 0;
}

export type RegionMaterials = ReturnType<typeof createRegionMaterials>;
