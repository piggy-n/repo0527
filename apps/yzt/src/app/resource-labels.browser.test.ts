import type { GeoJSONSourceSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { type CameraState, MapLibreView, MapSession, type StyleGroup, type ToolView } from '@mx/map-core';
import type { Feature, FeatureCollection } from 'geojson';
import { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from '@/features/resource-map/catalog';
import { type PickResource, pickResources, planIdentify } from '@/features/resource-map/feature-query';
import { selectionLabelsGroup } from '@/features/resource-map/labels';
import {
  EMPTY_RESOURCE_LAYERS,
  labelTargetOf,
  mergeDisplayState,
  type ResourceLayersState,
  resourceLabelsGroup,
  resourcesGroup
} from '@/features/resource-map/resource-layers';
import type { ResourceSymbolOverride } from '@/features/resource-map/resource-symbols';
import { pointMarkOf } from '@/features/resource-map/style-registry';

// 资源的标注放在真实 MapLibre 上（ADR 0160）：推导出的 resources、resource-labels、selection-labels 分组，数据换成内联 GeoJSON。
// 样式不写 glyphs；测试页面没有加载普惠体，文字按后备字体画，这里只看放置、过滤、点选和字形请求，不看字形

const WAIT_TIMEOUT = 10_000;
const XXP = 'csxhjctb_xxp';
const DLTB = 'bgdc_dltb';
const CENTER: [number, number] = [119.5, 33];
const ZOOM = 16;

const guidOf = (index: number) => index.toString(16).padStart(32, '0');

// 学校点：一行 3 个，16 级时相距约 170 像素；第 3 个的名称是后端的占位值
const SCHOOLS: FeatureCollection = {
  type: 'FeatureCollection',
  features: ['实验小学', '第一中学', '-9999'].map(
    (name, index): Feature => ({
      type: 'Feature',
      properties: { guid: guidOf(index + 1), name, cc: '08H213' },
      geometry: { type: 'Point', coordinates: [CENTER[0] + (index - 1) * 0.004, CENTER[1]] }
    })
  )
};

// 地类图斑：两块挨着的面，学校和它们的名称都在面里
const PARCELS: FeatureCollection = {
  type: 'FeatureCollection',
  features: [0, 1].map(
    (index): Feature => ({
      type: 'Feature',
      properties: { guid: guidOf(10 + index), dlmc: index === 0 ? '水田' : '旱地', dlbm: index === 0 ? '0101' : '0103' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [CENTER[0] - 0.006 + index * 0.006, CENTER[1] - 0.004],
            [CENTER[0] + index * 0.006, CENTER[1] - 0.004],
            [CENTER[0] + index * 0.006, CENTER[1] + 0.004],
            [CENTER[0] - 0.006 + index * 0.006, CENTER[1] + 0.004],
            [CENTER[0] - 0.006 + index * 0.006, CENTER[1] - 0.004]
          ]
        ]
      }
    })
  )
};

const DATA: ReadonlyMap<string, FeatureCollection> = new Map([
  [`resources-${XXP}`, SCHOOLS],
  [`resources-${DLTB}`, PARCELS]
]);

function dataOf(sourceId: string): GeoJSONSourceSpecification {
  const data = DATA.get(sourceId);
  if (!data) {
    throw new Error(`没有数据源 ${sourceId} 的数据`);
  }
  return { type: 'geojson', data };
}

// 两个资源都加入、显示、开着标注；学校的名称用 20 号字，文字的框离点远一些
function labeledState(): ResourceLayersState {
  const catalog = buildCatalog([
    {
      code: null,
      name: '测试',
      children: [
        { code: XXP, name: '学校点层', geoType: 'Point', yearList: [2025] },
        { code: DLTB, name: '地类图斑', geoType: 'Polygon', yearList: [2022] }
      ]
    }
  ]);
  const state = mergeDisplayState(EMPTY_RESOURCE_LAYERS, catalog);
  const displays = new Map(
    [...state.displays].map(([code, display]) => [code, { ...display, added: true, checked: true, labeled: true }])
  );
  return { ...state, displays };
}

const STATE = labeledState();
const OVERRIDES: Readonly<Record<string, ResourceSymbolOverride>> = { [XXP]: { label: { size: 20 } } };
const overrideOf = (code: string) => OVERRIDES[code];

// GeoJSON 数据源的图层不能有瓦片图层名
const withoutSourceLayer = (layers: readonly LayerSpecification[]) =>
  layers.map(
    layer => Object.fromEntries(Object.entries(layer).filter(([key]) => key !== 'source-layer')) as LayerSpecification
  );

function resourcesOf(): StyleGroup {
  const derived = resourcesGroup({ state: STATE, invalid: new Map(), tileBase: 'http://localhost/', overrideOf });
  const sources = Object.fromEntries(Object.keys(derived.sources).map(id => [id, dataOf(id)]));
  return { ...derived, sources, layers: withoutSourceLayer(derived.layers) };
}

function labelsOf(emphasis: { readonly code: string; readonly guid: string } | null): StyleGroup {
  const group = resourceLabelsGroup({ state: STATE, invalid: new Map(), overrideOf, emphasis });
  return { ...group, layers: withoutSourceLayer(group.layers) };
}

function emphasisOf(code: string, guid: string): StyleGroup {
  const resource = STATE.catalog?.resources.get(code);
  const display = STATE.displays.get(code);
  const target = resource && display ? labelTargetOf(resource, display, overrideOf(code)) : null;
  const group = selectionLabelsGroup(target, guid);
  return { ...group, layers: withoutSourceLayer(group.layers) };
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${WAIT_TIMEOUT} ms 内没有等到${label}`)), WAIT_TIMEOUT);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 下一次渲染完成；在触发变化之前调用
function nextIdle(map: MapLibreMap, label: string): Promise<void> {
  let settle: (() => void) | undefined;
  const settled = new Promise<void>(resolve => {
    settle = () => resolve();
    map.once('idle', settle);
  });
  return withTimeout(settled, label).finally(() => {
    if (settle) {
      map.off('idle', settle);
    }
  });
}

function setup(camera: CameraState = { center: CENTER, zoom: ZOOM, bearing: 0, pitch: 0 }) {
  const container = document.body.appendChild(document.createElement('div'));
  container.style.width = '800px';
  container.style.height = '600px';
  const session = new MapSession({ groups: ['resources', 'resource-labels', 'selection-labels'], camera });
  session.style.setGroups({ resources: resourcesOf(), 'resource-labels': labelsOf(null) });
  const errors: unknown[] = [];
  // 字形的请求：样式不写 glyphs，应当一个都没有
  const glyphRequests: string[] = [];
  let created: MapLibreMap | undefined;
  const view = new MapLibreView({
    session,
    container,
    mapOptions: {
      // 标注不淡入，idle 时就是最后的放置
      fadeDuration: 0,
      transformRequest: (url, resourceType) => {
        if (String(resourceType) === 'Glyphs') {
          glyphRequests.push(url);
        }
        return { url };
      }
    },
    createMap: options => (created = new MapLibreMap(options)),
    onError: error => errors.push(error)
  });
  if (!created) {
    throw new Error('地图没有创建');
  }
  const map = created;
  const toolView: ToolView = {
    kind: '2d',
    pick: (point, options) => view.pick(point, options),
    project: lngLat => view.project(lngLat),
    queryRendered: (area, options) => view.queryRendered(area, options)
  };
  return {
    session,
    view,
    map,
    toolView,
    errors,
    glyphRequests,
    [Symbol.dispose]() {
      view[Symbol.dispose]();
      session[Symbol.dispose]();
      container.remove();
    }
  };
}

// 一个标注图层上画出来的要素的 guid
function labeled(map: MapLibreMap, layerId: string): string[] {
  if (!map.getLayer(layerId)) {
    return [];
  }
  const guids = map.queryRenderedFeatures({ layers: [layerId] }).map(feature => String(feature.properties.guid));
  return [...new Set(guids)].toSorted();
}

// 点击位置对着第一所学校名称的文字：名称在点的上方，20 号字，离开点 10 像素（点 16 级半径 6、描边 1，再空 3）
function aboveFirstSchool(toolView: ToolView): { readonly x: number; readonly y: number } {
  const [first] = SCHOOLS.features;
  const geometry = first?.geometry;
  if (geometry?.type !== 'Point') {
    throw new Error('第一所学校不是点');
  }
  const [lng = 0, lat = 0] = geometry.coordinates;
  const point = toolView.project([lng, lat]);
  if (!point) {
    throw new Error('投影不到第一所学校');
  }
  return { x: point.x, y: point.y - 22 };
}

describe('资源的标注（ADR 0160）', () => {
  it('画出点、面的标注：点的名称在点的上方，-9999 的不画；样式不写 glyphs，不请求字形', async () => {
    using ctx = setup();
    await nextIdle(ctx.map, '首次渲染完成');

    expect(ctx.errors).toStrictEqual([]);
    expect(labeled(ctx.map, `resource-labels-${XXP}`)).toStrictEqual([guidOf(1), guidOf(2)]);
    expect(labeled(ctx.map, `resource-labels-${DLTB}`)).toStrictEqual([guidOf(10), guidOf(11)]);
    expect(ctx.glyphRequests).toStrictEqual([]);
    // 点的标注在面的上面：上面的先放
    const ids = ctx.map.getStyle().layers.map(({ id }) => id);
    expect(ids.indexOf(`resource-labels-${XXP}`)).toBeGreaterThan(ids.indexOf(`resource-labels-${DLTB}`));
  });

  it('点到名称的文字时这个要素是点选的候选；不开标注时同一个位置点不到（离点超出容差）', async () => {
    using ctx = setup();
    await nextIdle(ctx.map, '首次渲染完成');
    const targets = pickResources(STATE, new Map(), ZOOM).filter(target => target.resource.code === XXP);
    const markOf = () => {
      const resource = STATE.catalog?.resources.get(XXP);
      return resource ? pointMarkOf(resource, ZOOM, overrideOf(XXP)) : null;
    };
    const click = aboveFirstSchool(ctx.toolView);

    const [withLabels] = planIdentify(targets, click, ZOOM, ctx.toolView, null, markOf, undefined, () => true) ?? [];
    const picked = withLabels?.kind === 'rendered' ? withLabels.candidates.map(({ guid }) => guid) : [];
    expect(picked).toStrictEqual([guidOf(1)]);

    const cleared = nextIdle(ctx.map, '去掉标注后渲染完成');
    ctx.session.style.setGroup('resource-labels', { sources: {}, layers: [] });
    await cleared;
    expect(planIdentify(targets, click, ZOOM, ctx.toolView, null, markOf, undefined, () => true)).toStrictEqual([]);
  });

  it('面板里地类图斑在学校上面时，点学校名称的文字照样选中学校：文字画在所有资源上面', async () => {
    using ctx = setup();
    await nextIdle(ctx.map, '首次渲染完成');
    const targets = pickResources({ ...STATE, order: [DLTB, XXP] }, new Map(), ZOOM);
    const markOf = (target: PickResource) => {
      const resource = STATE.catalog?.resources.get(target.resource.code);
      return resource ? pointMarkOf(resource, ZOOM, overrideOf(resource.code)) : null;
    };
    const click = aboveFirstSchool(ctx.toolView);

    const tasks = planIdentify(targets, click, ZOOM, ctx.toolView, null, markOf, undefined, () => true) ?? [];
    const summary = tasks.map(task => [
      task.target.resource.code,
      task.kind === 'rendered' ? task.candidates.map(({ guid }) => guid) : []
    ]);
    expect(summary).toStrictEqual([[XXP, [guidOf(1)]]]);
    // 不认标注时点到的是上面的地类图斑
    const [plain] = planIdentify(targets, click, ZOOM, ctx.toolView, null, markOf) ?? [];
    expect(plain?.target.resource.code).toBe(DLTB);
  });

  it('加强标注：资源的标注滤掉这个要素，加强的标注画它；两组一起提交', async () => {
    using ctx = setup();
    await nextIdle(ctx.map, '首次渲染完成');

    const emphasized = nextIdle(ctx.map, '加强标注后渲染完成');
    ctx.session.style.setGroups({
      'resource-labels': labelsOf({ code: XXP, guid: guidOf(1) }),
      'selection-labels': emphasisOf(XXP, guidOf(1))
    });
    await emphasized;

    expect(ctx.errors).toStrictEqual([]);
    expect(labeled(ctx.map, `resource-labels-${XXP}`)).toStrictEqual([guidOf(2)]);
    expect(labeled(ctx.map, `selection-labels-${XXP}`)).toStrictEqual([guidOf(1)]);
    expect(ctx.map.getPaintProperty(`selection-labels-${XXP}`, 'text-color')).toBe('#f5222d');
  });
});
