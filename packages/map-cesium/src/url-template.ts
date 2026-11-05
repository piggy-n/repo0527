/** 三维影像图层的地址模板：多个子域名合成一个带 {s} 的模板 */
export interface TileUrlTemplate {
  readonly url: string;
  readonly subdomains: readonly string[];
}

// 三维只认 {z}、{x}、{y}；MapLibre 的 {quadkey}、{bbox-epsg-3857}、{ratio} 等不支持
const SUPPORTED_TOKENS = new Set(['{z}', '{x}', '{y}']);

function commonPrefixLength(urls: readonly string[]): number {
  const [first, ...rest] = urls;
  let length = 0;
  while (length < first.length && rest.every(url => url[length] === first[length])) {
    length++;
  }
  return length;
}

function commonSuffixLength(urls: readonly string[], limit: number): number {
  const [first, ...rest] = urls;
  let length = 0;
  while (length < limit && rest.every(url => url.at(-1 - length) === first.at(-1 - length))) {
    length++;
  }
  return length;
}

/**
 * MapLibre 数据源的 tiles 合成三维的地址模板（ADR 0079 第 7 节）：只有一个地址时原样使用；
 * 多个地址只差在同一处（如天地图的 t0～t7）时，这一处换成 {s}；差在不止一处时只用第一个地址。
 * 有三维不支持的占位符时返回 null
 */
export function tileUrlTemplate(tiles: readonly string[]): TileUrlTemplate | null {
  if (tiles.length === 0) {
    return null;
  }
  const tokens = tiles.flatMap(url => url.match(/\{[^}]*\}/g) ?? []);
  if (tokens.some(token => !SUPPORTED_TOKENS.has(token))) {
    return null;
  }
  if (new Set(tiles).size === 1) {
    return { url: tiles[0], subdomains: [] };
  }
  const prefix = commonPrefixLength(tiles);
  const shortest = Math.min(...tiles.map(url => url.length));
  const suffix = commonSuffixLength(tiles, shortest - prefix);
  const subdomains = tiles.map(url => url.slice(prefix, url.length - suffix));
  // 不同的那一段里不能含占位符或路径，否则不是子域名这种差别
  if (subdomains.some(part => part === '' || /[{}/]/.test(part))) {
    return { url: tiles[0], subdomains: [] };
  }
  return { url: `${tiles[0].slice(0, prefix)}{s}${tiles[0].slice(tiles[0].length - suffix)}`, subdomains };
}
