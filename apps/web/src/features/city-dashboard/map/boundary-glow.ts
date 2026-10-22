import type { Shape } from 'three';
import type { RegionMaterials } from './map-materials';
import type { NumberUniform } from './types';
import { CanvasTexture, DoubleSide, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import { MAP_DEPTH } from './map-materials';

// 将同市所有边界一次性描成圆角光带，避免密集拐点的宽三角带交叉形成毛刺
export function createBoundaryGlow(shapes: readonly Shape[], materials: RegionMaterials, reveal: NumberUniform) {
  const rings = shapes.flatMap(shape => [
    shape,
    ...shape.holes
  ].map(ring => ring.getPoints())).filter(points => points.length >= 3);
  if (!rings.length) {
    return null;
  }
  // 统一世界单位宽度，并限制每座城市纹理的尺寸与内存占用
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  rings.forEach(points => points.forEach(point => {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }));
  const padding = 4;
  const width = bounds.maxX - bounds.minX + padding * 2;
  const height = bounds.maxY - bounds.minY + padding * 2;
  const resolution = Math.min(6, 1024 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * resolution);
  canvas.height = Math.ceil(height * resolution);
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  context.beginPath();
  rings.forEach(points => {
    points.forEach((point, index) => {
      const x = (point.x - bounds.minX + padding) / width * canvas.width;
      const y = (bounds.maxY - point.y + padding) / height * canvas.height;
      if (index) {
        context.lineTo(x, y);
      } else {
        context.moveTo(x, y);
      }
    });
    context.closePath();
  });
  // 闭合路径共用一次柔化，外圈自然衰减，内圈保持连续贴边
  context.strokeStyle = '#FFFFFF';
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.lineWidth = 1.3 * resolution;
  context.filter = `blur(${0.65 * resolution}px)`;
  context.stroke();
  context.filter = 'none';
  context.globalAlpha = 0.24;
  context.lineWidth = 0.75 * resolution;
  context.stroke();
  const texture = new CanvasTexture(canvas);
  const geometry = new PlaneGeometry(width, height);
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uBoundaryMask: { value: texture },
      uOpacity: { value: 0 },
      uReveal: reveal,
      uDataAvailable: materials.dataAvailable,
      uHover: materials.hover
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uBoundaryMask;
      uniform float uOpacity;
      uniform float uReveal;
      uniform float uDataAvailable;
      uniform float uHover;
      varying vec2 vUv;
      void main() {
        float alpha = texture2D(uBoundaryMask, vUv).a * uOpacity * smoothstep(0.45, 1.0, uReveal);
        alpha *= mix(0.12, 1.0 + uHover * 0.2, uDataAvailable);
        vec3 color = mix(vec3(0.5, 0.58, 0.67), vec3(0.17, 0.64, 0.95), uDataAvailable);
        gl_FragColor = vec4(color, alpha);
        #include <colorspace_fragment>
      }
    `
  });
  const mesh = new Mesh(geometry, material);
  mesh.position.set(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    MAP_DEPTH + 0.2
  );
  mesh.renderOrder = 1;
  return Object.assign(mesh, { boundaryMask: texture });
}
