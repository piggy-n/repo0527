import type { GeoJSONSourceSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { type CameraState, type MapLibreMapOptions, MapLibreView, MapSession, type StyleGroup } from '@mx/map-core';
import type { Feature, FeatureCollection } from 'geojson';
import { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from '@/features/resource-map/catalog';
import type { FeatureFilter } from '@/features/resource-map/feature-filter';
import { pointsInBox } from '@/features/resource-map/feature-query';
import { CLASS_FIELD } from '@/features/resource-map/filter-fields';
import { POINT_SHAPE_NAMES, shapeImageId } from '@/features/resource-map/point-shapes';
import {
  EMPTY_RESOURCE_LAYERS,
  mergeDisplayState,
  type ResourceLayersState,
  resourcesGroup
} from '@/features/resource-map/resource-layers';
import type { ResourceSymbolOverride } from '@/features/resource-map/resource-symbols';
import { selectionGroup } from '@/features/resource-map/selection-style';
import { resourceHighlightStyle } from '@/features/resource-map/style-registry';

// 资源图层放在真实 MapLibre 上（按线型拆层 ADR 0046、面的花纹 ADR 0045）：用推导出的分组，数据换成内联 GeoJSON。
// 放在 app 里：要用原生地图等渲染完成、查画出的要素、读画面，只有 app 和 MapLibre 适配器能导入 maplibre-gl

const WAIT_TIMEOUT = 10_000;
const HYDL = 'csxhjctb_hydl';
const DLTB = 'bgdc_dltb';
const XXP = 'csxhjctb_xxp';

// 要素多一些，Worker 重新解析要好几帧：旧瓦片画新样式的窗口足够长，才测得出线型切换的报错
const GRID = 60;

function grid<T>(make: (x: number, y: number, index: number) => T): T[] {
  return Array.from({ length: GRID * GRID }, (_, index) => {
    const x = 118.3 + (index % GRID) * 0.007;
    const y = 31.8 + Math.floor(index / GRID) * 0.004;
    return make(x, y, index);
  });
}

const LINES: FeatureCollection = {
  type: 'FeatureCollection',
  features: grid<Feature>((x, y, index) => ({
    type: 'Feature',
    properties: { ccn: ['河流', '水渠', '湖泊'][index % 3] },
    geometry: {
      type: 'LineString',
      coordinates: [
        [x, y],
        [x + 0.005, y + 0.002]
      ]
    }
  }))
};

const AREAS: FeatureCollection = {
  type: 'FeatureCollection',
  features: grid<Feature>((x, y, index) => ({
    type: 'Feature',
    properties: { dlbm: ['0101', '0102', '0103'][index % 3] },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [x, y],
          [x + 0.006, y],
          [x + 0.006, y + 0.003],
          [x, y + 0.003],
          [x, y]
        ]
      ]
    }
  }))
};

// 学校点：5 × 5 个，12 级时相距约 58 像素，按 cc 分四类
const POINT_CENTER: [number, number] = [119.5, 33];
const POINT_SPACING = 0.02;
const SCHOOL_CLASSES = ['08H212', '08H213', '08H214', '08H215'];

const pointGuid = (index: number) => index.toString(16).padStart(32, '0');

const POINTS: FeatureCollection = {
  type: 'FeatureCollection',
  features: Array.from({ length: 25 }, (_, index): Feature => ({
    type: 'Feature',
    properties: { cc: SCHOOL_CLASSES[index % SCHOOL_CLASSES.length], guid: pointGuid(index) },
    geometry: {
      type: 'Point',
      coordinates: [
        POINT_CENTER[0] + ((index % 5) - 2) * POINT_SPACING,
        POINT_CENTER[1] + (Math.floor(index / 5) - 2) * POINT_SPACING
      ]
    }
  }))
};

// 正中间那个点
const CENTER_POINT = 12;

// 倾斜视角用的学校点：(121.5, 33) 以北几排，越远的排离得越开、每排左右错开，倾斜到 85° 时靠近地平线的点也不挤在一起；
// 和上面的点离得远，平视的用例看不到
const FAR_START: [number, number] = [121.5, 33];
const FAR_ROWS = [0.03, 0.08, 0.15, 0.3, 0.6];
const FAR_POINTS: readonly Feature[] = FAR_ROWS.flatMap((north, row) =>
  Array.from({ length: 7 }, (_, column): Feature => ({
    type: 'Feature',
    properties: { cc: '08H213', guid: pointGuid(1000 + row * 10 + column) },
    geometry: { type: 'Point', coordinates: [FAR_START[0] + (column - 3) * 0.1 + row * 0.03, FAR_START[1] + north] }
  }))
);

const DATA: ReadonlyMap<string, FeatureCollection> = new Map([
  [`resources-${HYDL}`, LINES],
  [`resources-${DLTB}`, AREAS],
  [`resources-${XXP}`, { type: 'FeatureCollection', features: [...POINTS.features, ...FAR_POINTS] }]
]);

function dataOf(sourceId: string): GeoJSONSourceSpecification {
  const data = DATA.get(sourceId);
  if (!data) {
    throw new Error(`没有数据源 ${sourceId} 的数据`);
  }
  return { type: 'geojson', data };
}

function checkedState(): ResourceLayersState {
  const catalog = buildCatalog([
    {
      code: null,
      name: '测试',
      children: [
        { code: HYDL, name: '水域线', geoType: 'Line', yearList: [2025] },
        { code: DLTB, name: '地类图斑', geoType: 'Polygon', yearList: [2022] },
        { code: XXP, name: '学校点层', geoType: 'Point', yearList: [2025] }
      ]
    }
  ]);
  const state = mergeDisplayState(EMPTY_RESOURCE_LAYERS, catalog);
  const displays = new Map(
    [...state.displays].map(([code, display]) => [code, { ...display, added: true, checked: true }])
  );
  return { ...state, displays };
}

const STATE = checkedState();

// 一个资源加上要素过滤（ADR 0173）
function withFilter(code: string, filter: FeatureFilter): ResourceLayersState {
  const display = STATE.displays.get(code);
  if (!display) {
    throw new Error(`没有 ${code} 的显示状态`);
  }
  return { ...STATE, displays: new Map([...STATE.displays, [code, { ...display, filter }]]) };
}

// 推导出的分组，数据源换成内联 GeoJSON（不请求瓦片），图层去掉瓦片图层名
function groupOf(overrides: Readonly<Record<string, ResourceSymbolOverride>>, state = STATE): StyleGroup {
  const derived = resourcesGroup({
    state,
    invalid: new Map(),
    tileBase: 'http://localhost/',
    overrideOf: code => overrides[code]
  });
  const sources = Object.fromEntries(Object.keys(derived.sources).map(id => [id, dataOf(id)]));
  // GeoJSON 数据源的图层不能有瓦片图层名
  const layers = derived.layers.map(
    layer => Object.fromEntries(Object.entries(layer).filter(([key]) => key !== 'source-layer')) as LayerSpecification
  );
  return { ...derived, sources, layers };
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${WAIT_TIMEOUT} ms 内没有等到${label}`)), WAIT_TIMEOUT);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 下一次渲染完成，或者渲染中途抛出了错误（线型切换的缺陷会让每一帧都停在报错上，等不到 idle）；在触发变化之前调用
function nextRender(map: MapLibreMap, label: string): Promise<void> {
  let settle: (() => void) | undefined;
  const settled = new Promise<void>(resolve => {
    settle = () => resolve();
    map.once('idle', settle);
    window.addEventListener('error', settle, { once: true });
  });
  return withTimeout(settled, label).finally(() => {
    if (settle) {
      map.off('idle', settle);
      window.removeEventListener('error', settle);
    }
  });
}

function setup(
  camera: CameraState = { center: [118.8, 32.08], zoom: 9, bearing: 0, pitch: 0 },
  mapOptions?: Omit<MapLibreMapOptions, 'container' | 'style' | 'center' | 'zoom' | 'bearing' | 'pitch'>
) {
  const container = document.body.appendChild(document.createElement('div'));
  container.style.width = '800px';
  container.style.height = '600px';
  const session = new MapSession({ groups: ['resources', 'selection'], camera });
  session.style.setGroup('resources', groupOf({}));
  // 渲染中途抛出的错误没有经过视图，只能在窗口上收集
  const uncaught: string[] = [];
  const onUncaught = (event: ErrorEvent) => {
    uncaught.push(event.message);
    event.preventDefault();
  };
  window.addEventListener('error', onUncaught);
  const errors: unknown[] = [];
  let created: MapLibreMap | undefined;
  const view = new MapLibreView({
    session,
    container,
    ...(mapOptions ? { mapOptions } : {}),
    createMap: options => (created = new MapLibreMap(options)),
    onError: error => errors.push(error)
  });
  if (!created) {
    throw new Error('地图没有创建');
  }
  const map = created;
  return {
    session,
    view,
    map,
    errors,
    uncaught,
    [Symbol.dispose]() {
      window.removeEventListener('error', onUncaught);
      view[Symbol.dispose]();
      session[Symbol.dispose]();
      container.remove();
    }
  };
}

// 每个线型图层画出的要素按属性的取值
function renderedValues(map: MapLibreMap, property: string, prefix: string): Record<string, string[]> {
  const ids = map
    .getStyle()
    .layers.map(({ id }) => id)
    .filter(id => id === prefix || id.startsWith(`${prefix}-`));
  return Object.fromEntries(
    ids.map(id => {
      const features = map.queryRenderedFeatures({ layers: [id] });
      return [id, [...new Set(features.map(feature => String(feature.properties[property])))].toSorted()];
    })
  );
}

describe('资源图层按线型拆层（ADR 0046）', () => {
  it('线型来回切换（全实线 → 部分取值虚线 → 多种线型 → 全实线 → 统一样式虚线）没有未捕获的错误，要素画在对应的线型图层上', async () => {
    using ctx = setup();
    const { map, session } = ctx;
    await nextRender(map, '首次渲染完成');
    expect(ctx.uncaught).toStrictEqual([]);

    const steps: readonly (readonly [string, Readonly<Record<string, ResourceSymbolOverride>>])[] = [
      // 地类的 0101 先变成 XL 实线：建出描边图层，全是实线
      [
        '部分取值虚线',
        { [HYDL]: { items: { 水渠: { dash: 'dashed' } } }, [DLTB]: { items: { '0101': { outlineWidth: 'XL' } } } }
      ],
      [
        '多种线型',
        {
          [HYDL]: { items: { 河流: { dash: 'dotted' }, 水渠: { dash: 'dashed' } } },
          [DLTB]: { items: { '0101': { outlineWidth: 'XL' }, '0102': { outlineDash: 'dashDot' } } }
        }
      ],
      ['全实线', {}],
      ['统一样式虚线', { [HYDL]: { mode: 'uniform', uniform: { dash: 'dashed' } } }]
    ];
    const layers: Record<string, Record<string, string[]>> = {};
    for (const [label, overrides] of steps) {
      const rendered = nextRender(map, `${label}渲染完成`);
      session.style.setGroup('resources', groupOf(overrides));
      // oxlint-disable-next-line no-await-in-loop -- 每一步要等上一步画完，才是"旧瓦片画新样式"的切换
      await rendered;
      expect(ctx.uncaught, `切换到${label}时`).toStrictEqual([]);
      layers[label] = {
        ...renderedValues(map, 'ccn', `resources-${HYDL}`),
        ...renderedValues(map, 'dlbm', `resources-${DLTB}-outline`)
      };
    }

    expect(ctx.errors).toStrictEqual([]);
    expect(ctx.view.state).toBe('ready');
    expect(layers).toStrictEqual({
      部分取值虚线: {
        [`resources-${HYDL}`]: ['河流', '湖泊'],
        [`resources-${HYDL}-dashed`]: ['水渠'],
        [`resources-${DLTB}-outline`]: ['0101', '0102', '0103']
      },
      多种线型: {
        [`resources-${HYDL}`]: ['湖泊'],
        [`resources-${HYDL}-dashed`]: ['水渠'],
        [`resources-${HYDL}-dotted`]: ['河流'],
        [`resources-${DLTB}-outline`]: ['0101', '0103'],
        [`resources-${DLTB}-outline-dash-dot`]: ['0102']
      },
      全实线: { [`resources-${HYDL}`]: ['水渠', '河流', '湖泊'] },
      统一样式虚线: { [`resources-${HYDL}`]: ['水渠', '河流', '湖泊'] }
    });
  });
});

// 画布中心一块的像素，在 render 事件里读（还没交给页面合成，不需要 preserveDrawingBuffer）
const BLOCK = 32;

function centerBlock(map: MapLibreMap): string {
  const gl = map.getCanvas().getContext('webgl2');
  if (!gl) {
    throw new Error('地图没有 WebGL2 上下文');
  }
  const x = Math.floor((gl.drawingBufferWidth - BLOCK) / 2);
  const y = Math.floor((gl.drawingBufferHeight - BLOCK) / 2);
  const pixels = new Uint8Array(BLOCK * BLOCK * 4);
  gl.readPixels(x, y, BLOCK, BLOCK, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels.join(',');
}

// 地类图斑用统一样式的花纹
function uniform(fillStyle: 'diagonal' | 'backDiagonal'): Readonly<Record<string, ResourceSymbolOverride>> {
  return { [DLTB]: { mode: 'uniform', uniform: { fillStyle, fillColor: '#FFFF00', patternColor: '#0000FF' } } };
}

describe('面的花纹（ADR 0045）', () => {
  // 统一样式的花纹只随级别变化，MapLibre 会给它做过渡；过渡期间按旧图片取图集位置，而重新加载的瓦片里只有新图片，
  // 约 300 毫秒里画出别的花纹（docs/archive/migration.md"切换填充方式的闪烁"）
  it('切换填充方式：每一帧要么是原来的花纹，要么是新的花纹，中间不画出别的花纹', async () => {
    // 中心落在一个图斑里，15.5 级是最密的一档
    using ctx = setup({ center: [118.513, 31.9215], zoom: 15.5, bearing: 0, pitch: 0 });
    const { map, session } = ctx;
    const first = nextRender(map, '首次渲染完成');
    session.style.setGroup('resources', groupOf(uniform('diagonal')));
    await first;
    const before = centerBlock(map);

    const frames: string[] = [];
    const capture = () => frames.push(centerBlock(map));
    map.on('render', capture);
    try {
      const switched = nextRender(map, '切换后渲染完成');
      session.style.setGroup('resources', groupOf(uniform('backDiagonal')));
      await switched;
    } finally {
      map.off('render', capture);
    }

    const after = frames.at(-1);
    expect(after).not.toBe(before);
    const others = frames.filter(frame => frame !== before && frame !== after);
    expect(others, `${frames.length} 帧里有 ${others.length} 帧既不是原来的花纹也不是新的花纹`).toHaveLength(0);
    expect(ctx.errors).toStrictEqual([]);
  });
});

// 学校点的视角：12 级，M 档的点半径 4 像素、icon-size 是 1
const POINT_CAMERA: CameraState = { center: POINT_CENTER, zoom: 12, bearing: 0, pitch: 0 };

const renderedGuids = (features: readonly { readonly properties: Readonly<Record<string, unknown>> }[]) =>
  [...new Set(features.map(({ properties }) => String(properties.guid)))].toSorted();

// 以 (x, y) 为中心、半边长 half 的框
const boxAround = (x: number, y: number, half: number) => ({
  from: { x: x - half, y: y - half },
  to: { x: x + half, y: y + half }
});

// 屏幕上一块的像素（CSS 像素坐标），在下一次 render 事件里读
function pixelsAt(map: MapLibreMap, x: number, y: number, half: number): Promise<Uint8Array> {
  const gl = map.getCanvas().getContext('webgl2');
  if (!gl) {
    throw new Error('地图没有 WebGL2 上下文');
  }
  const ratio = gl.drawingBufferWidth / map.getCanvas().clientWidth;
  const size = Math.round(half * 2 * ratio);
  const read = new Promise<Uint8Array>(resolve => {
    map.once('render', () => {
      const pixels = new Uint8Array(size * size * 4);
      const left = Math.round((x - half) * ratio);
      const bottom = Math.round(gl.drawingBufferHeight - (y + half) * ratio);
      gl.readPixels(left, bottom, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      resolve(pixels);
    });
  });
  map.triggerRepaint();
  return withTimeout(read, '读出像素');
}

// 两个像素各通道相差最多多少
const difference = (a: readonly number[], b: readonly number[]) =>
  Math.max(...a.map((value, index) => Math.abs(value - (b[index] ?? 0))));

// 接近高亮色（#f5222d）的像素数
function reddish(pixels: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const [r = 0, g = 0, b = 0] = pixels.subarray(index, index + 3);
    count += r > 200 && g < 90 && b < 90 ? 1 : 0;
  }
  return count;
}

describe('点的形状（ADR 0159）', () => {
  it('8 种形状和按类别不同的形状都画得出、都查得到：不参与碰撞，没有报错，用到的图片加进了地图', async () => {
    // 9 级时点相距约 7 像素、图标互相压着：参与碰撞的话大多数点会被藏起来，也查不到
    using ctx = setup({ ...POINT_CAMERA, zoom: 9 });
    const { map, session } = ctx;
    await nextRender(map, '首次渲染完成');
    const steps: readonly (readonly [string, ResourceSymbolOverride])[] = [
      ...POINT_SHAPE_NAMES.map(shape => [shape, { mode: 'uniform', uniform: { shape } }] as const),
      [
        '按类别',
        { items: { '08H212': { shape: 'pin' }, '08H213': { shape: 'star', size: 'XL', strokeWidth: 3 } } }
      ]
    ];
    const drawn: Record<string, number> = {};
    for (const [label, override] of steps) {
      const rendered = nextRender(map, `${label}渲染完成`);
      session.style.setGroup('resources', groupOf({ [XXP]: override }));
      // oxlint-disable-next-line no-await-in-loop -- 每一步要等上一步画完再查
      await rendered;
      drawn[label] = map.queryRenderedFeatures({ layers: [`resources-${XXP}`] }).length;
    }

    expect(ctx.uncaught).toStrictEqual([]);
    expect(ctx.errors).toStrictEqual([]);
    expect(ctx.view.state).toBe('ready');
    expect(Object.values(drawn)).toStrictEqual(Array(steps.length).fill(25));
    const images = (['pin', 'star', 'circle'] as const).map(shape => map.hasImage(shapeImageId(shape)));
    expect(images).toStrictEqual([true, true, true]);
  });

  it('点选的容差框查得到 symbol 图层的点；查到的是图标图片碰到框的点，框选只留位置在框里的', async () => {
    using ctx = setup(POINT_CAMERA);
    const { map, view } = ctx;
    await nextRender(map, '首次渲染完成');
    const center = map.project(POINT_CENTER);
    const sources = [`resources-${XXP}`];
    const query = (area: { from: { x: number; y: number }; to: { x: number; y: number } }) =>
      view.queryRendered(area, { sources, withGeometry: true });

    // 点击位置的 10 像素容差框（同 PICK_TOLERANCES）
    expect(renderedGuids(query(boxAround(center.x, center.y, 10)))).toStrictEqual([pointGuid(CENTER_POINT)]);
    // 框在点右边 10～30 像素：点不在框里，但图标图片（四周留着描边用的距离场）碰到了框
    const beside = boxAround(center.x + 20, center.y, 10);
    const near = query(beside);
    expect(renderedGuids(near)).toStrictEqual([pointGuid(CENTER_POINT)]);
    expect(pointsInBox(near, beside, ([lng, lat]) => map.project([lng, lat]))).toStrictEqual([]);
    // 离得更远时查不到
    expect(query(boxAround(center.x + 40, center.y, 5))).toStrictEqual([]);
  });

  it('选中高亮跟着形状：selection 分组的 symbol 图层用资源分组的图片，按要素的属性取形状，描边是红色', async () => {
    using ctx = setup(POINT_CAMERA);
    const { map, session } = ctx;
    const resource = STATE.catalog?.resources.get(XXP);
    if (!resource) {
      throw new Error('目录里没有学校点层');
    }
    // 08H212 类是定位针，08H213 类照旧是圆
    const override: ResourceSymbolOverride = { items: { '08H212': { shape: 'pin' } } };
    const select = async (index: number) => {
      const feature = POINTS.features[index];
      if (!feature) {
        throw new Error(`没有第 ${index} 个点`);
      }
      const rendered = nextRender(map, `选中第 ${index} 个点`);
      session.style.setGroups({
        resources: groupOf({ [XXP]: override }),
        selection: selectionGroup({ feature, point: color => resourceHighlightStyle(resource, color, override) }, false)
      });
      await rendered;
      const [lng = 0, lat = 0] = feature.geometry.type === 'Point' ? feature.geometry.coordinates : [];
      const at = map.project([lng, lat]);
      // 要素位置上方 4～14 像素、下方 4～14 像素里的红色：定位针的针头在上面，针尖就在要素的位置
      return {
        above: reddish(await pixelsAt(map, at.x, at.y - 9, 5)),
        below: reddish(await pixelsAt(map, at.x, at.y + 9, 5))
      };
    };

    // 正中间的点是 08H212 类，画成定位针：红色描边只在上面
    const pin = await select(CENTER_POINT);
    expect(ctx.errors).toStrictEqual([]);
    expect(map.queryRenderedFeatures({ layers: ['selection-point'] })).toHaveLength(1);
    expect(pin.above).toBeGreaterThan(10);
    expect(pin.below).toBe(0);
    // 别的点没有高亮
    const other = map.project([POINT_CENTER[0] + POINT_SPACING, POINT_CENTER[1]]);
    expect(reddish(await pixelsAt(map, other.x, other.y, 10))).toBe(0);
    // 右边一个是 08H213 类，画成圆：上下都有红色描边
    const circle = await select(CENTER_POINT + 1);
    expect(circle.above).toBeGreaterThan(0);
    expect(circle.below).toBeGreaterThan(0);
  });

  it.each([60, 85])(
    '倾斜 %i° 时画面上方远处的点只画出形状和描边，图片的方框不露出来（写了 icon-offset 不按透视缩小，描边按瓦片的级别求值）',
    async pitch => {
      using ctx = setup({ center: FAR_START, zoom: 12, bearing: 0, pitch: 0 }, { maxPitch: 85 });
      const { map, session } = ctx;
      await nextRender(map, '首次渲染完成');
      // S 档、描边 3、红色：12 级的 icon-size 是 0.6，描边按平视的上限是 2.51，倾斜时最容易露出方框
      const rendered = nextRender(map, `倾斜 ${pitch}° 渲染完成`);
      session.style.setGroup(
        'resources',
        groupOf({ [XXP]: { mode: 'uniform', uniform: { size: 'S', strokeWidth: 3, strokeColor: '#FF0000' } } })
      );
      map.jumpTo({ pitch });
      await rendered;
      expect(map.getPitch()).toBe(pitch);

      // 画面上半部能看到、离别的点至少 24 像素的点里最远的一个
      const projected = FAR_POINTS.flatMap(({ geometry }) =>
        geometry.type === 'Point' ? [map.project([geometry.coordinates[0] ?? 0, geometry.coordinates[1] ?? 0])] : []
      );
      const apart = projected.filter(
        point =>
          point.x > 30 &&
          point.x < 770 &&
          point.y > 30 &&
          point.y < 300 &&
          projected.every(other => other === point || Math.hypot(other.x - point.x, other.y - point.y) >= 24)
      );
      const far = apart.toSorted((a, b) => a.y - b.y)[0];
      if (!far) {
        throw new Error('画面上方没有隔开的点');
      }
      // 图片的半边（icon-size 0.6，不按透视缩小）是 7.1 像素；斜着 4.3 像素处在形状和描边（4.9）外面、图片里面。
      // 靠近地平线时底色有雾的颜色：和同一行、点的左右 14 像素（图片外面）的底色比，差别不超过抗锯齿的余量（3 / 255）；
      // 露出方框时差几十
      const pixel = async (x: number, y: number) => [...(await pixelsAt(map, x, y, 0.5))];
      const corners = [-4.3, 4.3].flatMap(dy => [-4.3, 4.3].map(dx => [dx, dy] as const));
      const differences = await Promise.all(
        corners.map(async ([dx, dy]) =>
          difference(await pixel(far.x + dx, far.y + dy), await pixel(far.x + Math.sign(dx) * 14, far.y + dy))
        )
      );

      expect(difference(await pixel(far.x, far.y), await pixel(far.x + 14, far.y))).toBeGreaterThan(20);
      expect(Math.max(...differences)).toBeLessThanOrEqual(3);
      expect(ctx.errors).toStrictEqual([]);
    }
  );
});

describe('要素过滤（ADR 0173）', () => {
  it('点按分类过滤：只画勾着的类别，查到的也只有它们，没有报错', async () => {
    using ctx = setup({ ...POINT_CAMERA, zoom: 9 });
    const { map, session } = ctx;
    await nextRender(map, '首次渲染完成');
    const kept = ['08H213', '08H215'];
    const rendered = nextRender(map, '过滤后渲染完成');
    session.style.setGroup('resources', groupOf({}, withFilter(XXP, { [CLASS_FIELD]: kept })));
    // 样式没变时也要画一帧：等的是 idle，否则改坏的代码会超时而不是断言失败
    map.triggerRepaint();
    await rendered;

    const classes = map.queryRenderedFeatures({ layers: [`resources-${XXP}`] }).map(({ properties }) => String(properties.cc));
    const expected = POINTS.features.filter(({ properties }) => kept.includes(String(properties?.cc))).length;
    expect(new Set(classes)).toStrictEqual(new Set(kept));
    expect(classes).toHaveLength(expected);
    expect(ctx.uncaught).toStrictEqual([]);
    expect(ctx.errors).toStrictEqual([]);
  });

  it('面按地类过滤：主图层和拆出的描边图层都只画勾着的地类', async () => {
    using ctx = setup();
    const { map, session } = ctx;
    await nextRender(map, '首次渲染完成');
    const rendered = nextRender(map, '过滤后渲染完成');
    session.style.setGroup('resources', groupOf({}, withFilter(DLTB, { [CLASS_FIELD]: ['0101'] })));
    map.triggerRepaint();
    await rendered;

    const values = Object.values(renderedValues(map, 'dlbm', `resources-${DLTB}`)).filter(list => list.length > 0);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every(list => list.length === 1 && list[0] === '0101')).toBe(true);
    expect(ctx.uncaught).toStrictEqual([]);
    expect(ctx.errors).toStrictEqual([]);
  });
});
