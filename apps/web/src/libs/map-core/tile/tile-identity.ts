/** 瓦片坐标始终采用 XYZ，TMS 只影响下载地址 */
export interface TileCoordinate {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

/** 会改变瓦片内容的身份，不能用临时鉴权头代替权限范围 */
export interface TileDataSource {
  readonly tiles: readonly string[];
  readonly dataVersion: string;
  readonly permissionScope: string;
  readonly scheme?: 'xyz' | 'tms';
}

/** 检查坐标范围，使用算术而非 32 位移位处理父瓦片 */
function validateCoordinate({ z, x, y }: TileCoordinate): void {
  if (!Number.isInteger(z) || z < 0 || z > 30 ||
    !Number.isInteger(x) || x < 0 || x >= 2 ** z ||
    !Number.isInteger(y) || y < 0 || y >= 2 ** z) {
    throw new RangeError('瓦片坐标必须是 0～30 级内的有效 XYZ 整数');
  }
}

/** 同一原生父瓦片的全部显示子瓦片共享下载、解码和 Worker 归属 */
export function nativeTileCoordinate(tile: TileCoordinate, maximumLevel: number): TileCoordinate {
  validateCoordinate(tile);
  if (!Number.isInteger(maximumLevel) || maximumLevel < 0 || maximumLevel > 30) {
    throw new RangeError('原生瓦片最大级别必须是 0～30 的整数');
  }
  const z = Math.min(tile.z, maximumLevel);
  const divisor = 2 ** (tile.z - z);
  return { z, x: Math.floor(tile.x / divisor), y: Math.floor(tile.y / divisor) };
}

/** 字段并集按数据源身份登记，模板数组顺序也是分片规则的一部分 */
export function tileSourceKey(source: TileDataSource): string {
  if (!source.tiles.length || source.tiles.some(tile => typeof tile !== 'string' || !tile.trim()) ||
    typeof source.dataVersion !== 'string' || typeof source.permissionScope !== 'string' ||
    (source.scheme !== undefined && source.scheme !== 'xyz' && source.scheme !== 'tms')) {
    throw new TypeError('瓦片数据源需要地址模板、数据版本和权限范围');
  }
  return JSON.stringify([source.tiles, source.scheme ?? 'xyz', source.dataVersion, source.permissionScope]);
}

/** 缓存和 Worker 分片共用完整身份，实际请求选中的域名不另作键 */
export function tileDataKey(source: TileDataSource, coordinate: TileCoordinate): string {
  validateCoordinate(coordinate);
  return JSON.stringify([tileSourceKey(source), coordinate.z, coordinate.x, coordinate.y]);
}
