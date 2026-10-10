import { cumulativeDistances, type LngLat, type MeasureKind, type MeasureState } from '@yzt/map-core';

/** 地图上的一个测量标签；结果标签带关闭按钮，measurementId 是要删除的那一条 */
export interface MeasureLabel {
  readonly key: string;
  readonly lngLat: LngLat;
  readonly text: string;
  readonly measurementId?: string;
}

/** 距离：沿用旧项目，固定用 km、两位小数 */
export function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(2)} km`;
}

/** 面积：沿用旧项目，满 1 km² 用 km²，否则用 m²，两位小数 */
export function formatArea(squareMeters: number): string {
  return squareMeters >= 1_000_000 ? `${(squareMeters / 1_000_000).toFixed(2)} km²` : `${squareMeters.toFixed(2)} m²`;
}

/** 多边形的形心，按经纬度平面近似（只用来放标签）；面积为 0 时取各顶点的平均 */
export function centroid(points: readonly LngLat[]): LngLat {
  // 以第一个顶点为原点计算，避免经纬度的绝对值很大时叉积相减损失精度
  const [originLng, originLat] = points[0];
  const local = points.map(([lng, lat]) => [lng - originLng, lat - originLat] as const);
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  local.forEach(([x1, y1], index) => {
    const [x2, y2] = local[(index + 1) % local.length];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
  });
  if (twiceArea === 0) {
    const count = local.length;
    const sumX = local.reduce((sum, [lng]) => sum + lng, 0);
    const sumY = local.reduce((sum, [, lat]) => sum + lat, 0);
    return [originLng + sumX / count, originLat + sumY / count];
  }
  return [originLng + x / (3 * twiceArea), originLat + y / (3 * twiceArea)];
}

// 中间节点（不含起点和末点）的累计距离
function segmentLabels(key: string, points: readonly LngLat[]): MeasureLabel[] {
  const distances = cumulativeDistances(points);
  return points.slice(1, -1).map((lngLat, index) => ({
    key: `${key}-${index + 1}`,
    lngLat,
    text: formatDistance(distances[index + 1])
  }));
}

/** 推导标签（ADR 0035）：测距的中间节点显示累计距离、末点显示总长，测面在形心显示总面积；正在画的测距也显示中间节点 */
export function measureLabels({ measurements, draft }: MeasureState): MeasureLabel[] {
  const labels: MeasureLabel[] = [];
  for (const { id, kind, points, value } of measurements) {
    if (kind === 'distance') {
      labels.push(...segmentLabels(id, points), {
        key: `${id}-total`,
        lngLat: points.at(-1) as LngLat,
        text: `总长 ${formatDistance(value)}`,
        measurementId: id
      });
    } else {
      labels.push({
        key: `${id}-total`,
        lngLat: centroid(points),
        text: `总面积 ${formatArea(value)}`,
        measurementId: id
      });
    }
  }
  if (draft?.kind === 'distance') {
    labels.push(...segmentLabels('draft', draft.points));
  }
  return labels;
}

/** 鼠标旁的提示（沿用旧项目的文案） */
export function measureHint(kind: MeasureKind, drawing: boolean): string {
  const name = kind === 'distance' ? '测距' : '测面';
  return drawing ? `单击添加节点，双击结束${name}` : `单击开始${name}`;
}
