// 3D Tiles 索引的整理（ADR 0081 第 3 节）：沿用旧项目 prepareLocalTileset 的规则，不依赖 Cesium

/** 下载一个 JSON；signal 中止时以它的原因结束 */
export type LoadJson = (url: string, signal: AbortSignal) => Promise<unknown>;

/** 整理后的瓦片节点：内容地址都是绝对地址，外部索引已经并进来 */
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

// 节点的误差：叶节点为 0（不用再细分，旧项目里错误的误差会让 Cesium 选不稳层级），没有内容的取子节点的最大值；
// 没有内容、下面都是叶节点的（白膜的根）保留自己的误差：取 0 时 Cesium 不再细分，什么也不画
function errorOf(tile: JsonObject, children: readonly PreparedTile[], hasContent: boolean, where: string): number {
  if (children.length === 0) {
    return 0;
  }
  if (!hasContent) {
    const fromChildren = Math.max(...children.map(child => child.geometricError));
    if (fromChildren > 0) {
      return fromChildren;
    }
  }
  const error = tile.geometricError;
  if (typeof error !== 'number' || !Number.isFinite(error)) {
    throw new Error(`${where} 的 geometricError 不是数`);
  }
  return error;
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

async function prepareTile(
  tile: JsonObject,
  source: string,
  ancestors: readonly string[],
  context: Context
): Promise<PreparedTile | null> {
  const where = `${source} 的瓦片`;
  field(tile, 'boundingVolume', where);
  const uri = contentUri(tile);
  const target = uri === undefined ? undefined : new URL(uri, source).href;
  if (target !== undefined && !target.startsWith(context.directory)) {
    if (isEmptyPlaceholder(tile)) {
      return null;
    }
    throw new Error(`瓦片引用超出数据目录：${uri ?? ''}`);
  }
  const rawChildren = Array.isArray(tile.children) ? tile.children : [];
  // 子节点一起整理，按原来的顺序；循环引用按各自的祖先链判断，互不影响
  const prepared = await Promise.all(
    rawChildren.map(async child => {
      if (!isObject(child)) {
        throw new Error(`${where} 的子节点不是对象`);
      }
      return prepareTile(child, source, ancestors, context);
    })
  );
  const children = prepared.filter(child => child !== null);
  const rest = without(tile, ['content', 'children', 'geometricError', 'boundingVolume']);
  const boundingVolume = field(tile, 'boundingVolume', where);
  if (target !== undefined && new URL(target).pathname.endsWith('.json')) {
    // 外部索引：读进来作为第一个子节点，自己不再有内容
    if (ancestors.includes(target)) {
      throw new Error(`索引循环引用：${uri ?? ''}`);
    }
    const external = await readTileset(target, context);
    const root = await prepareTile(field(external, 'root', target), target, [...ancestors, target], context);
    const merged = root ? [root, ...children] : children;
    return { ...rest, boundingVolume, geometricError: errorOf(tile, merged, false, where), children: merged };
  }
  // 内容地址统一写作 uri（旧版的 url 去掉）
  const content =
    target === undefined ? undefined : { ...without(isObject(tile.content) ? tile.content : {}, ['url']), uri: target };
  return {
    ...rest,
    boundingVolume,
    geometricError: errorOf(tile, children, content !== undefined, where),
    ...(content ? { content } : {}),
    ...(children.length > 0 ? { children } : {})
  };
}

// 子节点的误差不超过父节点：旧项目的数据里有中间节点写着万米级的误差
function constrain(tile: PreparedTile, parentError: number): PreparedTile {
  const geometricError = Math.min(tile.geometricError, parentError);
  const children = tile.children?.map(child => constrain(child, geometricError));
  return { ...tile, geometricError, ...(children ? { children } : {}) };
}

/**
 * 读入并整理 3D Tiles 索引：合并外部索引、去掉数据目录外的空占位、拒绝目录外的引用和循环引用、
 * 修正几何误差，内容地址改成绝对地址；只读索引，不下载模型
 */
export async function prepareTileset(url: string, load: LoadJson, signal: AbortSignal): Promise<PreparedTileset> {
  const context: Context = { directory: new URL('.', url).href, load, signal };
  const json = await readTileset(url, context);
  const root = await prepareTile(field(json, 'root', url), url, [url], context);
  if (!root) {
    throw new Error(`${url} 的根节点是空占位`);
  }
  const constrained = constrain(root, root.geometricError);
  return { ...json, geometricError: constrained.geometricError, root: constrained };
}
