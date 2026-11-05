import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, MultiPolygon, Position } from 'geojson';
import type { LngLat, ScreenPoint, StyleGroup } from '@mx/map-core';

// 逐点编辑的纯函数（ADR 0122）：找按到的节点、移动、插入、删除，以及编辑用的样式分组

/** 一个节点：第几个面、第几个环、环里的第几个点（不含重复的首尾点） */
export interface VertexRef {
  readonly part: number;
  readonly ring: number;
  readonly index: number;
}

/** 节点或边的中点；拖动中点会在这条边上插入一个节点 */
export interface Handle {
  readonly kind: 'vertex' | 'middle';
  readonly ref: VertexRef;
  readonly position: LngLat;
}

/** 按到手柄的距离（像素） */
export const HANDLE_RADIUS = 8;

const sameRef = (a: VertexRef, b: VertexRef): boolean => a.part === b.part && a.ring === b.ring && a.index === b.index;

/** 节点和边的中点：中点的 ref 是这条边起点的节点 */
export function handlesOf(geometry: MultiPolygon): Handle[] {
  const handles: Handle[] = [];
  geometry.coordinates.forEach((rings, part) =>
    rings.forEach((ring, ringIndex) => {
      const count = ring.length - 1;
      for (let index = 0; index < count; index++) {
        const [x1 = 0, y1 = 0] = ring[index] ?? [];
        const [x2 = 0, y2 = 0] = ring[index + 1] ?? [];
        const ref = { part, ring: ringIndex, index };
        handles.push(
          { kind: 'vertex', ref, position: [x1, y1] },
          { kind: 'middle', ref, position: [(x1 + x2) / 2, (y1 + y2) / 2] }
        );
      }
    })
  );
  return handles;
}

/** 屏幕上离这一点最近、在 radius 像素以内的手柄；范围内有节点时只选节点（缩小后中点和节点挤在一起） */
export function handleAt(
  handles: readonly Handle[],
  point: ScreenPoint,
  project: (lngLat: LngLat) => ScreenPoint | null,
  radius = HANDLE_RADIUS
): Handle | null {
  const best: Partial<Record<Handle['kind'], { handle: Handle; distance: number }>> = {};
  for (const handle of handles) {
    const screen = project(handle.position);
    if (!screen) {
      continue;
    }
    const distance = Math.hypot(screen.x - point.x, screen.y - point.y);
    const current = best[handle.kind];
    if (distance <= radius && (!current || distance < current.distance)) {
      best[handle.kind] = { handle, distance };
    }
  }
  return (best.vertex ?? best.middle)?.handle ?? null;
}

// 复制一个环并改写：fn 收到不含首尾重复点的节点，返回新的节点，再闭合
function withRing(
  geometry: MultiPolygon,
  { part, ring }: VertexRef,
  fn: (points: Position[]) => Position[]
): MultiPolygon {
  const coordinates = geometry.coordinates.map((rings, p) =>
    rings.map((points, r) => {
      if (p !== part || r !== ring) {
        return points;
      }
      const next = fn(points.slice(0, -1).map(([x = 0, y = 0]) => [x, y]));
      const [first] = next;
      return first ? [...next, [...first]] : next;
    })
  );
  return { type: 'MultiPolygon', coordinates };
}

/** 把节点移到 lngLat */
export function moveVertex(geometry: MultiPolygon, ref: VertexRef, [lng, lat]: LngLat): MultiPolygon {
  return withRing(geometry, ref, points => points.map((point, index) => (index === ref.index ? [lng, lat] : point)));
}

/** 在 ref 这个节点之后插入一个节点；返回新的范围和新节点 */
export function insertVertex(
  geometry: MultiPolygon,
  ref: VertexRef,
  [lng, lat]: LngLat
): { readonly geometry: MultiPolygon; readonly ref: VertexRef } {
  const { index } = ref;
  const next = withRing(geometry, ref, points => points.toSpliced(index + 1, 0, [lng, lat]));
  return { geometry: next, ref: { ...ref, index: index + 1 } };
}

/** 删除节点；环只剩 3 个节点时不能再删，返回 null */
export function removeVertex(geometry: MultiPolygon, ref: VertexRef): MultiPolygon | null {
  const ring = geometry.coordinates[ref.part]?.[ref.ring];
  if (!ring || ring.length - 1 <= 3) {
    return null;
  }
  return withRing(geometry, ref, points => points.filter((_, index) => index !== ref.index));
}

/** 编辑的状态：拖动中的范围（拖完才交出去）、按住的、悬停的、选中的节点 */
export interface EditState {
  readonly preview: MultiPolygon | null;
  readonly hovered: Handle | null;
  readonly selected: VertexRef | null;
}

const SOURCE = 'shape-edit';
// 同绘制的颜色；地图样式里的颜色是数据，不走 CSS 令牌
const EDIT_COLOR = '#597EF7';

const LAYERS: readonly LayerSpecification[] = [
  {
    id: `${SOURCE}-preview`,
    type: 'line',
    source: SOURCE,
    filter: ['==', ['get', 'kind'], 'preview'],
    paint: { 'line-color': EDIT_COLOR, 'line-width': 2, 'line-dasharray': [2, 2] }
  },
  {
    id: `${SOURCE}-middle`,
    type: 'circle',
    source: SOURCE,
    filter: ['==', ['get', 'kind'], 'middle'],
    paint: {
      'circle-radius': ['case', ['get', 'hovered'], 5, 3.5],
      'circle-color': '#FFFFFF',
      'circle-stroke-color': EDIT_COLOR,
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': 0.7
    }
  },
  {
    id: `${SOURCE}-vertex`,
    type: 'circle',
    source: SOURCE,
    filter: ['==', ['get', 'kind'], 'vertex'],
    paint: {
      'circle-radius': ['case', ['any', ['get', 'hovered'], ['get', 'selected']], 6, 4.5],
      'circle-color': ['case', ['get', 'selected'], EDIT_COLOR, '#FFFFFF'],
      'circle-stroke-color': EDIT_COLOR,
      'circle-stroke-width': 2
    }
  }
];

const EMPTY_GROUP: StyleGroup = Object.freeze({ sources: Object.freeze({}), layers: Object.freeze([]) });

/** 逐点编辑的样式分组（分组名 shape-edit）：节点、边的中点，拖动时的范围是虚线；没有在编辑时为空分组 */
export function editGroup(geometry: MultiPolygon | null, state: EditState): StyleGroup {
  if (!geometry) {
    return EMPTY_GROUP;
  }
  const shown = state.preview ?? geometry;
  const features: Feature[] = handlesOf(shown).map(({ kind, ref, position }) => ({
    type: 'Feature',
    properties: {
      kind,
      hovered: state.hovered !== null && state.hovered.kind === kind && sameRef(state.hovered.ref, ref),
      selected: kind === 'vertex' && state.selected !== null && sameRef(state.selected, ref)
    },
    geometry: { type: 'Point', coordinates: [...position] }
  }));
  if (state.preview) {
    features.unshift({ type: 'Feature', properties: { kind: 'preview' }, geometry: state.preview });
  }
  return {
    sources: { [SOURCE]: { type: 'geojson', data: { type: 'FeatureCollection', features } } },
    layers: LAYERS
  };
}
