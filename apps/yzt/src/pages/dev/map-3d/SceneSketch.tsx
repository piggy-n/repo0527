import type { ScreenPoint, ViewKind } from '@yzt/map-core';
import { computed, defineComponent, onScopeDispose, type PropType, ref, shallowRef } from 'vue';
import { z } from 'zod';
import { useShownElementSize } from '@/shared/composables/useShownElementSize';
import cityUrl from '@/shared/map/boundary/data/jiangsu-city.json?url';
import provinceUrl from '@/shared/map/boundary/data/jiangsu-province.json?url';
import type { BasemapId } from '@/shared/map/basemap/basemap-style';
import { PointerHint } from '@/shared/map/pointer-hint/PointerHint';
import type { ModelEntry } from './model-samples';
import type { LoadStatus, ModelDemo } from './useModelDemo';
import styles from './SceneSketch.module.scss';

// 原型的示意画面：不是三维引擎，只把省界、市界投影到一个平面上，二维平铺、三维倾斜；模型画成立体块

const WIDTH = 1000;
const HEIGHT = 936;
const WEST = 116.35;
const NORTH = 35.15;
const SPAN_LNG = 5.6;
const SPAN_LAT = 4.4;
// 平面上 1 像素约合多少米（纬度 32° 附近）
const METERS_PER_PIXEL = 530;
// 示意时把高度放大，立体感明显一些
const HEIGHT_EXAGGERATION = 3;
const TILT_3D = 58;
// 透视与观察点；屏幕上的路线按同样的参数投影
const PERSPECTIVE = 1200;
const PERSPECTIVE_ORIGIN_Y = 0.45;

type Point = readonly [number, number];

function project([lng, lat]: readonly [number, number]): Point {
  return [((lng - WEST) / SPAN_LNG) * WIDTH, ((NORTH - lat) / SPAN_LAT) * HEIGHT];
}

// 抽稀：离上一个保留点不到 1 像素的点不要
function ringPath(ring: readonly (readonly number[])[]): string {
  const kept: Point[] = [];
  for (const [lng, lat] of ring) {
    const point = project([lng, lat]);
    const last = kept.at(-1);
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= 1) {
      kept.push(point);
    }
  }
  return `M${kept.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`;
}

const ring = z.array(z.array(z.number()).min(2));

// 只校验画轮廓用到的部分：要素的面或多面
const boundarySchema = z.object({
  features: z.array(
    z.object({
      geometry: z.discriminatedUnion('type', [
        z.object({ type: z.literal('Polygon'), coordinates: z.array(ring) }),
        z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ring)) })
      ])
    })
  )
});

async function loadPaths(url: string): Promise<string[]> {
  const response = await fetch(url);
  const { features } = boundarySchema.parse(await response.json());
  return features.map(({ geometry }) => {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.flatMap(polygon => polygon.map(ringPath)).join('');
  });
}

const pixels = (meters: number) => meters / METERS_PER_PIXEL;

// 示意时的高度（平面像素）：放大以后立体感明显一些
function modelRise(model: ModelEntry): number {
  return Math.max(0.6, pixels(model.height) * HEIGHT_EXAGGERATION);
}

function segmentLengths(points: readonly Point[]): number[] {
  return points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1]));
}

// 沿折线按路程的比例取点
function along(points: readonly Point[], progress: number): Point {
  const lengths = segmentLengths(points);
  let rest = lengths.reduce((sum, length) => sum + length, 0) * progress;
  for (const [index, length] of lengths.entries()) {
    if (rest <= length && length > 0) {
      const [x0, y0] = points[index];
      const [x1, y1] = points[index + 1];
      return [x0 + ((x1 - x0) * rest) / length, y0 + ((y1 - y0) * rest) / length];
    }
    rest -= length;
  }
  return points.at(-1) ?? [WIDTH / 2, HEIGHT / 2];
}

// 模型：五个面拼成的立体块，地下模型整体沉到地表以下
function renderModel({ model, status }: { model: ModelEntry; status: LoadStatus }) {
  const [x, y] = project(model.center);
  const size = Math.max(1.5, pixels(model.size));
  const rise = modelRise(model);
  const depth = model.underground ? -rise : 0;
  return (
    <div
      key={model.id}
      class={[styles.model, styles[model.kind], status === 'loading' && styles.loading]}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        width: `${size}px`,
        height: `${size}px`,
        '--rise': `${rise}px`,
        '--base': `${depth}px`
      }}
    >
      <div class={styles.top} />
      <div class={[styles.side, styles.north]} />
      <div class={[styles.side, styles.south]} />
      <div class={[styles.side, styles.east]} />
      <div class={[styles.side, styles.west]} />
    </div>
  );
}

// 名称牌正对屏幕、大小不变
function renderLabel({ model, status }: { model: ModelEntry; status: LoadStatus }) {
  const [x, y] = project(model.center);
  return (
    <div
      key={model.id}
      class={styles.label}
      style={{ left: `${x}px`, top: `${y}px`, '--top': `${model.underground ? 0 : modelRise(model)}px` }}
    >
      <span>
        {model.name}
        {status === 'loading' && '（加载中）'}
      </span>
    </div>
  );
}

// 走过的部分：起点、经过的途经点和当前位置
function passedPath(points: readonly Point[], progress: number): Point[] {
  const lengths = segmentLengths(points);
  let rest = lengths.reduce((sum, length) => sum + length, 0) * progress;
  const passed: Point[] = points.slice(0, 1);
  for (const [index, length] of lengths.entries()) {
    if (rest <= length) {
      break;
    }
    rest -= length;
    passed.push(points[index + 1]);
  }
  return [...passed, along(points, progress)];
}

interface Camera {
  readonly center: Point;
  /** 相对"整省放得下"的倍数 */
  readonly zoom: number;
}

/** 原型：示意的地图画面；状态全部来自演示拥有者，和左侧列表一致 */
export const SceneSketch = defineComponent({
  name: 'SceneSketch',
  props: {
    owner: { type: Object as PropType<ModelDemo>, required: true },
    dimension: { type: String as PropType<ViewKind>, required: true },
    basemap: { type: String as PropType<BasemapId>, required: true },
    /** 三维时选了点/框选：鼠标旁提示暂不支持，点击没有效果 */
    pickUnsupported: { type: Boolean, default: false }
  },
  setup(props) {
    const viewport = ref<HTMLElement>();
    const { width, height } = useShownElementSize(viewport);
    const province = shallowRef<string[]>([]);
    const cities = shallowRef<string[]>([]);
    const pointer = ref<ScreenPoint | null>(null);
    let disposed = false;
    onScopeDispose(() => {
      disposed = true;
    });
    const loadOutlines = async () => {
      const [outline, lines] = await Promise.all([loadPaths(provinceUrl), loadPaths(cityUrl)]);
      if (!disposed) {
        province.value = outline;
        cities.value = lines;
      }
    };
    void loadOutlines();

    const fit = computed(() => Math.min(width.value / WIDTH, height.value / HEIGHT) * 0.92 || 1);
    const three = computed(() => props.dimension === '3d');

    const routePoints = computed(() => {
      const route = props.owner.routeOf(props.owner.roam.value);
      return route ? route.path.map(project) : [];
    });

    const camera = computed((): Camera => {
      const { owner } = props;
      const roam = owner.roam.value;
      if (!three.value) {
        return { center: [WIDTH / 2, HEIGHT / 2], zoom: 1 };
      }
      if (roam.kind === 'route' && routePoints.value.length > 1) {
        return { center: along(routePoints.value, roam.progress), zoom: 90 };
      }
      const focused = owner.focus.value === null ? undefined : owner.model(owner.focus.value);
      if (focused) {
        const zoom = roam.kind === 'walk' ? 220 : Math.min(160, 220 / pixels(focused.size));
        return { center: project(focused.center), zoom };
      }
      return { center: [WIDTH / 2, HEIGHT / 2 + 40], zoom: 1.2 };
    });

    const planeStyle = computed(() => {
      const { center, zoom } = camera.value;
      const scale = fit.value * zoom;
      const tilt = three.value ? TILT_3D : 0;
      const playing = props.owner.roam.value.kind === 'route' && props.owner.roam.value.phase === 'playing';
      return {
        width: `${WIDTH}px`,
        height: `${HEIGHT}px`,
        transform:
          `translate(${width.value / 2}px, ${height.value / 2}px) rotateX(${tilt}deg) ` +
          `scale3d(${scale}, ${scale}, ${scale}) translate(${-center[0]}px, ${-center[1]}px)`,
        transition: playing ? 'none' : undefined,
        '--tilt': `${tilt}deg`,
        '--inverse-scale': String(1 / scale)
      };
    });

    const surfaceOpacity = computed(() => props.owner.underground.value?.opacity ?? 1);

    // 平面上的点投到屏幕：先平面的变换，再视口的透视；到了观察点背后的点不画
    const screenMatrix = computed(() => {
      const originX = width.value / 2;
      const originY = height.value * PERSPECTIVE_ORIGIN_Y;
      const perspective = new DOMMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1 / PERSPECTIVE, 0, 0, 0, 1]);
      return new DOMMatrix()
        .translate(originX, originY)
        .multiply(perspective)
        .translate(-originX, -originY)
        .multiply(new DOMMatrix(planeStyle.value.transform));
    });
    const toScreen = ([x, y]: Point): Point | null => {
      const point = screenMatrix.value.transformPoint(new DOMPoint(x, y, 0, 1));
      return point.w > 0 ? [point.x / point.w, point.y / point.w] : null;
    };
    const screenLine = (path: readonly Point[]) =>
      path
        .map(toScreen)
        .filter(point => point !== null)
        .map(point => point.join(','))
        .join(' ');

    const shown = computed(() =>
      three.value
        ? [...props.owner.loads.value]
            .filter(([, status]) => status !== 'failed')
            .map(([id, status]) => ({ model: props.owner.model(id), status }))
        : []
    );

    // 当前位置画在平面上；路线是细线，画在屏幕上（平面放大后细线会被低分辨率的栅格化抹掉）
    const renderViewer = () => {
      const points = routePoints.value;
      const roam = props.owner.roam.value;
      if (points.length < 2 || roam.kind !== 'route') {
        return null;
      }
      const [x, y] = along(points, roam.progress);
      return <div class={styles.viewer} style={{ left: `${x}px`, top: `${y}px` }} />;
    };

    const renderRoute = () => {
      const roam = props.owner.roam.value;
      const points = routePoints.value;
      if (points.length < 2 || roam.kind !== 'route') {
        return null;
      }
      return (
        <svg key={roam.routeId} class={styles.route} width={width.value} height={height.value} aria-hidden="true">
          <polyline class={styles.ahead} points={screenLine(points)} />
          <polyline class={styles.passed} points={screenLine(passedPath(points, roam.progress))} />
        </svg>
      );
    };

    const firstPerson = computed(() => {
      const roam = props.owner.roam.value;
      return roam.kind === 'walk' && roam.phase === 'walking';
    });

    const onPointerMove = (event: PointerEvent) => {
      if (!props.pickUnsupported || !viewport.value) {
        pointer.value = null;
        return;
      }
      const box = viewport.value.getBoundingClientRect();
      pointer.value = { x: event.clientX - box.left, y: event.clientY - box.top };
    };

    return () => (
      <div
        ref={viewport}
        class={[styles.viewport, styles[props.basemap], three.value && styles.three]}
        style={{ perspective: `${PERSPECTIVE}px`, perspectiveOrigin: `50% ${PERSPECTIVE_ORIGIN_Y * 100}%` }}
        onPointermove={onPointerMove}
        onPointerleave={() => (pointer.value = null)}
      >
        <div class={styles.plane} style={planeStyle.value}>
          <svg
            class={styles.surface}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            style={{ opacity: surfaceOpacity.value }}
            aria-hidden="true"
          >
            {province.value.map((path, index) => (
              <path key={index} class={styles.province} d={path} />
            ))}
            {cities.value.map((path, index) => (
              <path key={index} class={styles.city} d={path} />
            ))}
          </svg>
          {shown.value.map(renderModel)}
          {renderViewer()}
          {shown.value.map(renderLabel)}
        </div>
        {renderRoute()}
        {firstPerson.value && (
          <div class={styles.firstPerson} aria-hidden="true">
            <span class={styles.corridor} />
            <span class={styles.crosshair} />
            <span class={styles.caption}>第一人称画面（示意）</span>
          </div>
        )}
        {props.pickUnsupported && pointer.value && (
          <PointerHint
            point={pointer.value}
            canvas={{ width: width.value, height: height.value }}
            lines={['三维模式暂不支持点/框选', '切换到二维后使用']}
          />
        )}
      </div>
    );
  }
});
