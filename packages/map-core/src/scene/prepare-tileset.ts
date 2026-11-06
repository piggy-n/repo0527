// 3D Tiles 索引的整理（ADR 0081 第 3 节，外部索引和误差的规则见 ADR 0148）：不依赖 Cesium
import { isMatrix, multiply } from './nav/nav-frame';

/** 下载一个 JSON；signal 中止时以它的原因结束 */
export type LoadJson = (url: string, signal: AbortSignal) => Promise<unknown>;

/** 整理后的瓦片节点：内容地址都是绝对地址，外部索引的根节点已经换到引用它的位置 */
export interface PreparedTile {
  readonly [key: string]: unknown;
  readonly geometricError: number;
  readonly boundingVolume: Readonly<Record<string, unknown>>;
  readonly content?: Readonly<Record<string, unknown>> & { readonly uri: string };
  readonly children?: readonly PreparedTile[];
}

/** 整理后的索引：可以直接交给 Cesium */
export interface PreparedTileset {
  readonly [key: string]: unknown;
  readonly geometricError: number;
  readonly root: PreparedTile;
}

type JsonObject = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// 去掉这些键的浅拷贝：整理不改动读入的对象
function without(object: JsonObject, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
}

function field(object: JsonObject, key: string, where: string): JsonObject {
  const value = object[key];
  if (!isObject(value)) {
    throw new Error(`${where} 的 ${key} 不是对象`);
  }
  return value;
}

// 包围球全是 0、没有子节点：导出工具留下的空占位（旧项目实测过的那一个指向数据目录外）
function isEmptyPlaceholder(tile: JsonObject): boolean {
  const sphere = isObject(tile.boundingVolume) ? tile.boundingVolume.sphere : undefined;
  const children = tile.children;
  return (
    Array.isArray(sphere) &&
    sphere.length === 4 &&
    sphere.every(value => value === 0) &&
    (!Array.isArray(children) || children.length === 0)
  );
}

function contentUri(tile: JsonObject): string | undefined {
  const content = tile.content;
  if (!isObject(content)) {
    return undefined;
  }
  // 旧版的 3D Tiles 写作 url
  const uri = content.uri ?? content.url;
  return typeof uri === 'string' ? uri : undefined;
}

interface Context {
  readonly directory: string;
  readonly load: LoadJson;
  readonly signal: AbortSignal;
}

// 节点的误差：叶节点为 0（不用再细分，旧项目里错误的误差会让 Cesium 选不稳层级），有内容的用自己的；
// 没有内容的取自己和子节点的较大值：它或子节点被改小，Cesium 停在没有内容的节点上，这一块就空了
function errorOf(tile: JsonObject, children: readonly PreparedTile[], hasContent: boolean, where: string): number {
  if (children.length === 0) {
    return 0;
  }
  const error = tile.geometricError;
  if (typeof error !== 'number' || !Number.isFinite(error)) {
    throw new Error(`${where} 的 geometricError 不是数`);
  }
  return hasContent ? error : Math.max(error, ...children.map(child => child.geometricError));
}

function transformOf(tile: JsonObject, where: string): readonly number[] | undefined {
  const { transform } = tile;
  if (transform === undefined) {
    return undefined;
  }
  if (!isMatrix(transform)) {
    throw new Error(`${where} 的 transform 不是 16 个数`);
  }
  return transform;
}

// 引用瓦片的 transform 在外、外部根节点的在内，和 Cesium 加载外部索引时的层级相同；结果要写进 JSON，用普通数组
function composeTransform(
  outer: readonly number[] | undefined,
  inner: readonly number[] | undefined
): readonly number[] | undefined {
  if (outer && inner) {
    return Array.from(multiply(outer, inner));
  }
  return outer ?? inner;
}

// 把内层节点放到外层节点的位置（ADR 0148）：transform 相乘，refine 省略时沿用外层的，和 Cesium 按父节点继承一致
function hoist(outer: JsonObject, inner: PreparedTile, outerWhere: string, innerWhere: string): PreparedTile {
  const transform = composeTransform(transformOf(outer, outerWhere), transformOf(inner, innerWhere));
  const refine = inner.refine ?? outer.refine;
  return {
    ...without(inner, ['transform', 'refine']),
    geometricError: inner.geometricError,
    boundingVolume: inner.boundingVolume,
    ...(transform ? { transform } : {}),
    ...(refine === undefined ? {} : { refine })
  };
}

async function readTileset(url: string, context: Context): Promise<JsonObject> {
  const json = await context.load(url, context.signal);
  context.signal.throwIfAborted();
  if (!isObject(json)) {
    throw new Error(`${url} 不是 3D Tiles 索引`);
  }
  field(json, 'root', url);
  return json;
}

// 整理一个瓦片，返回放在它的位置上的节点：空占位为空，外部根节点没有内容时是它的子节点，其他情况一个；
// 索引的根（inline 为 false）总是一个节点
async function prepareTile(
  tile: JsonObject,
  source: string,
  ancestors: readonly string[],
  context: Context,
  inline: boolean
): Promise<readonly PreparedTile[]> {
  const where = `${source} 的瓦片`;
  const boundingVolume = field(tile, 'boundingVolume', where);
  const uri = contentUri(tile);
  const target = uri === undefined ? undefined : new URL(uri, source).href;
  if (target !== undefined && !target.startsWith(context.directory)) {
    if (isEmptyPlaceholder(tile)) {
      return [];
    }
    throw new Error(`瓦片引用超出数据目录：${uri ?? ''}`);
  }
  const rawChildren = Array.isArray(tile.children) ? tile.children : [];
  if (target !== undefined && new URL(target).pathname.endsWith('.json')) {
    // 3D Tiles 规定引用外部索引的瓦片不能有子节点：Cesium 遇到时的显示和可见判断对不上
    if (rawChildren.length > 0) {
      throw new Error(`${where} 引用了外部索引，不能再有子节点：${uri ?? ''}`);
    }
    if (ancestors.includes(target)) {
      throw new Error(`索引循环引用：${uri ?? ''}`);
    }
    const external = await readTileset(target, context);
    const rootWhere = `${target} 的瓦片`;
    const [root] = await prepareTile(field(external, 'root', target), target, [...ancestors, target], context, false);
    if (!root) {
      return [];
    }
    // Cesium 对外部索引总是走到它的根节点，引用瓦片自己不参与选择，所以根节点换到引用瓦片的位置
    const placed = hoist(tile, root, where, rootWhere);
    // 根节点没有内容时 Cesium 在它不细分期间继续画上一级，换上来的空节点做不到，改为换上它的子节点
    if (inline && !placed.content) {
      return (placed.children ?? []).map(child => hoist(placed, child, rootWhere, rootWhere));
    }
    return [placed];
  }
  // 子节点一起整理，按原来的顺序；循环引用按各自的祖先链判断，互不影响
  const prepared = await Promise.all(
    rawChildren.map(async child => {
      if (!isObject(child)) {
        throw new Error(`${where} 的子节点不是对象`);
      }
      return prepareTile(child, source, ancestors, context, true);
    })
  );
  const children = prepared.flat();
  const rest = without(tile, ['content', 'children', 'geometricError', 'boundingVolume']);
  // 内容地址统一写作 uri（旧版的 url 去掉）
  const content =
    target === undefined ? undefined : { ...without(isObject(tile.content) ? tile.content : {}, ['url']), uri: target };
  return [
    {
      ...rest,
      boundingVolume,
      geometricError: errorOf(tile, children, content !== undefined, where),
      ...(content ? { content } : {}),
      ...(children.length > 0 ? { children } : {})
    }
  ];
}

// 子节点的误差不超过父节点：旧项目的数据里有中间节点写着万米级的误差
function constrain(tile: PreparedTile, parentError: number): PreparedTile {
  const geometricError = Math.min(tile.geometricError, parentError);
  const children = tile.children?.map(child => constrain(child, geometricError));
  return { ...tile, geometricError, ...(children ? { children } : {}) };
}

/**
 * 读入并整理 3D Tiles 索引：外部索引的根节点换到引用它的位置、去掉数据目录外的空占位、拒绝目录外的引用和循环引用、
 * 修正几何误差，内容地址改成绝对地址；只读索引，不下载模型
 */
export async function prepareTileset(url: string, load: LoadJson, signal: AbortSignal): Promise<PreparedTileset> {
  const context: Context = { directory: new URL('.', url).href, load, signal };
  const json = await readTileset(url, context);
  const [root] = await prepareTile(field(json, 'root', url), url, [url], context, false);
  if (!root) {
    throw new Error(`${url} 的根节点是空占位`);
  }
  const constrained = constrain(root, root.geometricError);
  return { ...json, geometricError: constrained.geometricError, root: constrained };
}
