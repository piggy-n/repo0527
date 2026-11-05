import type { PreparedTile, PreparedTileset } from '../prepare-tileset';
import { identity, type Mat4, multiply } from './nav-frame';

/** 最精细一级的瓦片：内容坐标经 toLocal 换到根节点局部系 */
export interface NavLeaf {
  readonly url: string;
  readonly toLocal: Mat4;
}

const isMatrix = (value: unknown): value is readonly number[] =>
  Array.isArray(value) && value.length === 16 && value.every(item => typeof item === 'number' && Number.isFinite(item));

function tileTransform(tile: PreparedTile): readonly number[] | null {
  const { transform } = tile;
  if (transform === undefined) {
    return null;
  }
  if (!isMatrix(transform)) {
    throw new Error('瓦片的 transform 不是 16 个数');
  }
  return transform;
}

/** 整理后的索引里有内容、没有子节点的瓦片；根节点自己的 transform 不算（它就是局部系） */
export function navigationLeaves(tileset: PreparedTileset): readonly NavLeaf[] {
  const leaves: NavLeaf[] = [];
  const visit = (tile: PreparedTile, toLocal: Mat4) => {
    const transform = tile === tileset.root ? null : tileTransform(tile);
    const next = transform ? multiply(toLocal, transform) : toLocal;
    if (tile.content && !tile.children?.length) {
      leaves.push({ url: tile.content.uri, toLocal: next });
    }
    tile.children?.forEach(child => visit(child, next));
  };
  visit(tileset.root, identity());
  return leaves;
}

/** 根节点的 transform：导航网格的局部系由它决定（navigationFrame） */
export function rootTransform(tileset: PreparedTileset): readonly number[] {
  const transform = tileTransform(tileset.root);
  if (!transform) {
    throw new Error('瓦片集根节点没有 transform，无法建立导航网格的局部系');
  }
  return transform;
}
