import { computed, defineComponent, type PropType } from 'vue';
import type { ModelDemo } from './useModelDemo';
import styles from './MinimapSketch.module.scss';

// 原型（2026-10-28）：右上角小地图的示意，真实的小地图见 /dev/nav-grid（ADR 0087）。步行时人在中间；
// 路线漫游时画出整条路线、走过的一段加深，人沿路线移动

const SIZE = 180;
const PADDING = 24;

type Point = readonly [number, number];

// 经纬度换成以第一个点为原点的米，再放进小地图（北在上）
function fit(path: readonly (readonly [number, number])[]): Point[] {
  const [origin] = path;
  if (!origin) {
    return [];
  }
  const metersPerLng = 111320 * Math.cos((origin[1] * Math.PI) / 180);
  const meters = path.map(([lng, lat]): Point => [(lng - origin[0]) * metersPerLng, (lat - origin[1]) * 110540]);
  const xs = meters.map(([x]) => x);
  const ys = meters.map(([, y]) => y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  const scale = (SIZE - PADDING * 2) / span;
  const [left, top] = [Math.min(...xs), Math.max(...ys)];
  return meters.map(([x, y]) => [PADDING + (x - left) * scale, PADDING + (top - y) * scale]);
}

function lengths(points: readonly Point[]): number[] {
  return points.slice(1).map((point, index) => {
    const previous = points[index] ?? point;
    return Math.hypot(point[0] - previous[0], point[1] - previous[1]);
  });
}

// 路线上走到 progress（0～1）的位置，和到那里为止的折线
function walkAlong(points: readonly Point[], progress: number): { at: Point; passed: Point[] } {
  const segments = lengths(points);
  let left = segments.reduce((sum, item) => sum + item, 0) * progress;
  const passed: Point[] = points.slice(0, 1);
  for (const [index, segment] of segments.entries()) {
    const from = points[index];
    const to = points[index + 1];
    if (!from || !to) {
      break;
    }
    if (left <= segment) {
      const ratio = segment === 0 ? 0 : left / segment;
      const at: Point = [from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio];
      return { at, passed: [...passed, at] };
    }
    left -= segment;
    passed.push(to);
  }
  const last = points.at(-1) ?? [SIZE / 2, SIZE / 2];
  return { at: last, passed };
}

const line = (points: readonly Point[]) => points.map(point => point.join(',')).join(' ');

/** 原型：漫游时右上角的小地图，步行和路线都显示 */
export const MinimapSketch = defineComponent({
  name: 'MinimapSketch',
  props: {
    owner: { type: Object as PropType<ModelDemo>, required: true }
  },
  setup(props) {
    const routePoints = computed(() => {
      const route = props.owner.routeOf(props.owner.roam.value);
      return route ? fit(route.path) : [];
    });

    return () => {
      const roam = props.owner.roam.value;
      const points = routePoints.value;
      const position = roam.kind === 'route' && points.length > 1 ? walkAlong(points, roam.progress) : null;
      const [x, y] = position?.at ?? [SIZE / 2, SIZE / 2];
      return (
        <div class={styles.root} title="点击打开完整地图（原型不演示）" data-minimap-sketch>
          <svg class={styles.map} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
            <rect class={styles.hall} x="14" y="40" width="152" height="70" rx="4" />
            <rect class={styles.room} x="24" y="118" width="60" height="44" rx="3" />
            <rect class={styles.platform} x="96" y="118" width="62" height="44" rx="3" />
            {points.length > 1 && <polyline class={styles.ahead} points={line(points)} />}
            {position && <polyline class={styles.passed} points={line(position.passed)} />}
            <g transform={`translate(${x} ${y})`}>
              <path class={styles.cone} d="M0 0 L-16 -26 A30 30 0 0 1 16 -26 Z" />
              <path class={styles.player} d="M0 -7 L5 6 L0 3 L-5 6 Z" />
            </g>
          </svg>
          <span class={styles.floor}>-2F · 北↑</span>
          <span class={styles.scale}>
            <i />
            10 m
          </span>
          <span class={styles.zoom}>
            <button type="button" aria-label="放大小地图">
              +
            </button>
            <button type="button" aria-label="缩小小地图">
              −
            </button>
          </span>
        </div>
      );
    };
  }
});
