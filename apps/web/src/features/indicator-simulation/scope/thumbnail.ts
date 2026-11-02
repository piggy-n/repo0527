import type { MultiPolygon } from 'geojson';

// 缩略图：范围的轮廓按外包框缩放到方框里，经度按中心纬度压缩，留一圈边（纯函数，ADR 0121）

/** SVG 路径：每个环一段，北在上 */
export function thumbnailPath(outline: MultiPolygon, size: number, margin = 0.12): string {
  const rings = outline.coordinates.flat();
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    for (const [lng = 0, lat = 0] of ring) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  if (!Number.isFinite(west)) {
    return '';
  }
  const cos = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const span = Math.max((east - west) * cos, north - south) || 1;
  const scale = (size * (1 - margin * 2)) / span;
  const centerX = (west + east) / 2;
  const centerY = (south + north) / 2;
  const x = (lng: number) => (size / 2 + (lng - centerX) * cos * scale).toFixed(1);
  const y = (lat: number) => (size / 2 - (lat - centerY) * scale).toFixed(1);
  return rings
    .map(ring => `M${ring.map(([lng = 0, lat = 0]) => `${x(lng)},${y(lat)}`).join('L')}Z`)
    .join('');
}
