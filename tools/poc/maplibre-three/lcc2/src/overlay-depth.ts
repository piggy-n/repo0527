// 遮挡的缓解办法之一：把 Cesium 的深度搬到 Three 的画布里，先写进深度缓冲，泼溅再按它做深度测试。
// 两个上下文不能共用纹理，所以 Cesium 多画一遍：后处理把到相机的距离压成颜色画到自己的画布上，
// Three 这边用 texImage2D 把那块画布当纹理读进来，然后 Cesium 再画一遍正常的颜色
import { PostProcessStage, type Scene } from 'cesium';
import { AlwaysDepth, CanvasTexture, Mesh, NearestFilter, type PerspectiveCamera, PlaneGeometry, ShaderMaterial, Vector2, type WebGLRenderer } from 'three';

// 距离按 log2 压进 24 位：NEAR0 × 2^(v × OCTAVES)，0.05 米到一万多公里，100 米处一格约 0.1 毫米
const NEAR0 = 0.05;
const OCTAVES = 28;
// 全 1 表示这个像素上 Cesium 什么都没画
const MAX_CODE = 16777214;

const PACK_FRAGMENT = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float pack;
in vec2 v_textureCoordinates;
void main() {
  if (pack < 0.5) {
    out_FragColor = texture(colorTexture, v_textureCoordinates);
    return;
  }
  float raw = texture(depthTexture, v_textureCoordinates).r;
  if (raw >= 1.0) {
    out_FragColor = vec4(1.0);
    return;
  }
  // w 是到相机距离的倒数，对数深度时这样取精度最好
  float range = 1.0 / czm_windowToEyeCoordinates(gl_FragCoord.xy, raw).w;
  float code = clamp(log2(max(range, ${NEAR0}) / ${NEAR0}) / ${OCTAVES}.0, 0.0, 1.0) * ${MAX_CODE}.0;
  float r = floor(code / 65536.0);
  float g = floor((code - r * 65536.0) / 256.0);
  float b = floor(code - r * 65536.0 - g * 256.0);
  out_FragColor = vec4(vec3(r, g, b) / 255.0, 1.0);
}`;

const FILL_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FILL_FRAGMENT = `
uniform sampler2D depthCode;
uniform vec2 projection;
uniform float bias;
uniform float debug;
varying vec2 vUv;
void main() {
  vec3 c = floor(texture2D(depthCode, vUv).rgb * 255.0 + 0.5);
  float code = c.r * 65536.0 + c.g * 256.0 + c.b;
  if (code > ${MAX_CODE}.5) {
    discard;
  }
  float range = ${NEAR0} * exp2(code / ${MAX_CODE}.0 * ${OCTAVES}.0) + bias;
  // 透视投影：clip.z = P22 * z + P32，clip.w = -z，z = -distance
  float ndc = (projection.y - projection.x * range) / range;
  gl_FragDepth = clamp(ndc * 0.5 + 0.5, 0.0, 1.0);
  float shade = fract(log2(range));
  gl_FragColor = vec4(vec3(shade), 1.0) * debug;
}`;

/** Cesium 一侧：平时原样输出颜色，pack 打开时输出压好的距离 */
export class DepthPackStage {
  readonly stage: PostProcessStage;
  #pack = 0;

  constructor(scene: Scene) {
    this.stage = new PostProcessStage({
      name: 'poc_depth_pack',
      fragmentShader: PACK_FRAGMENT,
      uniforms: { pack: () => this.#pack }
    });
    scene.postProcessStages.add(this.stage);
  }

  set packing(on: boolean) {
    this.#pack = on ? 1 : 0;
  }
}

/** Three 一侧：全屏一个面，只写深度，排在所有东西前面画 */
export class DepthOccluder {
  readonly mesh: Mesh;
  readonly #texture: CanvasTexture;
  readonly #material: ShaderMaterial;
  readonly #renderer: WebGLRenderer;

  constructor(source: HTMLCanvasElement, renderer: WebGLRenderer) {
    this.#renderer = renderer;
    this.#texture = new CanvasTexture(source);
    this.#texture.minFilter = NearestFilter;
    this.#texture.magFilter = NearestFilter;
    this.#texture.generateMipmaps = false;
    this.#material = new ShaderMaterial({
      vertexShader: FILL_VERTEX,
      fragmentShader: FILL_FRAGMENT,
      uniforms: { depthCode: { value: this.#texture }, projection: { value: new Vector2() }, bias: { value: 0 }, debug: { value: 0 } },
      depthTest: true,
      depthFunc: AlwaysDepth,
      depthWrite: true,
      colorWrite: false
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.#material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Cesium 刚把距离画到画布上时调用：马上传进纹理，之后画布就可以被颜色盖掉 */
  upload(): void {
    this.#texture.needsUpdate = true;
    this.#renderer.initTexture(this.#texture);
  }

  sync(camera: PerspectiveCamera): void {
    const e = camera.projectionMatrix.elements;
    (this.#material.uniforms.projection.value as Vector2).set(e[10], e[14]);
  }

  /** 遮挡物往后推多少米；两份数据的表面重合时用来减少互相穿插 */
  set bias(metres: number) {
    this.#material.uniforms.bias.value = metres;
  }

  /** 把读到的深度画成灰度条纹，核对和 Cesium 的画面是否对齐 */
  set debug(on: boolean) {
    this.#material.uniforms.debug.value = on ? 1 : 0;
    this.#material.colorWrite = on;
  }

  dispose(): void {
    this.#texture.dispose();
    this.#material.dispose();
    this.mesh.geometry.dispose();
  }
}
