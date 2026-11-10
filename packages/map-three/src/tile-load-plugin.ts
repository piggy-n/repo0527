import type { LRUCache, TilesRenderer } from '3d-tiles-renderer';
import type { Object3D, Sphere } from 'three';
import type { TileUploader } from './tile-uploader';

/** 3d-tiles-renderer 运行时有、类型声明里没有的瓦片字段 */
export interface TileInternals {
  geometricError: number;
  refine?: string;
  readonly children: readonly { refine?: string }[];
  readonly internal: {
    readonly depth: number;
    readonly hasContent: boolean;
    readonly hasRenderableContent: boolean;
    readonly loadingState: number;
  };
  readonly traversal: { readonly inFrustum: boolean };
  readonly engineData: {
    readonly scene: Object3D | null;
    readonly boundingVolume: { getSphere(target: Sphere): void };
  };
}

interface ParseTile {
  parseTile(buffer: unknown, tile: TileInternals, extension: string, url: string, signal: AbortSignal): Promise<void>;
}

/**
 * 瓦片库的插件（同库的插件接口，由库调用）：
 * - 没有内容的节点（JKQ2 的根节点）屏幕误差当作无穷大，一律往下走：不管放宽多少，停下的都是有内容的层，整棵树不会都不画。
 *   它没有什么可替换的，也当作 ADD：库对 REPLACE 的节点要等子节点全到才显示它们（放不下一部分时永远等不到），
 *   还会把视野外的子节点一起加载（532 个块时就是 3.7 GB）
 * - 解析完先按预算上传，传完才算加载完：库这时还认为它没到，父节点继续显示，不会有空洞；传完时告诉 onReady
 */
export class TileLoadPlugin {
  readonly name = 'MX_TILE_LOAD';
  readonly #uploader: TileUploader;
  readonly #cache: LRUCache;
  readonly #onReady: (tile: TileInternals) => void;
  #tiles: (TilesRenderer & ParseTile) | null = null;

  constructor(uploader: TileUploader, cache: LRUCache, onReady: (tile: TileInternals) => void) {
    this.#uploader = uploader;
    this.#cache = cache;
    this.#onReady = onReady;
  }

  init(tiles: TilesRenderer & ParseTile): void {
    this.#tiles = tiles;
  }

  preprocessNode(tile: TileInternals): void {
    if (!tile.internal.hasContent && tile.children.length > 0) {
      tile.geometricError = Infinity;
      // 子节点没写 refine 时沿用父节点的，要在改之前传下去
      for (const child of tile.children) {
        child.refine ??= tile.refine;
      }
      tile.refine = 'ADD';
    }
  }

  async parseTile(buffer: unknown, tile: TileInternals, extension: string, url: string, signal: AbortSignal): Promise<void> {
    if (!this.#tiles) {
      throw new Error('瓦片库的插件还没有注册');
    }
    await this.#tiles.parseTile(buffer, tile, extension, url, signal);
    const { scene } = tile.engineData;
    // 缓存满了的瓦片库马上会丢弃，不用传
    if (scene && !signal.aborted && !this.#cache.isFull()) {
      await this.#uploader.enqueue(scene, signal);
      if (!signal.aborted) {
        this.#onReady(tile);
      }
    }
  }
}
