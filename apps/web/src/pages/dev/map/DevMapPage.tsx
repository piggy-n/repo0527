import type { FilterSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { ElButton } from 'element-plus';
import type { CameraState, LngLat, MapTool, ScreenPoint, StyleGroup, ViewBounds } from '@yzt/map-core';
import { MapCanvas, type OverlayPadding, provideMap, useMap, useMapOverlay } from '@yzt/map-vue';
import { computed, defineComponent, type PropType, ref, shallowRef } from 'vue';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { MeasureOverlay } from '@/shared/map/measure/MeasureOverlay';
import { MEASURE_TOOL_IDS, useMeasure } from '@/shared/map/measure/useMeasure';
import styles from './DevMapPage.module.scss';

const INITIAL_CAMERA: CameraState = { center: [119.4, 32.9], zoom: 6.5, bearing: 0, pitch: 0 };
const JIANGSU_BOUNDS: ViewBounds = [116.3, 30.7, 121.9, 35.2];
const HIGHLIGHT_POSITIONS: readonly (readonly [number, number])[] = [
  [120.6, 31.3],
  [118.8, 32.05],
  [117.2, 34.2]
];
// 地图样式里的颜色是数据，交给 MapLibre 渲染，不走 CSS 令牌
const FILL_COLORS = ['#3a7bd5', '#e0703a'] as const;
// 模拟"引用方晚一轮才变"：选区的数据版本隔这么久才跟上
const LATE_SELECTION_DELAY = 800;

function box(name: string, [lng, lat]: readonly [number, number], size: number): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: { name },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [lng - size, lat - size],
          [lng + size, lat - size],
          [lng + size, lat + size],
          [lng - size, lat + size],
          [lng - size, lat - size]
        ]
      ]
    }
  };
}

// 两个数据版本：数据源 ID 带版本号，换版本时引用它的选区必须一起换（跨分组引用）
const DATA_VERSIONS = [0, 1] as const;
type DataVersion = (typeof DATA_VERSIONS)[number];

function regions(version: DataVersion): FeatureCollection<Polygon> {
  const size = version === 0 ? 0.35 : 0.5;
  return {
    type: 'FeatureCollection',
    features: [box('南京', [118.8, 32.05], size), box('苏州', [120.6, 31.3], size), box('徐州', [117.2, 34.2], size)]
  };
}

const regionSourceId = (version: DataVersion) => `regions-v${version}`;

// 每个版本的数据源对象保持同一个：只改样式时不会重新传数据
const REGION_SOURCES = DATA_VERSIONS.map(version => ({
  [regionSourceId(version)]: { type: 'geojson', data: regions(version) }
})) satisfies StyleGroup['sources'][];

const BACKGROUND_GROUP: StyleGroup = {
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef2f7' } }]
};

// 测量预览线的压力场景：接近资源图层数量的 200 个图层（ADR 0035 第 6 条）；对象固定，只在开关时提交
const STRESS_NAMES = ['南京', '苏州', '徐州'] as const;

function stressLayer(index: number): LayerSpecification {
  const id = `stress-${index}`;
  const filter: FilterSpecification = ['==', ['get', 'name'], STRESS_NAMES[index % STRESS_NAMES.length]];
  if (index % 2 === 0) {
    return {
      id,
      type: 'fill',
      source: 'stress',
      filter,
      paint: { 'fill-color': FILL_COLORS[0], 'fill-opacity': 0.02 }
    };
  }
  return {
    id,
    type: 'line',
    source: 'stress',
    filter,
    paint: { 'line-color': '#1f3f7f', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 12, 2] }
  };
}

const STRESS_GROUP: StyleGroup = {
  sources: { stress: { type: 'geojson', data: regions(0) } },
  layers: Array.from({ length: 200 }, (_, index) => stressLayer(index))
};

// 通不过 MapLibre 校验的图层：addLayer 只触发 error 事件、不抛错，整份样式也加载不了（ADR 0026）
const INVALID_LAYER = {
  id: 'regions-invalid',
  type: 'line',
  source: regionSourceId(0),
  paint: { 'line-width': 'wide' }
} as unknown as LayerSpecification;

interface RegionsState {
  readonly version: DataVersion;
  readonly colorIndex: number;
  readonly minzoom: number | undefined;
  readonly invalid: boolean;
}

function regionsGroup({ version, colorIndex, minzoom, invalid }: RegionsState): StyleGroup {
  const source = regionSourceId(version);
  return {
    sources: REGION_SOURCES[version],
    layers: [
      {
        id: 'regions-fill',
        type: 'fill',
        source,
        paint: { 'fill-color': FILL_COLORS[colorIndex % FILL_COLORS.length], 'fill-opacity': 0.5 },
        ...(minzoom === undefined ? {} : { minzoom })
      },
      { id: 'regions-outline', type: 'line', source, paint: { 'line-color': '#1f3f7f', 'line-width': 1.5 } },
      ...(invalid ? [{ ...INVALID_LAYER, source } as LayerSpecification] : [])
    ]
  };
}

// 选区引用区域分组的数据源，只描出南京
function selectionGroup(version: DataVersion): StyleGroup {
  return {
    sources: {},
    layers: [
      {
        id: 'selection-line',
        type: 'line',
        source: regionSourceId(version),
        filter: ['==', ['get', 'name'], '南京'],
        paint: { 'line-color': '#f5a623', 'line-width': 4 }
      }
    ]
  };
}

function highlightGroup(position: readonly [number, number] | undefined): StyleGroup {
  if (position === undefined) {
    return { sources: {}, layers: [] };
  }
  return {
    sources: {
      highlight: { type: 'geojson', data: { type: 'FeatureCollection', features: [box('高亮', position, 0.45)] } }
    },
    layers: [
      { id: 'highlight-line', type: 'line', source: 'highlight', paint: { 'line-color': '#ff3b30', 'line-width': 3 } }
    ]
  };
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.cause instanceof Error ? `${error.message}：${error.cause.message}` : error.message;
}

function formatCamera({ center: [lng, lat], zoom, bearing, pitch }: CameraState): string {
  return `${lng.toFixed(4)}, ${lat.toFixed(4)} · z${zoom.toFixed(2)} · 方位 ${bearing.toFixed(1)}° · 俯角 ${pitch.toFixed(1)}°`;
}

function formatPadding({ top, right, bottom, left }: OverlayPadding): string {
  return `上 ${top} · 右 ${right} · 下 ${bottom} · 左 ${left}`;
}

// 悬浮面板自己登记贴着右边：provideMap 所在的组件 inject 不到自己 provide 的值，登记要放在子组件里
const OverlayPanel = defineComponent({
  name: 'DevMapOverlayPanel',
  setup() {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'right');
    return () => (
      <aside ref={element} class={styles.overlayPanel}>
        悬浮面板：登记为贴右边，fitBounds 不传 padding 时避开它
      </aside>
    );
  }
});

// 坐标拾取的一次结果：点击的屏幕位置、拾取到的经纬度，以及立刻投影回屏幕时与点击位置的偏差（像素）
interface Probe {
  readonly point: ScreenPoint;
  readonly lngLat: LngLat;
  readonly roundTrip: number;
}

const PROBE_TOOL = 'probe';

// 坐标拾取（只在开发页用，ADR 0034 第 6 条）：十字光标、关掉双击放大；单击时拾取经纬度，再投影回屏幕核对
function createProbeTool(onProbe: (probe: Probe) => void): MapTool {
  return {
    persistent: false,
    cursor: 'crosshair',
    gestures: { doubleClickZoom: false },
    handleInput: (event, view) => {
      if (event.type !== 'click' || event.button !== 0) {
        return;
      }
      const result = view.pick(event.point);
      if (result.kind !== 'hit') {
        return;
      }
      const back = view.project(result.lngLat);
      const roundTrip = back ? Math.hypot(back.x - event.point.x, back.y - event.point.y) : Number.NaN;
      onProbe({ point: event.point, lngLat: result.lngLat, roundTrip });
    }
  };
}

function probeGroup(probes: readonly Probe[]): StyleGroup {
  if (probes.length === 0) {
    return { sources: {}, layers: [] };
  }
  return {
    sources: {
      probe: {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: probes.map(({ lngLat: [lng, lat] }) => ({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [lng, lat] }
          }))
        }
      }
    },
    layers: [
      {
        id: 'probe-point',
        type: 'circle',
        source: 'probe',
        paint: {
          'circle-radius': 5,
          'circle-color': '#ff3b30',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2
        }
      }
    ]
  };
}

function formatLngLat([lng, lat]: LngLat): string {
  return `${lng.toFixed(6)}, ${lat.toFixed(6)}`;
}

function formatProbe({ point: { x, y }, lngLat, roundTrip }: Probe): string {
  return `屏幕 (${x}, ${y}) → ${formatLngLat(lngLat)} · 回投偏差 ${roundTrip.toFixed(3)} px`;
}

// 最近一次拾取的标签：跟着相机用 project 放回屏幕，验证投影；视图没有就绪时不显示
const ProbeLabel = defineComponent({
  name: 'DevMapProbeLabel',
  props: {
    probe: { type: Object as PropType<Probe>, required: true }
  },
  setup(props) {
    const map = useMap();
    const position = computed(() => {
      void map.projectionRevision.value;
      const view = map.view.value;
      return map.viewState.value === 'ready' && view ? view.project(props.probe.lngLat) : null;
    });
    return () =>
      position.value && (
        <div class={styles.probeLabel} style={{ left: `${position.value.x}px`, top: `${position.value.y}px` }}>
          {formatLngLat(props.probe.lngLat)}
        </div>
      );
  }
});

// 模拟引擎失败：页面不能导入 maplibre-gl，抛普通的错误，原因按 unknown
function failingCreateMap(): never {
  throw new Error('模拟：创建地图失败');
}

/** 地图开发页：在真实的 MapLibre 上验证 map-core 和 map-vue，只在开发环境出现 */
export const DevMapPage = defineComponent({
  name: 'DevMapPage',
  setup() {
    const errors = ref<string[]>([]);
    const version = ref<DataVersion>(0);
    // 选区跟随的数据版本：正常情况下和 version 同一轮变化
    const selectionVersion = ref<DataVersion>(0);
    const selectionBroken = ref(false);
    const colorIndex = ref(0);
    const minzoom = ref<number>();
    const highlightIndex = ref<number>();
    const invalidLayer = ref(false);
    // 换 key 重新创建画布，也就重新创建了视图
    const canvasKey = ref(0);
    const overlayVisible = ref(true);
    // 打开后，下一次创建视图（重新创建、重试）时创建地图失败，模拟引擎失败
    const failNextCreation = ref(false);
    const lastPadding = ref<OverlayPadding>();
    const probes = shallowRef<readonly Probe[]>([]);
    const stress = ref(false);

    const map = provideMap({
      groups: ['background', 'regions', 'stress', 'selection', 'highlight', 'probe', 'measure'],
      camera: INITIAL_CAMERA,
      onError: error => {
        errors.value = [...errors.value, describe(error)];
      }
    });

    const measure = useMeasure();
    map.registerTools(measure.tools);

    map.bindStyle({
      background: () => BACKGROUND_GROUP,
      regions: () =>
        regionsGroup({
          version: version.value,
          colorIndex: colorIndex.value,
          minzoom: minzoom.value,
          invalid: invalidLayer.value
        }),
      selection: () => {
        if (selectionBroken.value) {
          throw new Error('选区的推导出错（模拟）');
        }
        return selectionGroup(selectionVersion.value);
      },
      highlight: () => {
        const index = highlightIndex.value;
        return highlightGroup(index === undefined ? undefined : HIGHLIGHT_POSITIONS[index]);
      },
      stress: () => (stress.value ? STRESS_GROUP : { sources: {}, layers: [] }),
      probe: () => probeGroup(probes.value),
      measure: measure.deriveGroup
    });

    // 只保留最近 5 次拾取
    map.registerTools({ [PROBE_TOOL]: createProbeTool(probe => (probes.value = [...probes.value.slice(-4), probe])) });

    const camera = map.useCamera();
    const { view, viewState, activeTool } = map;
    const toggleTool = (id: string) => (activeTool.value === id ? map.releaseTool(id) : map.activateTool(id));

    const nextVersion = (): DataVersion => (version.value === 0 ? 1 : 0);

    // 区域和选区在同一轮变化，一次提交
    const switchVersion = () => {
      const next = nextVersion();
      version.value = next;
      selectionVersion.value = next;
    };

    // 选区晚一轮才跟上：第一轮提交被拒绝并报告，地图保持原样，跟上之后两者一起提交
    const switchVersionLate = () => {
      const next = nextVersion();
      version.value = next;
      setTimeout(() => (selectionVersion.value = next), LATE_SELECTION_DELAY);
    };

    const flyToNanjing = () => view.value?.flyTo({ center: [118.8, 32.05], zoom: 9 }, { duration: 1500 });
    // 不传 padding：自动避开登记过的悬浮元素（ADR 0029），这里另外记下这次算出的值
    const fitJiangsu = () => {
      lastPadding.value = map.overlayPadding();
      view.value?.fitBounds(JIANGSU_BOUNDS, { duration: 1000 });
    };

    const lastProbe = computed(() => probes.value.at(-1));

    const toggleHighlight = () => {
      highlightIndex.value = ((highlightIndex.value ?? -1) + 1) % HIGHLIGHT_POSITIONS.length;
    };

    return () => {
      const ready = viewState.value === 'ready';
      return (
        <div class={styles.root}>
          <header class={styles.toolbar}>
            <div class={styles.actions}>
              <ElButton onClick={() => colorIndex.value++}>切换颜色</ElButton>
              <ElButton onClick={() => (minzoom.value = minzoom.value === undefined ? 7 : undefined)}>
                {minzoom.value === undefined ? '加上 minzoom 7' : '去掉 minzoom'}
              </ElButton>
              <ElButton onClick={toggleHighlight}>{highlightIndex.value === undefined ? '高亮' : '移动高亮'}</ElButton>
              <ElButton
                disabled={highlightIndex.value === undefined}
                onClick={() => (highlightIndex.value = undefined)}>
                清除高亮
              </ElButton>
              <ElButton onClick={switchVersion}>切换数据版本</ElButton>
              <ElButton onClick={switchVersionLate}>切换数据版本（选区晚一轮）</ElButton>
              <ElButton
                type={selectionBroken.value ? 'danger' : 'default'}
                onClick={() => (selectionBroken.value = !selectionBroken.value)}>
                {selectionBroken.value ? '修好选区的推导' : '让选区的推导出错'}
              </ElButton>
              <ElButton disabled={!ready} onClick={flyToNanjing}>
                flyTo 南京
              </ElButton>
              <ElButton disabled={!ready} onClick={fitJiangsu}>
                fitBounds 江苏（避开悬浮面板）
              </ElButton>
              <ElButton
                type={invalidLayer.value ? 'danger' : 'default'}
                onClick={() => (invalidLayer.value = !invalidLayer.value)}>
                {invalidLayer.value ? '去掉不合法的图层' : '提交不合法的图层'}
              </ElButton>
              <ElButton onClick={() => (overlayVisible.value = !overlayVisible.value)}>
                {overlayVisible.value ? '隐藏悬浮面板' : '显示悬浮面板'}
              </ElButton>
              <ElButton onClick={() => canvasKey.value++}>重新创建视图</ElButton>
              <ElButton
                type={failNextCreation.value ? 'danger' : 'default'}
                onClick={() => (failNextCreation.value = !failNextCreation.value)}>
                {failNextCreation.value ? '取消模拟引擎失败' : '下次创建视图时模拟引擎失败'}
              </ElButton>
              <ElButton disabled={errors.value.length === 0} onClick={() => (errors.value = [])}>
                清空错误
              </ElButton>
              <ElButton
                type={activeTool.value === PROBE_TOOL ? 'primary' : 'default'}
                onClick={() => toggleTool(PROBE_TOOL)}>
                {activeTool.value === PROBE_TOOL ? '退出坐标拾取（或按 Esc）' : '坐标拾取'}
              </ElButton>
              <ElButton disabled={probes.value.length === 0} onClick={() => (probes.value = [])}>
                清除拾取点
              </ElButton>
              <ElButton
                type={activeTool.value === MEASURE_TOOL_IDS.distance ? 'primary' : 'default'}
                onClick={() => toggleTool(MEASURE_TOOL_IDS.distance)}>
                测距
              </ElButton>
              <ElButton onClick={() => (stress.value = !stress.value)}>
                {stress.value ? '去掉 200 个图层' : '加上 200 个图层'}
              </ElButton>
            </div>
            <dl class={styles.status} data-view-state={viewState.value}>
              <dt>视图</dt>
              <dd>{viewState.value}</dd>
              <dt>会话相机</dt>
              <dd data-camera>{formatCamera(camera.value)}</dd>
              <dt>数据版本</dt>
              <dd data-version>
                区域 v{version.value} · 选区 v{selectionVersion.value}
              </dd>
              <dt>定位 padding</dt>
              <dd data-padding>{lastPadding.value ? formatPadding(lastPadding.value) : '-'}</dd>
              <dt>当前工具</dt>
              <dd data-tool>{activeTool.value}</dd>
              <dt>最近拾取</dt>
              <dd data-probe>{lastProbe.value ? formatProbe(lastProbe.value) : '-'}</dd>
            </dl>
          </header>
          <div class={styles.mapArea}>
            <MapCanvas key={canvasKey.value} createMap={failNextCreation.value ? failingCreateMap : undefined} />
            {overlayVisible.value && <OverlayPanel />}
            {lastProbe.value && <ProbeLabel probe={lastProbe.value} />}
            <MeasureOverlay measure={measure} />
            <MapStatusNotice />
          </div>
          {errors.value.length > 0 && (
            <ul class={styles.errors}>
              {errors.value.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      );
    };
  }
});
