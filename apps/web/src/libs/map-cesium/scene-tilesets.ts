import type { PreparedTileset, TilesetLighting } from '@yzt/map-core';
import {
  type BoundingSphere,
  Cesium3DTileset,
  type CesiumWidget,
  CustomShader,
  LightingModel,
  ShadowMode,
  UniformType
} from 'cesium';
import type { TilesetOptions } from './scene-like';

// 沿用旧项目实测的参数（ADR 0081 第 3 节）：站内要最精细一级，显存约 200 MB，缓存要放大；移动时不请求、不预加载
const TILESET_OPTIONS = {
  maximumScreenSpaceError: 16,
  cacheBytes: 384 * 1024 * 1024,
  maximumCacheOverflowBytes: 256 * 1024 * 1024,
  cullRequestsWhileMoving: true,
  preloadWhenHidden: false,
  preloadFlightDestinations: false,
  skipLevelOfDetail: false,
  dynamicScreenSpaceError: false,
  foveatedTimeDelay: 0.2,
  shadows: ShadowMode.DISABLED,
  enableCollision: false,
  backFaceCulling: false
} satisfies Cesium3DTileset.ConstructorOptions;

/**
 * 地下、室内的"头灯"光照（旧项目的做法）：以相机为光源，正对视线的面亮、斜掠的面暗，和时间无关；
 * 模型的材质是双面的，法线用屏幕空间导数求。第三人称的人物也用它，站内明暗一致
 */
export function createHeadlightShader(): CustomShader {
  return new CustomShader({
    lightingModel: LightingModel.UNLIT,
    uniforms: { uFog: { type: UniformType.FLOAT, value: 0 } },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec3 positionEC = fsInput.attributes.positionEC;
        vec3 normalEC = normalize(cross(dFdx(positionEC), dFdy(positionEC)));
        float facing = abs(dot(normalEC, normalize(-positionEC)));
        float fog = mix(1.0, 0.45, smoothstep(15.0, 180.0, length(positionEC)) * uFog);
        material.diffuse *= (0.5 + 0.5 * facing) * fog * 1.15;
      }
    `
  });
}

export interface SceneTilesetEvents {
  readonly failed: (id: string, error: unknown) => void;
  readonly initial: (id: string) => void;
}

interface Entry {
  readonly tileset: Cesium3DTileset;
  readonly unsubscribe: () => void;
}

/** 场景里的 3D Tiles 瓦片集（ADR 0081 第 3 节）：按 ID 加、改、删，瓦片失败和首批瓦片到位通过回调报告 */
export class SceneTilesets implements Disposable {
  readonly #widget: CesiumWidget;
  readonly #events: SceneTilesetEvents;
  readonly #entries = new Map<string, Entry>();
  readonly #headlight = createHeadlightShader();
  #disposed = false;

  constructor(widget: CesiumWidget, events: SceneTilesetEvents) {
    this.#widget = widget;
    this.#events = events;
  }

  /** 建好瓦片集并加进场景；signal 中止或已释放时销毁建好的瓦片集、以原因结束 */
  async add(
    id: string,
    prepared: PreparedTileset,
    options: TilesetOptions,
    signal: AbortSignal
  ): Promise<BoundingSphere> {
    if (this.#entries.has(id)) {
      throw new Error(`瓦片集 ${id} 已经加过`);
    }
    // 整理后的索引里内容都是绝对地址，用 Blob 地址交给 Cesium，建好后就可以释放
    const url = URL.createObjectURL(new Blob([JSON.stringify(prepared)], { type: 'application/json' }));
    let tileset: Cesium3DTileset;
    try {
      tileset = await Cesium3DTileset.fromUrl(url, TILESET_OPTIONS);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (signal.aborted || this.#disposed || this.#entries.has(id)) {
      tileset.destroy();
      signal.throwIfAborted();
      throw new Error(this.#disposed ? '场景已释放' : `瓦片集 ${id} 已经加过`);
    }
    this.#apply(tileset, options);
    this.#widget.scene.primitives.add(tileset);
    const unsubscribeFailed = tileset.tileFailed.addEventListener(({ message }: { message: unknown }) =>
      this.#events.failed(id, new Error(`瓦片集 ${id} 的瓦片加载失败`, { cause: message }))
    );
    const unsubscribeInitial = tileset.initialTilesLoaded.addEventListener(() => this.#events.initial(id));
    this.#entries.set(id, {
      tileset,
      unsubscribe: () => {
        unsubscribeFailed();
        unsubscribeInitial();
      }
    });
    this.#widget.scene.requestRender();
    return tileset.boundingSphere;
  }

  update(id: string, options: TilesetOptions): void {
    const entry = this.#entries.get(id);
    if (entry) {
      this.#apply(entry.tileset, options);
      this.#widget.scene.requestRender();
    }
  }

  remove(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) {
      return;
    }
    entry.unsubscribe();
    // 从场景移除时 Cesium 销毁瓦片集，释放显存
    this.#widget.scene.primitives.remove(entry.tileset);
    this.#entries.delete(id);
    this.#widget.scene.requestRender();
  }

  boundingSphere(id: string): BoundingSphere | undefined {
    return this.#entries.get(id)?.tileset.boundingSphere;
  }

  /** 步行时按距离压暗远处，增加通道的纵深（旧项目的做法）；平时关掉，俯瞰整座车站时不发灰 */
  setInteriorFog(enabled: boolean): void {
    this.#headlight.setUniform('uFog', enabled ? 1 : 0);
    this.#widget.scene.requestRender();
  }

  /** 有显示着的瓦片集：没有时拾取模型注定落空 */
  get anyShown(): boolean {
    for (const { tileset } of this.#entries.values()) {
      if (tileset.show) {
        return true;
      }
    }
    return false;
  }

  [Symbol.dispose](): void {
    this.#disposed = true;
    for (const id of this.#entries.keys()) {
      this.remove(id);
    }
    this.#headlight.destroy();
  }

  #apply(tileset: Cesium3DTileset, { show, lighting }: TilesetOptions): void {
    tileset.show = show;
    tileset.customShader = lightingShader(lighting, this.#headlight);
  }
}

function lightingShader(lighting: TilesetLighting, headlight: CustomShader): CustomShader | undefined {
  return lighting === 'headlight' ? headlight : undefined;
}
