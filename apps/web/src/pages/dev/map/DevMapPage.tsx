import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { ElButton } from 'element-plus';
import {
  type CameraState,
  MapLibreView,
  MapSession,
  type StyleGroup,
  type ViewBounds,
  type ViewState
} from '@yzt/map-core';
import { defineComponent, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import styles from './DevMapPage.module.scss';

type Groups = 'background' | 'regions' | 'highlight';

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

const REGIONS: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [box('南京', [118.8, 32.05], 0.35), box('苏州', [120.6, 31.3], 0.35), box('徐州', [117.2, 34.2], 0.35)]
};

const EMPTY_GROUP: StyleGroup = { sources: {}, layers: [] };

const BACKGROUND_GROUP: StyleGroup = {
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef2f7' } }]
};

// 数据源对象保持同一个：只改样式时不会重新传数据
const REGIONS_SOURCES: StyleGroup['sources'] = { regions: { type: 'geojson', data: REGIONS } };

// 通不过 MapLibre 校验的图层：addLayer 只触发 error 事件、不抛错，整份样式也加载不了（ADR 0026）
const INVALID_LAYER = {
  id: 'regions-invalid',
  type: 'line',
  source: 'regions',
  paint: { 'line-width': 'wide' }
} as unknown as LayerSpecification;

function regionsGroup(colorIndex: number, minzoom: number | undefined, invalid = false): StyleGroup {
  return {
    sources: REGIONS_SOURCES,
    layers: [
      {
        id: 'regions-fill',
        type: 'fill',
        source: 'regions',
        paint: { 'fill-color': FILL_COLORS[colorIndex % FILL_COLORS.length], 'fill-opacity': 0.5 },
        ...(minzoom === undefined ? {} : { minzoom })
      },
      { id: 'regions-outline', type: 'line', source: 'regions', paint: { 'line-color': '#1f3f7f', 'line-width': 1.5 } },
      ...(invalid ? [INVALID_LAYER] : [])
    ]
  };
}

function highlightGroup(position: readonly [number, number]): StyleGroup {
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
  return error instanceof Error ? error.message : String(error);
}

function formatCamera({ center: [lng, lat], zoom, bearing, pitch }: CameraState): string {
  return `${lng.toFixed(4)}, ${lat.toFixed(4)} · z${zoom.toFixed(2)} · 方位 ${bearing.toFixed(1)}° · 俯角 ${pitch.toFixed(1)}°`;
}

/** 地图开发页：在真实的 MapLibre 上验证 map-core，只在开发环境出现 */
export const DevMapPage = defineComponent({
  name: 'DevMapPage',
  setup() {
    const container = ref<HTMLElement>();
    const viewState = ref<ViewState>('initializing');
    const camera = shallowRef<CameraState>(INITIAL_CAMERA);
    const intentRevision = ref(0);
    const styleVersion = ref(0);
    const errors = ref<string[]>([]);
    const paused = ref(false);
    const colorIndex = ref(0);
    const minzoom = ref<number>();
    const highlightIndex = ref<number>();
    const invalidLayer = ref(false);

    // 地图对象不放进响应式状态：Vue 的代理会包住 MapLibre 内部对象，只把要显示的值放进 ref
    const stack = new DisposableStack();
    let session: MapSession<Groups> | undefined;
    let view: MapLibreView<Groups> | undefined;
    // 视图可以单独重新创建，它的订阅登记在自己的栈里
    let viewStack: DisposableStack | undefined;

    const commitRegions = () => {
      session?.style.setGroup('regions', regionsGroup(colorIndex.value, minzoom.value, invalidLayer.value));
    };

    const createView = () => {
      viewStack?.dispose();
      if (container.value === undefined || session === undefined) {
        return;
      }
      const created = new DisposableStack();
      viewStack = created;
      paused.value = false;
      view = created.use(
        new MapLibreView({
          session,
          container: container.value,
          onError: error => {
            errors.value = [...errors.value, describe(error)];
          }
        })
      );
      viewState.value = view.state;
      created.defer(
        view.on('statechange', state => {
          viewState.value = state;
        })
      );
    };

    onMounted(() => {
      session = stack.use(new MapSession({ groups: ['background', 'regions', 'highlight'], camera: INITIAL_CAMERA }));
      const created = session;
      // 先于会话释放
      stack.defer(() => viewStack?.dispose());
      createView();
      stack.defer(
        created.camera.on('change', ({ state }) => {
          camera.value = state;
          intentRevision.value = created.camera.intentRevision;
        })
      );
      stack.defer(
        created.style.on('change', ({ toVersion }) => {
          styleVersion.value = toVersion;
        })
      );
      created.style.setGroups({
        background: BACKGROUND_GROUP,
        regions: regionsGroup(colorIndex.value, minzoom.value, invalidLayer.value)
      });
    });

    onUnmounted(() => {
      stack.dispose();
    });

    const toggleColor = () => {
      colorIndex.value++;
      commitRegions();
    };

    const toggleMinzoom = () => {
      minzoom.value = minzoom.value === undefined ? 7 : undefined;
      commitRegions();
    };

    // 加上后 addLayer 被拒绝 → 用完整快照重建 → 整份样式通不过校验 → failed；去掉后出现新版本，自动重新加载
    const toggleInvalidLayer = () => {
      invalidLayer.value = !invalidLayer.value;
      commitRegions();
    };

    const showHighlight = () => {
      highlightIndex.value = ((highlightIndex.value ?? -1) + 1) % HIGHLIGHT_POSITIONS.length;
      const position = HIGHLIGHT_POSITIONS[highlightIndex.value];
      if (position !== undefined) {
        session?.style.setGroup('highlight', highlightGroup(position));
      }
    };

    const clearHighlight = () => {
      highlightIndex.value = undefined;
      session?.style.setGroup('highlight', EMPTY_GROUP);
    };

    const flyToNanjing = () => {
      view?.flyTo({ center: [118.8, 32.05], zoom: 9 }, { duration: 1500 });
    };

    const fitJiangsu = () => {
      view?.fitBounds(JIANGSU_BOUNDS, { padding: FIT_PADDING, duration: 1000 });
    };

    const togglePause = () => {
      if (paused.value) {
        paused.value = false;
        view?.resume();
      } else {
        view?.pause();
        paused.value = true;
      }
    };

    // 模拟三维期间用户改了相机：俯角超过 MapLibre 的上限 60°，恢复时应收到上限，并按 sync 写回
    const simulate3dCamera = () => {
      session?.camera.set({ center: [120.3, 31.6], zoom: 9.5, bearing: 30, pitch: 70 }, { view: '3d', cause: 'user' });
    };

    return () => {
      const ready = viewState.value === 'ready';
      return (
        <div class={styles.root}>
          <header class={styles.toolbar}>
            <div class={styles.actions}>
              <ElButton onClick={toggleColor}>切换颜色</ElButton>
              <ElButton onClick={toggleMinzoom}>{minzoom.value === undefined ? '加上 minzoom 7' : '去掉 minzoom'}</ElButton>
              <ElButton onClick={showHighlight}>{highlightIndex.value === undefined ? '高亮' : '移动高亮'}</ElButton>
              <ElButton disabled={highlightIndex.value === undefined} onClick={clearHighlight}>
                清除高亮
              </ElButton>
              <ElButton disabled={!ready} onClick={flyToNanjing}>
                flyTo 南京
              </ElButton>
              <ElButton disabled={!ready} onClick={fitJiangsu}>
                fitBounds 江苏（右侧留 360）
              </ElButton>
              <ElButton type={paused.value ? 'primary' : 'default'} onClick={togglePause}>
                {paused.value ? '恢复' : '暂停（模拟切到三维）'}
              </ElButton>
              <ElButton disabled={!paused.value} onClick={simulate3dCamera}>
                模拟三维改相机
              </ElButton>
              <ElButton type={invalidLayer.value ? 'danger' : 'default'} onClick={toggleInvalidLayer}>
                {invalidLayer.value ? '去掉不合法的图层' : '提交不合法的图层'}
              </ElButton>
              <ElButton onClick={createView}>重新创建视图</ElButton>
            </div>
            <dl class={styles.status} data-view-state={viewState.value}>
              <dt>视图</dt>
              <dd>{viewState.value}</dd>
              <dt>会话相机</dt>
              <dd data-camera>{formatCamera(camera.value)}</dd>
              <dt>意图版本</dt>
              <dd data-intent-revision>{intentRevision.value}</dd>
              <dt>样式版本</dt>
              <dd data-style-version>{styleVersion.value}</dd>
            </dl>
          </header>
          {/* 交给 MapLibre 的容器只用静态 class：它会自己加 maplibregl-map 等 class，绑定变化时 Vue 会把它们冲掉 */}
          <div class={[styles.mapFrame, paused.value && styles.hidden]}>
            <div ref={container} class={styles.map} />
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
