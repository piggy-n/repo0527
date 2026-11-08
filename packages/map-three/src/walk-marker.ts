import type { AnchorMatrices, SceneFrame, SceneMarker, SceneSurface } from '@mx/map-core';
import { Color, DoubleSide, Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial } from 'three';
import type { FrameMath } from './frame';

// 光环直径（米）；抬离地面一点，免得和地板的深度打架闪烁（同 map-cesium 的 scene-walk-marker）
const SIZE = 1;
const LIFT = 0.03;
const FADE_IN = 100;
const FADE_OUT = 300;
const COLOR = '#3cd2ff';

// r 是到中心的距离（0 中心、1 边缘），elapsed 是点下后的秒数，fade 是整体的淡入淡出：
// 点下的 0.35 秒外圈从边缘收拢到落点圈，落稳后每 1.1 秒一道波纹往外扩散、变淡
const FRAGMENT = `
uniform vec3 tint;
uniform float elapsed;
uniform float fade;
varying vec2 vUv;

void main() {
  float r = length(vUv - 0.5) * 2.0;
  float land = 1.0 - pow(1.0 - clamp(elapsed / 0.35, 0.0, 1.0), 3.0);
  float ringRadius = mix(1.0, 0.55, land);
  float ring = 1.0 - smoothstep(0.0, 0.08, abs(r - ringRadius));
  float core = (1.0 - smoothstep(0.1, 0.16, r)) * land;
  float fill = (1.0 - smoothstep(ringRadius - 0.1, ringRadius, r)) * 0.18;
  float wave = fract(max(elapsed - 0.35, 0.0) / 1.1);
  float ripple = (1.0 - smoothstep(0.0, 0.06, abs(r - mix(ringRadius, 1.0, wave))))
    * (1.0 - wave) * step(0.35, elapsed);
  float alpha = max(max(ring, core), max(ripple * 0.6, fill));
  gl_FragColor = vec4(tint, alpha * fade * step(r, 1.0));
}
`;

const VERTEX = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * 点击移动的落点光环（ADR 0086 第 4 节，从 map-cesium 的 WalkMarker 移植）：贴在目标地面上的一块平面，
 * 做深度测试（墙、柱子挡得住），半透明不写深度，不影响拾取；局部系锚在落点
 */
export class WalkMarker implements Disposable {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera();
  readonly #math: FrameMath;
  readonly #material: ShaderMaterial;
  readonly #mesh: Mesh;
  readonly #clip = new Matrix4();
  #marker: SceneMarker | null = null;
  #anchor: AnchorMatrices | null = null;
  #lift = 0;
  #shownAt = 0;
  #hidingAt: number | null = null;

  constructor(math: FrameMath) {
    this.#math = math;
    this.#material = new ShaderMaterial({
      uniforms: { tint: { value: new Color(COLOR) }, elapsed: { value: 0 }, fade: { value: 0 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: DoubleSide
    });
    // 局部系 y 朝上：平面放平
    const geometry = new PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2);
    this.#mesh = new Mesh(geometry, this.#material);
    this.#mesh.visible = false;
    this.scene.add(this.#mesh);
  }

  /** 在落点亮起；已经亮着就移过去重新播放 */
  show(marker: SceneMarker): void {
    this.#marker = marker;
    this.#anchor = null;
    this.#mesh.visible = true;
    this.#shownAt = performance.now();
    this.#hidingAt = null;
  }

  /** 淡出；已经在淡出或没显示就不管 */
  hide(): void {
    if (this.#mesh.visible && this.#hidingAt === null) {
      this.#hidingAt = performance.now();
    }
  }

  /** 抬高量（米）：和抬高的瓦片集一起上移 */
  setLift(meters: number): void {
    this.#lift = meters;
  }

  /** 画一帧之前：推进动画、按这一帧的投影换算相机；不显示、在地球背面时不画 */
  prepare(frame: SceneFrame, surface: SceneSurface, now: number): boolean {
    const marker = this.#marker;
    if (!this.#mesh.visible || !marker) {
      return false;
    }
    const fadeOut = this.#hidingAt === null ? 1 : 1 - (now - this.#hidingAt) / FADE_OUT;
    if (fadeOut <= 0) {
      this.#mesh.visible = false;
      return false;
    }
    this.#material.uniforms.elapsed.value = (now - this.#shownAt) / 1000;
    this.#material.uniforms.fade.value = Math.min(1, (now - this.#shownAt) / FADE_IN) * fadeOut;
    this.#anchor ??= surface.anchor(...marker.lngLat);
    if (this.#math.behindGlobe(frame, this.#anchor)) {
      return false;
    }
    this.#mesh.position.set(0, marker.height + this.#lift + LIFT, 0);
    this.#math.syncCamera(this.camera, this.#math.clipMatrix(frame, this.#anchor, this.#clip), frame);
    this.scene.updateMatrixWorld(true);
    return true;
  }

  [Symbol.dispose](): void {
    this.#mesh.geometry.dispose();
    this.#material.dispose();
  }
}
