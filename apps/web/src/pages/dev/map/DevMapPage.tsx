import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { ElButton } from 'element-plus';
import type { CameraState, StyleGroup, ViewBounds } from '@yzt/map-core';
import { MapCanvas, provideMap } from '@yzt/map-vue';
import { defineComponent, ref } from 'vue';
import styles from './DevMapPage.module.scss';

const INITIAL_CAMERA: CameraState = { center: [119.4, 32.9], zoom: 6.5, bearing: 0, pitch: 0 };
const JIANGSU_BOUNDS: ViewBounds = [116.3, 30.7, 121.9, 35.2];
// 右侧留出一块，模拟悬浮面板；padding 只用于计算，不留在相机上
const FIT_PADDING = { top: 40, right: 360, bottom: 40, left: 40 };
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

    const map = provideMap({
      groups: ['background', 'regions', 'selection', 'highlight'],
      camera: INITIAL_CAMERA,
      onError: error => {
        errors.value = [...errors.value, describe(error)];
      }
    });

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
      }
    });

    const camera = map.useCamera();
    const { view, viewState } = map;

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
    const fitJiangsu = () => view.value?.fitBounds(JIANGSU_BOUNDS, { padding: FIT_PADDING, duration: 1000 });

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
                fitBounds 江苏（右侧留 360）
              </ElButton>
              <ElButton
                type={invalidLayer.value ? 'danger' : 'default'}
                onClick={() => (invalidLayer.value = !invalidLayer.value)}>
                {invalidLayer.value ? '去掉不合法的图层' : '提交不合法的图层'}
              </ElButton>
              <ElButton onClick={() => canvasKey.value++}>重新创建视图</ElButton>
              <ElButton disabled={errors.value.length === 0} onClick={() => (errors.value = [])}>
                清空错误
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
            </dl>
          </header>
          <MapCanvas key={canvasKey.value} class={styles.mapFrame} />
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
