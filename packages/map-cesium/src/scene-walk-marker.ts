import {
  Cartesian3,
  Color,
  GeometryInstance,
  Material,
  MaterialAppearance,
  Matrix4,
  PlaneGeometry,
  Primitive,
  type Scene
} from 'cesium';

// 光环直径（米）；抬离地面一点，免得和地板的深度打架闪烁
const SIZE = 1;
const LIFT = 0.03;
const FADE_IN = 100;
const FADE_OUT = 300;
const COLOR = Color.fromCssColorString('#3cd2ff');

// r 是到中心的距离（0 中心、1 边缘），elapsed 是点下后的秒数，fade 是整体的淡入淡出：
// 点下的 0.35 秒外圈从边缘收拢到落点圈，落稳后每 1.1 秒一道波纹往外扩散、变淡
const SOURCE = `
uniform vec4 tint;
uniform float elapsed;
uniform float fade;

czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  float r = length(materialInput.st - 0.5) * 2.0;
  float land = 1.0 - pow(1.0 - clamp(elapsed / 0.35, 0.0, 1.0), 3.0);
  float ringRadius = mix(1.0, 0.55, land);
  float ring = 1.0 - smoothstep(0.0, 0.08, abs(r - ringRadius));
  float core = (1.0 - smoothstep(0.1, 0.16, r)) * land;
  float fill = (1.0 - smoothstep(ringRadius - 0.1, ringRadius, r)) * 0.18;
  float wave = fract(max(elapsed - 0.35, 0.0) / 1.1);
  float ripple = (1.0 - smoothstep(0.0, 0.06, abs(r - mix(ringRadius, 1.0, wave))))
    * (1.0 - wave) * step(0.35, elapsed);
  float alpha = max(max(ring, core), max(ripple * 0.6, fill));
  material.diffuse = tint.rgb;
  material.alpha = alpha * tint.a * fade * step(r, 1.0);
  return material;
}
`;

interface MarkerUniforms {
  elapsed: number;
  fade: number;
}

/**
 * 点击移动的落点光环（ADR 0086 第 4 节）：贴在目标地面上的一块平面，正常做深度测试（墙、柱子挡得住），
 * 半透明不写深度，不影响点击时的深度拾取；换位置只改 modelMatrix，动画只改材质的 uniform
 */
export class WalkMarker implements Disposable {
  readonly #scene: Scene;
  readonly #primitive: Primitive;
  readonly #uniforms: MarkerUniforms;
  #shownAt = 0;
  #hidingAt: number | null = null;

  constructor(scene: Scene) {
    this.#scene = scene;
    const material = new Material({
      fabric: { uniforms: { tint: COLOR, elapsed: 0, fade: 0 }, source: SOURCE },
      translucent: true
    });
    // Material 的 uniforms 是 fabric 里声明的那些，类型声明里是 any
    this.#uniforms = material.uniforms as MarkerUniforms;
    const materialSupport = MaterialAppearance.MaterialSupport.TEXTURED;
    this.#primitive = new Primitive({
      geometryInstances: new GeometryInstance({
        geometry: new PlaneGeometry({ vertexFormat: materialSupport.vertexFormat })
      }),
      appearance: new MaterialAppearance({ material, materialSupport, flat: true, translucent: true, closed: false }),
      asynchronous: false,
      allowPicking: false,
      show: false
    });
    scene.primitives.add(this.#primitive);
  }

  /** 在落点亮起：frame 是落点处的局部系（原点在地面上，z 朝上，单位是米）；已经亮着就移过去重新播放 */
  show(frame: Matrix4): void {
    const matrix = Matrix4.multiplyByTranslation(frame, new Cartesian3(0, 0, LIFT), new Matrix4());
    this.#primitive.modelMatrix = Matrix4.multiplyByUniformScale(matrix, SIZE, matrix);
    this.#primitive.show = true;
    this.#shownAt = performance.now();
    this.#hidingAt = null;
  }

  /** 淡出（走到了、被打断）；已经在淡出或没显示就不管 */
  hide(): void {
    if (this.#primitive.show && this.#hidingAt === null) {
      this.#hidingAt = performance.now();
    }
  }

  /** 每帧推进动画；返回是否还显示着（要继续渲染） */
  update(now: number): boolean {
    if (!this.#primitive.show) {
      return false;
    }
    const fadeOut = this.#hidingAt === null ? 1 : 1 - (now - this.#hidingAt) / FADE_OUT;
    if (fadeOut <= 0) {
      this.#primitive.show = false;
      return false;
    }
    this.#uniforms.elapsed = (now - this.#shownAt) / 1000;
    this.#uniforms.fade = Math.min(1, (now - this.#shownAt) / FADE_IN) * fadeOut;
    return true;
  }

  [Symbol.dispose](): void {
    if (!this.#scene.isDestroyed()) {
      this.#scene.primitives.remove(this.#primitive);
    }
  }
}
