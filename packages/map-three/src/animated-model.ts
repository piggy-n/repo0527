import type { AnchorMatrices, LngLat, SceneFrame, SceneSurface } from '@mx/map-core';
import {
  AnimationMixer,
  Group,
  Matrix4,
  type Mesh,
  type Object3D,
  PerspectiveCamera,
  Scene,
  type Texture
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FrameMath } from './frame';
import { createSunLights } from './lighting';

/** 模型放在哪：经纬度和椭球高 */
export interface ModelPlacement {
  readonly lngLat: LngLat;
  readonly height: number;
}

// 释放模型的几何、材质和纹理：GLTFLoader 给的对象不归别人管
function disposeObject(root: Object3D): void {
  root.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    mesh.geometry.dispose();
    for (const material of [mesh.material].flat()) {
      for (const value of Object.values(material)) {
        if ((value as Texture | null)?.isTexture) {
          (value as Texture).dispose();
        }
      }
      material.dispose();
    }
  });
}

/**
 * 一个 glTF 模型和它的全部动画（ADR 0147 第 3 节的 glTF、骨骼动画验收；第三人称的人物在 3C.3 用它）：
 * 局部系锚在放置点，动画按真实时间推进
 */
export class AnimatedModel implements Disposable {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera();
  readonly #math: FrameMath;
  readonly #placement: ModelPlacement;
  readonly #root: Object3D;
  readonly #mixer: AnimationMixer;
  readonly #animated: boolean;
  // 上一帧的时间（毫秒）：动画按真实时间推进
  #lastFrame: number | null = null;
  readonly #clip = new Matrix4();
  #anchor: AnchorMatrices | null = null;

  private constructor(root: Object3D, mixer: AnimationMixer, placement: ModelPlacement, math: FrameMath) {
    this.#math = math;
    this.#animated = root.animations.length > 0;
    this.#placement = placement;
    this.#root = root;
    this.#mixer = mixer;
    const lifted = new Group();
    lifted.position.set(0, placement.height, 0);
    lifted.add(root);
    this.scene.add(lifted, ...createSunLights());
  }

  /** 下载、解析 glTF 并开始播放它的全部动画；signal 中止时以它的原因结束 */
  static async load(url: string, placement: ModelPlacement, math: FrameMath, signal: AbortSignal): Promise<AnimatedModel> {
    const gltf = await new GLTFLoader().loadAsync(url);
    if (signal.aborted) {
      disposeObject(gltf.scene);
      signal.throwIfAborted();
    }
    const mixer = new AnimationMixer(gltf.scene);
    gltf.scene.animations = gltf.animations;
    for (const clip of gltf.animations) {
      mixer.clipAction(clip).play();
    }
    return new AnimatedModel(gltf.scene, mixer, placement, math);
  }

  /** 有动画在播放：要一直重画 */
  get animating(): boolean {
    return this.#animated;
  }

  /** 动画已经播放的秒数 */
  get time(): number {
    return this.#mixer.time;
  }

  /** 画一帧之前：推进动画，按这一帧的投影换算相机；在地球背面时不画 */
  prepare(frame: SceneFrame, surface: SceneSurface): boolean {
    this.#anchor ??= surface.anchor(...this.#placement.lngLat);
    const now = performance.now();
    this.#mixer.update(this.#lastFrame === null ? 0 : (now - this.#lastFrame) / 1000);
    this.#lastFrame = now;
    if (this.#math.behindGlobe(frame, this.#anchor)) {
      return false;
    }
    this.#math.syncCamera(this.camera, this.#math.clipMatrix(frame, this.#anchor, this.#clip), frame);
    this.scene.updateMatrixWorld(true);
    return true;
  }

  [Symbol.dispose](): void {
    this.#mixer.stopAllAction();
    disposeObject(this.#root);
  }
}
