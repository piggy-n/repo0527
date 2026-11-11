import type { CesiumScene, VectorHit, VectorStats } from '@mx/map-cesium';
import type { MapView } from '@mx/map-core';
import { CesiumCanvas, MAP_RUNTIME, MapCanvas, provideMap, type SceneViewOptions } from '@mx/map-vue';
import { useIntervalFn } from '@vueuse/core';
import { ElButton, ElCheckbox, ElSlider, ElSwitch } from 'element-plus';
import { computed, defineComponent, inject, ref, shallowRef } from 'vue';
import { resourceSourceId, resourceTileBase } from '@/features/resource-map/resource-layers';
import { appConfig } from '@/shared/config/app-config';
import { backendTransformRequest, JIANGSU_MAP_OPTIONS } from '@/shared/map/backend-request';
import { BASEMAP_STYLE_ROOT } from '@/shared/map/basemap/static-basemap';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { SLICE, SLICE_VIEWS, sliceGroup } from './slice';
import styles from './DevPlanBPage.module.scss';

// 方案 B 的 PoC：Cesium 引擎用 Worker 栅格化显示资源图层（矢量瓦片）。页面照常用 provideMap 绑定样式，
// 引擎按 .env 的 VITE_MAP_3D_ENGINE：cesium 时三维是方案 B，maplibre 时三维是 MapLibre 原生绘制，用来对照。
// 报告在 local/poc/plan-b/，不入库

const MB = 1024 * 1024;
const ms = (value: number) => `${Math.round(value)} ms`;

function statLines(stats: VectorStats): string[] {
  const levels = Object.entries(stats.levels)
    .map(([level, count]) => `z${level}×${count}`)
    .join(' ');
  return [
    `Worker ${stats.workers} 个，数据源 ${stats.sources} 个，标注 ${stats.labels} 个`,
    `位图：请求 ${stats.requested}，画出 ${stats.bitmaps}，失败 ${stats.failed}，在画 ${stats.pending}`,
    `各级：${levels || '无'}`,
    `下载 ${stats.fetched} 张、${(stats.bytes / MB).toFixed(1)} MB，其中来自浏览器缓存 ${stats.fromHttpCache} 张，` +
      `经网络 ${(stats.transferBytes / MB).toFixed(1)} MB`,
    `Worker 累计：下载 ${ms(stats.fetchMs)}，解码 ${ms(stats.decodeMs)}，绘制 ${ms(stats.drawMs)}，转位图 ${ms(stats.bitmapMs)}`,
    `主线程等位图的总时间（含排队）${ms(stats.roundTripMs)}`,
    `几何缓存 ${stats.cacheTiles} 张、${(stats.cacheBytes / MB).toFixed(1)} MB`
  ];
}

export const DevPlanBPage = defineComponent({
  name: 'DevPlanBPage',
  setup() {
    const errors = ref<string[]>([]);
    const skipped = ref<string[]>([]);
    const map = provideMap({
      groups: ['basemap', 'resources', 'basemap-labels'],
      root: BASEMAP_STYLE_ROOT,
      camera: { center: [118.8, 32.05], zoom: 10, bearing: 0, pitch: 0 },
      onError: error => (errors.value = [String(error), ...errors.value].slice(0, 20))
    });
    // 不用天地图：只有静态底图和无底图，和内网部署一样
    const basemap = useBasemap({ tianditu: null });
    const checked = shallowRef<ReadonlySet<string>>(new Set(SLICE.map(({ code }) => code)));
    const opacity = ref(1);
    const labels = ref(true);
    const unrestricted = ref(false);
    const tileBase = resourceTileBase(appConfig.apiBaseUrl, window.location.origin);

    map.bindStyle({
      basemap: basemap.deriveGroup,
      'basemap-labels': basemap.deriveLabelsGroup,
      resources: () =>
        sliceGroup({
          checked: checked.value,
          opacity: opacity.value,
          labels: labels.value,
          tileBase,
          unrestricted: unrestricted.value
        })
    });

    // 自己创建三维视图：要拿到场景的读数和识别（产品里由 CesiumCanvas 创建，拿不到场景）
    const loadRuntime = inject(MAP_RUNTIME, null);
    let scene: CesiumScene | null = null;
    const createView = async (options: SceneViewOptions): Promise<MapView> => {
      if (!loadRuntime) {
        throw new Error('没有地图运行时');
      }
      const [{ CesiumView, createCesiumScene }] = await Promise.all([import('@mx/map-cesium'), loadRuntime('3d')]);
      return new CesiumView({
        ...options,
        active: false,
        createScene: container => {
          scene = createCesiumScene(container);
          return scene;
        },
        vectors: { requestHeaders: url => backendTransformRequest(url).headers, identifyKeys: ['guid'] }
      });
    };

    const stats = shallowRef<VectorStats | null>(null);
    useIntervalFn(() => {
      void scene?.vectorStats().then(value => (stats.value = value));
    }, 1000);

    // 点一下地图识别：三维走 Worker 里的瓦片数据，二维走渲染要素查询，对照用
    const hits = ref<string[]>([]);
    const identify = async (event: MouseEvent) => {
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const point = { x: event.clientX - box.left, y: event.clientY - box.top };
      const started = performance.now();
      if (map.dimension.value === '3d' && scene) {
        const found: readonly VectorHit[] = await scene.identifyVectors(point, 8);
        const lines = found.flatMap(({ sourceId, features }) =>
          features.map(feature => `${sourceId} ${feature.geometry} ${JSON.stringify(feature.properties)}`)
        );
        hits.value = [`三维（Worker）${ms(performance.now() - started)}，${lines.length} 个`, ...lines];
        return;
      }
      const sources = [...checked.value].map(resourceSourceId);
      const rendered = map.view.value?.queryRendered(point, { sources }) ?? [];
      hits.value = [
        `渲染要素查询 ${ms(performance.now() - started)}，${rendered.length} 个`,
        ...rendered.slice(0, 20).map(feature => `${feature.layerId} ${JSON.stringify(feature.properties).slice(0, 200)}`)
      ];
    };

    const toggle = (code: string, on: boolean) => {
      const next = new Set(checked.value);
      if (on) {
        next.add(code);
      } else {
        next.delete(code);
      }
      checked.value = next;
    };
    const goTo = ({ center, zoom, pitch, bearing }: (typeof SLICE_VIEWS)[number]) =>
      map.runCameraOperation(camera => camera.flyTo({ center: [center[0], center[1]], zoom, pitch, bearing }, { duration: 0 }));
    const current = map.useCamera();
    const camera = computed(() => {
      const { center, zoom, pitch, bearing } = current.value;
      return `${center[0].toFixed(4)}, ${center[1].toFixed(4)} · z${zoom.toFixed(2)} · 俯仰 ${pitch.toFixed(0)}° · 方位 ${bearing.toFixed(0)}°`;
    });
    const sourceErrors = computed(() => [...map.sourceErrors.value].map(([id, error]) => `${id}：${String(error)}`));

    return () => (
      <div class={styles.root}>
        <header class={styles.toolbar}>
          <div class={styles.row}>
            <strong>方案 B：Cesium 的 Worker 栅格化</strong>
            <span data-engine>三维引擎：{appConfig.map3dEngine}</span>
            <ElButton
              type="primary"
              data-dimension={map.dimension.value}
              onClick={() => map.setDimension(map.dimension.value === '2d' ? '3d' : '2d')}
            >
              {map.dimension.value === '2d' ? '切换到三维' : '切换到二维'}
            </ElButton>
            {SLICE_VIEWS.map(view => (
              <ElButton key={view.id} data-view={view.id} onClick={() => goTo(view)}>
                {view.label}
              </ElButton>
            ))}
          </div>
          <div class={styles.row}>
            {SLICE.map(({ code, name }) => (
              <ElCheckbox
                key={code}
                data-resource={code}
                modelValue={checked.value.has(code)}
                onUpdate:modelValue={value => toggle(code, Boolean(value))}
              >
                {name}
              </ElCheckbox>
            ))}
            <ElSwitch
              modelValue={labels.value}
              onUpdate:modelValue={value => (labels.value = Boolean(value))}
              activeText="地类名称"
            />
            <ElSwitch
              modelValue={unrestricted.value}
              onUpdate:modelValue={value => (unrestricted.value = Boolean(value))}
              activeText="水域不设最小级别"
            />
            <ElSwitch
              modelValue={basemap.selected.value !== 'none'}
              onUpdate:modelValue={value => basemap.select(value ? 'static' : 'none')}
              activeText="静态底图"
            />
            <label class={styles.slider}>
              透明度
              <ElSlider
                min={0}
                max={1}
                step={0.05}
                modelValue={opacity.value}
                onUpdate:modelValue={value => (opacity.value = Number(value))}
              />
            </label>
          </div>
        </header>
        <div class={styles.body}>
          <div class={styles.mapArea} onClick={event => void identify(event)}>
            <MapCanvas mapOptions={JIANGSU_MAP_OPTIONS} />
            <CesiumCanvas
              createView={createView}
              onUnsupported={({ layerId, reason }) => (skipped.value = [`${layerId}：${reason}`, ...skipped.value])}
            />
            <MapStatusNotice />
          </div>
          <aside class={styles.report}>
            <h3>相机</h3>
            <p data-camera>{camera.value}</p>
            <h3>资源</h3>
            <ul>
              {SLICE.map(({ code, name, year, note, minzoom }) => (
                <li key={code}>
                  {name}（{code}_{year}{minzoom === undefined ? '' : `，${minzoom} 级起`}）：{note}
                </li>
              ))}
            </ul>
            <h3>栅格化读数（三维、cesium 引擎）</h3>
            <ul data-stats>{stats.value ? statLines(stats.value).map(line => <li key={line}>{line}</li>) : <li>无</li>}</ul>
            <h3>识别（点一下地图）</h3>
            <ul data-hits>
              {hits.value.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
            <h3>数据源错误</h3>
            <ul data-source-errors>
              {sourceErrors.value.map(line => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <h3>三维跳过的图层</h3>
            <ul data-skipped>
              {skipped.value.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
            <h3>onError</h3>
            <ul data-errors>
              {errors.value.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    );
  }
});
