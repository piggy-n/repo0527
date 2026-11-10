import type { CustomLayerInterface, CustomRenderMethodInput } from 'maplibre-gl';
import { anchorMatrices } from './scene-anchor';
import type { SceneRenderer } from './scene-renderer';

/** 三维模型层的 ID：不在会话的样式里，由 MapLibre 适配器自己加上、撤下 */
export const SCENE_LAYER_ID = 'mx-scene-3d';

/** 外壳挂上时用到的地图能力 */
export interface SceneLayerMap {
  getCanvas(): HTMLCanvasElement;
  triggerRepaint(): void;
}

/**
 * custom layer 的外壳（ADR 0147 第 5 节）：MapLibre 只和它打交道，它把 GL 上下文、每帧的矩阵和投影过渡值交给渲染器。
 * 回调里不抛错：渲染出错会打断 MapLibre 自己的帧，交给 onError，连续出错只报告第一次
 */
export class SceneLayer implements CustomLayerInterface {
  readonly id = SCENE_LAYER_ID;
  readonly type = 'custom';
  readonly renderingMode = '3d';
  readonly #renderer: SceneRenderer;
  readonly #onError: (error: unknown) => void;
  #failing = false;

  constructor(renderer: SceneRenderer, onError: (error: unknown) => void) {
    this.#renderer = renderer;
    this.#onError = onError;
  }

  onAdd(map: SceneLayerMap, gl: WebGL2RenderingContext): void {
    this.#guard(() =>
      this.#renderer.attach({
        gl,
        canvas: map.getCanvas(),
        requestRepaint: () => map.triggerRepaint(),
        anchor: anchorMatrices
      })
    );
  }

  onRemove(): void {
    this.#guard(() => this.#renderer.detach());
  }

  // 有 prerender 时 MapLibre 画图层之前会作废自己的 GL 状态缓存：渲染器在回调外调用过 GL 也不影响 MapLibre（PoC 的坑 9）
  prerender(): void {
    this.#guard(() => this.#renderer.prerender());
  }

  render(_gl: WebGL2RenderingContext, { defaultProjectionData, projectionMatrix }: CustomRenderMethodInput): void {
    const { mainMatrix, fallbackMatrix, projectionTransition, clippingPlane } = defaultProjectionData;
    const rendered = this.#guard(() =>
      this.#renderer.render({
        mainMatrix,
        fallbackMatrix,
        projectionMatrix,
        transition: projectionTransition,
        clippingPlane
      })
    );
    if (rendered) {
      this.#failing = false;
    }
  }

  #guard(callback: () => void): boolean {
    try {
      callback();
      return true;
    } catch (error) {
      if (!this.#failing) {
        this.#failing = true;
        this.#onError(error);
      }
      return false;
    }
  }
}
