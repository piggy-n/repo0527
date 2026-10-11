import type { FilterSpecification, LayerSpecification, SourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { CameraState, MapLibreMapOptions, StyleGroup, ViewBounds } from '@yzt/map-core';
import { MapCanvas, provideMap } from '@yzt/map-vue';
import { ElButton, ElCheckbox, ElInputNumber, ElSwitch } from 'element-plus';
// oxlint-disable-next-line no-restricted-imports -- 开发页实测要用原生地图的 idle、error 事件和 setWorkerCount，开发页不进生产构建
import { type ErrorEvent, Map as MapLibreMap, setWorkerCount } from 'maplibre-gl';
import { computed, defineComponent, onScopeDispose, ref, shallowRef } from 'vue';
import { z } from 'zod';
import { appConfig } from '@/shared/config/app-config';
import { http } from '@/shared/http/client';
import { LANDUSE_GROUPS } from '@/features/resource-map/landuse';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import styles from './DevResourcesPage.module.scss';

// 资源图层的实测页（5C.1b）：真实的资源树和瓦片，比较建图层的几种做法；正式的拥有者在 5C.1e 之后接入

const INITIAL_CAMERA: CameraState = { center: [119.4, 32.9], zoom: 6.5, bearing: 0, pitch: 0 };
const JIANGSU_BOUNDS: ViewBounds = [116.35, 30.75, 121.98, 35.15];
// 地图样式里的颜色是数据，交给 MapLibre 渲染，不走 CSS 令牌（与旧项目的配色板相同）
const PALETTE = ['#D9433F', '#16B3B3', '#C74F9B', '#77A82E', '#B03A6B', '#2278BE', '#C79212', '#7A4FC0', '#E07B39', '#2FA663'];
const SOURCE_LAYER_EXCEPTIONS: Readonly<Record<string, string>> = {
  bgdc_czcdyd_2022: 'czcdyd',
  bgdc_dltb_czc_2021: 'dltb_czc_2021'
};
const MISSING_RESOURCE = 'dev_missing';
// 标注实验：字形只放 0-255 一个区段，汉字靠 localIdeographFontFamily 用本地字体画。public/fonts 不入库（ADR 0013），
// 要先把字形放到 public/fonts/glyphs/Noto Sans Regular/0-255.pbf，见 migration.md 的现状底图实测
const GLYPHS = `${window.location.origin}/fonts/glyphs/{fontstack}/{range}.pbf`;
const LABEL_SAMPLES = ['水田', '城镇住宅用地', '乡村道路（硬化）', 'Ⅰ级水源地', '长江 Changjiang 2022', '0.5亩·河流'];

function labelsGroup(): StyleGroup {
  return {
    sources: {
      'labels-samples': {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: LABEL_SAMPLES.map((name, index) => ({
            type: 'Feature',
            properties: { name },
            geometry: { type: 'Point', coordinates: [118.7 + (index % 2) * 0.25, 32.15 - Math.floor(index / 2) * 0.08] }
          }))
        }
      }
    },
    layers: [
      {
        id: 'labels-samples',
        type: 'symbol',
        source: 'labels-samples',
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 16 },
        paint: { 'text-color': '#000000', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1 }
      }
    ]
  };
}
const SETTLE_QUIET_MS = 500;

const layerNodeSchema = z.object({
  code: z.string(),
  name: z.string(),
  geoType: z.enum(['Polygon', 'Line', 'Point']),
  resource: z.string(),
  yearList: z.array(z.number()).nonempty()
});
type LayerNode = z.infer<typeof layerNodeSchema>;
interface CategoryNode {
  readonly code: string | null;
  readonly name: string;
  readonly children: readonly (CategoryNode | LayerNode)[];
}
const categoryNodeSchema: z.ZodType<CategoryNode> = z.object({
  code: z.string().nullable(),
  name: z.string(),
  get children() {
    return z.array(z.union([categoryNodeSchema, layerNodeSchema]));
  }
});

type Geometry = 'fill' | 'line' | 'circle';

interface Resource {
  readonly code: string;
  readonly name: string;
  readonly geometry: Geometry;
  readonly year: number;
  readonly category: string;
}

const GEOMETRY: Readonly<Record<LayerNode['geoType'], Geometry>> = { Polygon: 'fill', Line: 'line', Point: 'circle' };

// 接口按"图层 × 年份"逐条返回：按 code 去重，取最大年份
function flatten(nodes: readonly (CategoryNode | LayerNode)[], path: readonly string[] = []): Resource[] {
  const byCode = new Map<string, Resource>();
  const walk = (items: readonly (CategoryNode | LayerNode)[], at: readonly string[]) => {
    for (const node of items) {
      if ('children' in node) {
        walk(node.children, [...at, node.name]);
      } else if (!byCode.has(node.code)) {
        byCode.set(node.code, {
          code: node.code,
          name: node.name,
          geometry: GEOMETRY[node.geoType],
          year: Math.max(...node.yearList),
          category: at.join(' / ')
        });
      }
    }
  };
  walk(nodes, path);
  return [...byCode.values()];
}

interface BuildOptions {
  readonly keepUnchecked: boolean;
  readonly allGeometries: boolean;
  readonly sourceMinzoom: number;
  readonly sourceMaxzoom: number;
  readonly layerMinzoom: number;
}

const GEOMETRY_FILTERS: Readonly<Record<Geometry, FilterSpecification>> = {
  fill: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
  line: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
  circle: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]
};

const PAINTS: Readonly<Record<Geometry, (color: string) => LayerSpecification['paint']>> = {
  fill: color => ({ 'fill-color': color, 'fill-opacity': 0.5, 'fill-outline-color': color }),
  line: color => ({ 'line-color': color, 'line-width': 1.5 }),
  circle: color => ({ 'circle-color': color, 'circle-radius': 4, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 1 })
};

function resourcesGroup(resources: readonly Resource[], checked: ReadonlySet<string>, options: BuildOptions): StyleGroup {
  const tileBase = new URL(`${appConfig.apiBaseUrl}/api/tiles/`, window.location.origin).href;
  const sources: Record<string, SourceSpecification> = {};
  const layers: LayerSpecification[] = [];
  resources.forEach((resource, index) => {
    const visible = checked.has(resource.code);
    if (!visible && !options.keepUnchecked) {
      return;
    }
    const sourceId = `resources-${resource.code}`;
    const tileset = `${resource.code}_${resource.year}`;
    sources[sourceId] = {
      type: 'vector',
      tiles: [`${tileBase}${tileset}/{z}/{x}/{y}.pbf`],
      minzoom: options.sourceMinzoom,
      maxzoom: options.sourceMaxzoom
    };
    const color = PALETTE[index % PALETTE.length] ?? '#2278BE';
    const geometries: Geometry[] = options.allGeometries ? ['fill', 'line', 'circle'] : [resource.geometry];
    for (const geometry of geometries) {
      layers.push({
        id: `${sourceId}-${geometry}`,
        type: geometry,
        source: sourceId,
        'source-layer': SOURCE_LAYER_EXCEPTIONS[tileset] ?? tileset,
        minzoom: options.layerMinzoom,
        filter: GEOMETRY_FILTERS[geometry],
        layout: visible ? {} : { visibility: 'none' },
        paint: PAINTS[geometry](color)
      } as LayerSpecification);
    }
  });
  return { sources, layers };
}

interface Measurement {
  readonly label: string;
  readonly ms: number;
  readonly requests: number;
  /** 测量期间最长的一帧（相邻两次 requestAnimationFrame 的间隔） */
  readonly maxFrameMs: number;
  /** 超过 50 ms 的帧数 */
  readonly slowFrames: number;
}

interface TileError {
  readonly sourceId: string;
  readonly message: string;
}

// Worker 数量只能在第一张地图创建前设置：用地址里的 ?workers=4 切换，刷新页面生效
const workers = Number(new URLSearchParams(window.location.search).get('workers'));
if (Number.isInteger(workers) && workers > 0) {
  setWorkerCount(workers);
}

export const DevResourcesPage = defineComponent({
  name: 'DevResourcesPage',
  setup() {
    const errors = ref<string[]>([]);
    const map = provideMap({
      groups: ['resources', 'labels'],
      root: { glyphs: GLYPHS },
      camera: INITIAL_CAMERA,
      onError: error => (errors.value = [String(error), ...errors.value].slice(0, 20))
    });

    const resources = shallowRef<readonly Resource[]>([]);
    const loadError = ref<string | null>(null);
    const checked = shallowRef<ReadonlySet<string>>(new Set());
    const keepUnchecked = ref(false);
    const allGeometries = ref(false);
    const sourceMinzoom = ref(0);
    const sourceMaxzoom = ref(15);
    const layerMinzoom = ref(0);
    const labels = ref(false);

    const missing: Resource = {
      code: MISSING_RESOURCE,
      name: '不存在的瓦片集（测错误事件）',
      geometry: 'fill',
      year: 2022,
      category: '实测'
    };
    const loadTree = async () => {
      try {
        const tree = await http.get('/resource-map/base/tree', { schema: z.array(categoryNodeSchema), silent: true });
        resources.value = [...flatten(tree), missing];
      } catch (error) {
        loadError.value = String(error);
      }
    };
    void loadTree();

    map.bindStyle({
      resources: () =>
        resourcesGroup(resources.value, checked.value, {
          keepUnchecked: keepUnchecked.value,
          allGeometries: allGeometries.value,
          sourceMinzoom: sourceMinzoom.value,
          sourceMaxzoom: sourceMaxzoom.value,
          layerMinzoom: layerMinzoom.value
        }),
      labels: () => (labels.value ? labelsGroup() : { sources: {}, layers: [] })
    });

    // 原生地图：用 idle 判断渲染完成，从 error 事件里看出错的数据源
    let nativeMap: MapLibreMap | undefined;
    const tileErrors = ref<TileError[]>([]);
    const createMap = (options: MapLibreMapOptions) => {
      const created = new MapLibreMap(options);
      created.on('error', (event: ErrorEvent & { sourceId?: string }) => {
        tileErrors.value = [{ sourceId: event.sourceId ?? '-', message: event.error.message }, ...tileErrors.value].slice(0, 20);
      });
      nativeMap = created;
      return created;
    };

    // 瓦片请求在 Worker 里发出，主线程的 Resource Timing 看不到；transformRequest 在主线程调用，用它计数
    let requests = 0;
    const glyphRanges = ref<string[]>([]);
    const mapOptions = {
      transformRequest: (url: string, resourceType?: string) => {
        if (url.includes('/api/tiles/')) {
          requests++;
        }
        if (resourceType === 'Glyphs') {
          glyphRanges.value = [...glyphRanges.value, decodeURIComponent(url.slice(url.indexOf('/glyphs/') + 8))];
        }
        return { url };
      }
    };

    // 主线程的卡顿用帧间隔衡量：浏览器面板里 longtask 观察不到（实测阻塞 120 ms 也没有记录）
    let frame: number | undefined;
    let maxFrame = 0;
    let slowFrames = 0;
    const watchFrames = () => {
      let last = performance.now();
      maxFrame = 0;
      slowFrames = 0;
      const loop = (now: number) => {
        const gap = now - last;
        last = now;
        maxFrame = Math.max(maxFrame, gap);
        slowFrames += gap > 50 ? 1 : 0;
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    };
    const stopFrames = () => frame !== undefined && cancelAnimationFrame(frame);
    onScopeDispose(stopFrames);

    const measurements = ref<Measurement[]>([]);
    const measuring = ref<string | null>(null);

    // 执行一次操作，等到原生地图的 idle 之后再安静 500 ms（期间没有新的 idle），记下从操作到最后一次 idle 的时间。
    // 瓦片出错不会触发重绘，没有重绘就没有 idle（实测）：测量期间收到 error 时主动请求一次重绘
    const measure = (label: string, action: () => void) => {
      const target = nativeMap;
      if (!target || measuring.value) {
        return;
      }
      measuring.value = label;
      const started = performance.now();
      const startRequests = requests;
      watchFrames();
      let lastIdle = started;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        target.off('idle', onIdle);
        target.off('error', repaint);
        stopFrames();
        measuring.value = null;
        measurements.value = [
          {
            label,
            ms: Math.round(lastIdle - started),
            requests: requests - startRequests,
            maxFrameMs: Math.round(maxFrame),
            slowFrames
          },
          ...measurements.value
        ];
      };
      const onIdle = () => {
        lastIdle = performance.now();
        clearTimeout(timer);
        timer = setTimeout(finish, SETTLE_QUIET_MS);
      };
      const repaint = () => target.triggerRepaint();
      target.on('idle', onIdle);
      target.on('error', repaint);
      action();
      target.triggerRepaint();
    };

    const setChecked = (codes: Iterable<string>) => (checked.value = new Set(codes));
    const toggle = (code: string, on: boolean) => {
      const next = new Set(checked.value);
      if (on) {
        next.add(code);
      } else {
        next.delete(code);
      }
      const resource = resources.value.find(item => item.code === code);
      measure(`${on ? '勾选' : '取消'} ${resource?.name ?? code}`, () => (checked.value = next));
    };

    const styleSize = computed(() => {
      const group = resourcesGroup(resources.value, checked.value, {
        keepUnchecked: keepUnchecked.value,
        allGeometries: allGeometries.value,
        sourceMinzoom: sourceMinzoom.value,
        sourceMaxzoom: sourceMaxzoom.value,
        layerMinzoom: layerMinzoom.value
      });
      return `${Object.keys(group.sources).length} 个数据源 · ${group.layers.length} 个图层`;
    });

    const categories = computed(() => {
      const grouped = new Map<string, Resource[]>();
      for (const resource of resources.value) {
        grouped.set(resource.category, [...(grouped.get(resource.category) ?? []), resource]);
      }
      return [...grouped.entries()];
    });

    // 图例统计的耗时（5C.4，ADR 0021）：对地类图斑的图层做一次整屏 queryRenderedFeatures，另用 querySourceFeatures 对比；
    // 两者都在主线程上同步执行，记下耗时、要素数和不同的地类编码。要先勾选地类图斑、等它画完
    const landuseStats = ref<string[]>([]);
    const countLanduse = () => {
      const target = nativeMap;
      if (!target?.getLayer('resources-bgdc_dltb-fill')) {
        return;
      }
      const renderedStart = performance.now();
      const rendered = target.queryRenderedFeatures({ layers: ['resources-bgdc_dltb-fill'] });
      const renderedMs = Math.round(performance.now() - renderedStart);
      const sourceStart = performance.now();
      const fromSource = target.querySourceFeatures('resources-bgdc_dltb', { sourceLayer: 'bgdc_dltb_2022' });
      const sourceMs = Math.round(performance.now() - sourceStart);
      const codes = new Set(rendered.map(feature => String(feature.properties.dlbm)));
      const known = new Set(LANDUSE_GROUPS.flatMap(group => group.classes.map(item => item.code)));
      const unknown = [...codes].filter(code => !known.has(code));
      landuseStats.value = [
        `z${target.getZoom().toFixed(1)}：queryRenderedFeatures ${rendered.length} 个要素、${codes.size} 种编码、${renderedMs} ms；` +
          `querySourceFeatures ${fromSource.length} 个、${sourceMs} ms；表外编码：${unknown.join('、') || '无'}`,
        ...landuseStats.value
      ];
    };

    const fitJiangsu = () =>
      measure('回到全省', () => map.runCameraOperation(camera => camera.fitBounds(JIANGSU_BOUNDS, { duration: 0 })));
    const flyNanjing = (zoom: number) =>
      measure(`南京 z${zoom}`, () =>
        map.runCameraOperation(camera => camera.flyTo({ center: [118.8, 32.05], zoom }, { duration: 0 }))
      );

    return () => (
      <div class={styles.root}>
        <header class={styles.toolbar}>
          <div class={styles.actions}>
            <ElButton onClick={() => measure('全不选', () => setChecked([]))}>全不选</ElButton>
            <ElButton onClick={() => measure('只选地类图斑', () => setChecked(['bgdc_dltb']))}>只选地类图斑</ElButton>
            <ElButton
              onClick={() =>
                measure('全选（不含出错的）', () =>
                  setChecked(resources.value.map(({ code }) => code).filter(code => code !== MISSING_RESOURCE))
                )
              }>
              全选
            </ElButton>
            <ElButton onClick={fitJiangsu}>全省</ElButton>
            <ElButton onClick={() => flyNanjing(10)}>南京 z10</ElButton>
            <ElButton onClick={() => flyNanjing(13)}>南京 z13</ElButton>
            <ElButton onClick={countLanduse}>统计地类</ElButton>
            <ElButton onClick={() => (measurements.value = [])}>清空记录</ElButton>
          </div>
          <div class={styles.options}>
            <ElSwitch
              modelValue={keepUnchecked.value}
              onUpdate:modelValue={value =>
                measure(value ? '留在样式里：开' : '留在样式里：关', () => (keepUnchecked.value = Boolean(value)))
              }
              activeText="未勾选的留在样式里"
            />
            <ElSwitch
              modelValue={allGeometries.value}
              onUpdate:modelValue={value =>
                measure(value ? '3 个几何图层：开' : '3 个几何图层：关', () => (allGeometries.value = Boolean(value)))
              }
              activeText="每个资源 3 个几何图层"
            />
            <label>
              源级别
              <ElInputNumber
                size="small"
                min={0}
                max={22}
                modelValue={sourceMinzoom.value}
                onUpdate:modelValue={value => (sourceMinzoom.value = value ?? 0)}
              />
              ～
              <ElInputNumber
                size="small"
                min={0}
                max={22}
                modelValue={sourceMaxzoom.value}
                onUpdate:modelValue={value => (sourceMaxzoom.value = value ?? 15)}
              />
            </label>
            <label>
              图层最小级别
              <ElInputNumber
                size="small"
                min={0}
                max={22}
                modelValue={layerMinzoom.value}
                onUpdate:modelValue={value => (layerMinzoom.value = value ?? 0)}
              />
            </label>
            <ElSwitch
              modelValue={labels.value}
              onUpdate:modelValue={value => measure(value ? '标注：开' : '标注：关', () => (labels.value = Boolean(value)))}
              activeText="标注实验"
            />
            <span data-style-size>{styleSize.value}</span>
            <span>Worker：{Number.isInteger(workers) && workers > 0 ? workers : '默认'}</span>
          </div>
        </header>
        <div class={styles.body}>
          <aside class={styles.list}>
            {loadError.value && <p class={styles.error}>资源树加载失败：{loadError.value}</p>}
            {categories.value.map(([category, items]) => (
              <section key={category}>
                <h3>{category}</h3>
                {items.map(resource => (
                  <ElCheckbox
                    key={resource.code}
                    modelValue={checked.value.has(resource.code)}
                    onUpdate:modelValue={value => toggle(resource.code, Boolean(value))}>
                    {resource.name}
                    <small>
                      {resource.code} · {resource.year}
                    </small>
                  </ElCheckbox>
                ))}
              </section>
            ))}
          </aside>
          <div class={styles.mapArea}>
            <MapCanvas mapOptions={mapOptions} createMap={createMap} />
            <MapStatusNotice />
          </div>
          <aside class={styles.report}>
            <h3>{measuring.value ? `测量中：${measuring.value}` : '测量记录'}</h3>
            <table data-measurements>
              <thead>
                <tr>
                  <th>操作</th>
                  <th>到最后一次 idle</th>
                  <th>瓦片请求</th>
                  <th>最长一帧 / 慢帧数</th>
                </tr>
              </thead>
              <tbody>
                {measurements.value.map((item, index) => (
                  <tr key={index}>
                    <td>{item.label}</td>
                    <td>{item.ms} ms</td>
                    <td>{item.requests}</td>
                    <td>
                      {item.maxFrameMs} ms / {item.slowFrames}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>地类统计（整屏）</h3>
            <ul data-landuse-stats>
              {landuseStats.value.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
            <h3>请求过的字形</h3>
            <ul data-glyphs>
              {glyphRanges.value.map((range, index) => (
                <li key={index}>{range}</li>
              ))}
            </ul>
            <h3>瓦片错误（原生 error 事件）</h3>
            <ul data-tile-errors>
              {tileErrors.value.map((item, index) => (
                <li key={index}>
                  {item.sourceId}：{item.message}
                </li>
              ))}
            </ul>
            <h3>onError</h3>
            <ul>
              {errors.value.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    );
  }
});
