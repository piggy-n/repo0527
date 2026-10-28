import { WalkCycle } from '@yzt/map-core';
import { Cartesian3, Color, Matrix3, Matrix4, Model, ModelAnimationLoop, type Scene, ShadowMode } from 'cesium';
import { createHeadlightShader } from './scene-tilesets';

// Cesium Man 的原始身高和显示的身高（米）
const MODEL_HEIGHT = 1.51;
const BODY_HEIGHT = 1.72;
// 模型正面朝局部 x 轴：绕 z 轴转 (π/2 - yaw) 后面朝 yaw
const FORWARD_OFFSET = Math.PI / 2;
// 不透明度低于这个就不画
const MIN_ALPHA = 0.02;

/** 人在局部系里的脚下位置和面朝的方向（偏航） */
export interface AvatarPose {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly yaw: number;
}

/**
 * 第三人称的人物（ADR 0090 第 3 节）：第一次要显示时才加载；行走动画的相位由 WalkCycle 按走过的距离推进，
 * 和场景时钟无关；停下后各关节回到模型的原始姿态（双脚并拢站直）。受光用和站内模型同一套头灯；
 * 加载失败报告一次，步行照常，只是看不到人
 */
export class WalkAvatar implements Disposable {
  readonly #scene: Scene;
  readonly #url: string;
  readonly #onFailed: (error: unknown) => void;
  readonly #cycle = new WalkCycle();
  readonly #matrix = new Matrix4();
  readonly #shader = createHeadlightShader();
  #state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  #model: Model | null = null;
  // 模型的节点名：回到原始姿态时逐个复位
  #nodeNames: readonly string[] = [];
  #animating = false;
  #alpha = 1;
  #disposed = false;

  constructor(scene: Scene, url: string, onFailed: (error: unknown) => void) {
    this.#scene = scene;
    this.#url = url;
    this.#onFailed = onFailed;
  }

  /** 画面上看得见人：看得见才会挡住点击 */
  get shown(): boolean {
    return this.#model?.show ?? false;
  }

  /**
   * 每帧：toWorld 是局部系到地心的变换，moved 是这一帧走过的距离（米），alpha 是不透明度（0 隐藏、1 不透明）。
   * 返回是否还要继续渲染（在放行走动画，或者模型刚加载好）
   */
  update(toWorld: Matrix4, pose: AvatarPose, moved: number, dt: number, alpha: number): boolean {
    const visible = alpha > MIN_ALPHA;
    if (visible && this.#state === 'idle') {
      void this.#load();
    }
    const walking = this.#cycle.advance(moved, dt);
    const model = this.#model;
    if (!model) {
      return false;
    }
    if (model.ready) {
      this.#setAnimating(walking);
    }
    const matrix = Matrix4.multiplyByTranslation(toWorld, new Cartesian3(pose.x, pose.y, pose.floor), this.#matrix);
    Matrix4.multiply(
      matrix,
      Matrix4.fromRotationTranslation(Matrix3.fromRotationZ(FORWARD_OFFSET - pose.yaw)),
      matrix
    );
    model.modelMatrix = Matrix4.multiplyByUniformScale(matrix, BODY_HEIGHT / MODEL_HEIGHT, matrix);
    const changed = model.show !== visible;
    model.show = visible;
    if (Math.abs(alpha - this.#alpha) > 1e-3) {
      this.#alpha = alpha;
      model.color = Color.WHITE.withAlpha(alpha);
    }
    return visible && (walking || changed || !model.ready);
  }

  [Symbol.dispose](): void {
    this.#disposed = true;
    if (this.#model && !this.#scene.isDestroyed()) {
      // primitives 默认销毁移除的模型
      this.#scene.primitives.remove(this.#model);
    }
    this.#model = null;
    this.#shader.destroy();
  }

  async #load(): Promise<void> {
    this.#state = 'loading';
    let model: Model;
    try {
      model = await Model.fromGltfAsync({
        url: this.#url,
        show: false,
        customShader: this.#shader,
        shadows: ShadowMode.DISABLED,
        gltfCallback: gltf => {
          this.#nodeNames = nodeNamesOf(gltf);
        }
      });
    } catch (error) {
      this.#state = 'failed';
      if (!this.#disposed) {
        this.#onFailed(error);
      }
      return;
    }
    if (this.#disposed || this.#scene.isDestroyed()) {
      model.destroy();
      return;
    }
    this.#state = 'ready';
    // 场景时钟不走（CesiumWidget 默认停着），动画也要播
    model.activeAnimations.animateWhilePaused = true;
    this.#model = this.#scene.primitives.add(model);
    this.#scene.requestRender();
  }

  // 停下时各关节设成模型里的原始变换（设一份副本才会重算蒙皮；设 undefined 只复位、画面不变）；被这样设过的关节
  // 不再由 glTF 动画驱动，所以重新走起来以前先设回 undefined，把关节交还给动画
  #setAnimating(animating: boolean): void {
    const model = this.#model;
    if (!model || animating === this.#animating) {
      return;
    }
    this.#animating = animating;
    // 类型声明里 getNode 不会返回 undefined，实际上找不到时是 undefined
    const nodes = this.#nodeNames.flatMap(name => model.getNode(name) ?? []);
    if (animating) {
      for (const node of nodes) {
        // 文档允许设 undefined（复位并交还给动画），类型声明里漏了
        node.matrix = undefined as unknown as Matrix4;
      }
      model.activeAnimations.addAll({ loop: ModelAnimationLoop.REPEAT, animationTime: () => this.#cycle.phase });
      return;
    }
    model.activeAnimations.removeAll();
    for (const node of nodes) {
      node.matrix = Matrix4.clone(node.originalMatrix);
    }
  }
}

// glTF 的 nodes[].name；gltfCallback 给的是解析好的 JSON
function nodeNamesOf(gltf: unknown): string[] {
  if (typeof gltf !== 'object' || gltf === null || !('nodes' in gltf) || !Array.isArray(gltf.nodes)) {
    return [];
  }
  return gltf.nodes.flatMap((node: unknown) =>
    typeof node === 'object' && node !== null && 'name' in node && typeof node.name === 'string' ? [node.name] : []
  );
}
