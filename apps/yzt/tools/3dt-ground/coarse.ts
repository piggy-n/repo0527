import { ToolError } from './errors.ts';
import { contentPoints, IDENTITY, type Matrix, multiply } from './ground.ts';

/** 下载：JSON 解析好，内容给字节；404 时为 null */
export interface Fetcher {
  json(url: string): Promise<unknown>;
  bytes(url: string): Promise<Uint8Array | null>;
}

interface Tile {
  readonly transform?: readonly number[];
  readonly content?: { readonly uri?: string; readonly url?: string };
  readonly children?: readonly Tile[];
}

interface Tileset {
  readonly asset?: { readonly gltfUpAxis?: string };
  readonly root: Tile;
}

interface Entry {
  readonly tile: Tile;
  // 相对地址按它解析
  readonly url: string;
  readonly parent: Matrix;
  readonly zUp: boolean;
}

// 一层里的瓦片（含走进去的外部索引）超过这么多就不往下找：索引太大，不像有粗的一级
const MAX_LEVEL_TILES = 5000;

function asTileset(value: unknown, url: string): Tileset {
  if (typeof value !== 'object' || value === null || !('root' in value)) {
    throw new ToolError(`${url} 不是瓦片集的索引`);
  }
  return value as Tileset;
}

/** 读到的最粗一级：内容的个数、顶点（地心坐标）、读不了的原因 */
export interface CoarseContent {
  readonly contents: number;
  readonly points: [number, number, number][];
  readonly skipped: readonly string[];
}

/**
 * 从根往下按层找第一层有模型内容的瓦片（外部索引照着走进去，算在引用它的那一层），读其中均匀挑出的 limit 块的顶点。
 * 最粗的一级覆盖整个模型、顶点少，适合看地面在哪个高度
 */
export async function coarseContent(rootUrl: string, fetcher: Fetcher, limit: number): Promise<CoarseContent> {
  const rootTileset = asTileset(await fetcher.json(rootUrl), rootUrl);
  let level: Entry[] = [
    { tile: rootTileset.root, url: rootUrl, parent: IDENTITY, zUp: rootTileset.asset?.gltfUpAxis === 'Z' }
  ];
  while (level.length > 0) {
    const models: { url: string; matrix: Matrix; zUp: boolean }[] = [];
    const next: Entry[] = [];
    for (let index = 0; index < level.length; index++) {
      if (level.length > MAX_LEVEL_TILES) {
        throw new ToolError(`${rootUrl} 的一层瓦片超过 ${MAX_LEVEL_TILES} 块还没有模型内容`);
      }
      const { tile, url, parent, zUp } = level[index];
      const matrix = tile.transform ? multiply(parent, tile.transform) : parent;
      const uri = tile.content?.uri ?? tile.content?.url;
      if (uri) {
        const contentUrl = new URL(uri, url).href;
        if (new URL(contentUrl).pathname.endsWith('.json')) {
          // oxlint-disable-next-line no-await-in-loop -- 外部索引要读到才知道这一层还有什么
          const external = asTileset(await fetcher.json(contentUrl), contentUrl);
          level.push({ tile: external.root, url: contentUrl, parent: matrix, zUp: external.asset?.gltfUpAxis === 'Z' });
        } else {
          models.push({ url: contentUrl, matrix, zUp });
        }
      }
      for (const child of tile.children ?? []) {
        next.push({ tile: child, url, parent: matrix, zUp });
      }
    }
    if (models.length > 0) {
      const step = Math.max(1, models.length / limit);
      const picked = Array.from({ length: Math.min(limit, models.length) }, (_, i) => models[Math.floor(i * step)]);
      const points: [number, number, number][] = [];
      const skipped: string[] = [];
      for (const model of picked) {
        if (!model) {
          continue;
        }
        // oxlint-disable-next-line no-await-in-loop -- 一块一块地读，服务器不用同时应付很多请求
        const data = await fetcher.bytes(model.url);
        if (!data) {
          skipped.push(`没有 ${model.url}`);
          continue;
        }
        const read = contentPoints(data, model.matrix, model.zUp);
        // 一块可能有几十万个顶点：不展开成参数
        for (const point of read.points) {
          points.push(point);
        }
        skipped.push(...read.skipped);
      }
      return { contents: picked.length, points, skipped };
    }
    level = next;
  }
  throw new ToolError(`${rootUrl} 里没有模型内容`);
}
