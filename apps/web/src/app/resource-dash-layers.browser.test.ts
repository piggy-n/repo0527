import type { GeoJSONSourceSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { MapLibreView, MapSession, type StyleGroup } from '@yzt/map-core';
import type { Feature, FeatureCollection } from 'geojson';
import { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from '@/features/resource-map/catalog';
import {
  EMPTY_RESOURCE_LAYERS,
  mergeDisplayState,
  type ResourceLayersState,
  resourcesGroup
} from '@/features/resource-map/resource-layers';
import type { ResourceSymbolOverride } from '@/features/resource-map/resource-symbols';

// 资源图层按线型拆层（ADR 0046）放在真实 MapLibre 上：用推导出的分组，数据换成内联 GeoJSON。
// 放在 app 里：要用原生地图等渲染完成、查画出的要素，只有 app 和 MapLibre 适配器能导入 maplibre-gl

const WAIT_TIMEOUT = 10_000;
const HYDL = 'csxhjctb_hydl';
const DLTB = 'bgdc_dltb';

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

const DATA: ReadonlyMap<string, FeatureCollection> = new Map([
  [`resources-${HYDL}`, LINES],
  [`resources-${DLTB}`, AREAS]
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
        { code: DLTB, name: '地类图斑', geoType: 'Polygon', yearList: [2022] }
      ]
    }
  ]);
  const state = mergeDisplayState(EMPTY_RESOURCE_LAYERS, catalog);
  const displays = new Map([...state.displays].map(([code, display]) => [code, { ...display, checked: true }]));
  return { ...state, displays };
}

const STATE = checkedState();

// 推导出的分组，数据源换成内联 GeoJSON（不请求瓦片），图层去掉瓦片图层名
function groupOf(overrides: Readonly<Record<string, ResourceSymbolOverride>>): StyleGroup {
  const derived = resourcesGroup({
    state: STATE,
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

function setup() {
  const container = document.body.appendChild(document.createElement('div'));
  container.style.width = '800px';
  container.style.height = '600px';
  const camera = { center: [118.8, 32.08] as const, zoom: 9, bearing: 0, pitch: 0 };
  const session = new MapSession({ groups: ['resources'], camera });
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
