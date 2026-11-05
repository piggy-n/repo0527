import {
  cumulativeDistances,
  geodesicArea,
  type LngLat,
  lineLength,
  type MeasureDraft,
  type MeasureKind,
  type MeasureState
} from '@yzt/map-core';

/** 地图上的一个测量标签；结果标签带关闭按钮，measurementId 是要删除的那一条 */
export interface MeasureLabel {
  readonly key: string;
  readonly lngLat: LngLat;
  /** 结果前面的说明，如"总长" */
  readonly caption?: string;
  readonly text: string;
  /** 测面的结果放在形心正中；其余放在节点旁边 */
  readonly centered?: boolean;
  readonly measurementId?: string;
}

// 取整后的整数加千分位
const INTEGER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** 距离（设计稿 5D.7）：不到 1 km 用米、取整，满 1 km 用 km、两位小数 */
export function formatDistance(meters: number): string {
  const rounded = Math.round(meters);
  return rounded < 1000 ? `${rounded} m` : `${(meters / 1000).toFixed(2)} km`;
}

/** 面积（设计稿 5D.7）：不到 1 km² 用 m²、取整加千分位，满 1 km² 用 km²、两位小数 */
export function formatArea(squareMeters: number): string {
  const rounded = Math.round(squareMeters);
  return rounded < 1_000_000 ? `${INTEGER.format(rounded)} m²` : `${(squareMeters / 1_000_000).toFixed(2)} km²`;
}

/** 节点离画布右边不到这么多像素时，标签放到节点左边 */
export const LABEL_FLIP_DISTANCE = 160;

/** 节点旁的标签放在哪一边：只看节点的位置，不量标签；还不知道画布宽度时放右边 */
export function labelSide(x: number, canvasWidth: number): 'right' | 'left' {
  return canvasWidth > 0 && x > canvasWidth - LABEL_FLIP_DISTANCE ? 'left' : 'right';
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

/** 推导标签（ADR 0035）：测距的中间节点显示累计距离、末点显示总长，测面在形心正中显示总面积；正在画的测距也显示中间节点 */
export function measureLabels({ measurements, draft }: MeasureState): MeasureLabel[] {
  const labels: MeasureLabel[] = [];
  for (const { id, kind, points, value } of measurements) {
    if (kind === 'distance') {
      labels.push(...segmentLabels(id, points), {
        key: `${id}-total`,
        lngLat: points.at(-1) as LngLat,
        caption: '总长',
        text: formatDistance(value),
        measurementId: id
      });
    } else {
      labels.push({
        key: `${id}-total`,
        lngLat: centroid(points),
        caption: '总面积',
        text: formatArea(value),
        centered: true,
        measurementId: id
      });
    }
  }
  if (draft?.kind === 'distance') {
    labels.push(...segmentLabels('draft', draft.points));
  }
  return labels;
}

/** 鼠标旁的提示：画的过程中第一行是数值，下面是操作说明 */
export interface MeasureHint {
  readonly value: string | null;
  readonly text: string;
}

// 正在画的这一条连同鼠标所在的点的数值；点不够时为 null
function draftValue({ kind, points, preview }: MeasureDraft): string | null {
  const all = preview ? [...points, preview] : points;
  if (kind === 'distance') {
    return all.length >= 2 ? `总长 ${formatDistance(lineLength(all))}` : null;
  }
  return all.length >= 3 ? `总面积 ${formatArea(geodesicArea(all))}` : null;
}

/** 鼠标旁的提示（设计稿 5D.7）：没在画时说明怎么开始；画的过程中写出含鼠标所在点的长度或面积 */
export function measureHint(kind: MeasureKind, draft: MeasureDraft | null): MeasureHint {
  if (draft?.kind !== kind) {
    return { value: null, text: `单击开始${kind === 'distance' ? '测距' : '测面'}` };
  }
  return { value: draftValue(draft), text: '单击添加节点，双击结束，Esc 取消' };
}
