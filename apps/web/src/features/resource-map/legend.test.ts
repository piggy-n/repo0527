// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ResourceTreeLayer } from './api';
import { buildCatalog } from './catalog';
import { LANDUSE_FALLBACK_COLOR } from './landuse';
import { type LanduseLegendView, landuseLegend, type LegendEntry, legendEntries, legendEntrySet } from './legend';
import {
  EMPTY_RESOURCE_LAYERS,
  mergeDisplayState,
  type ResourceLayersState,
  resourcesGroup
} from './resource-layers';
import { RESOURCE_PALETTE } from './style-registry';

function layer(code: string, name: string, geoType: ResourceTreeLayer['geoType']) {
  return { code, name, geoType, yearList: [2022] as [number] };
}

// 每种条目各一个：地类按编码、按名称，按取值（线、按顺序取色的面），统一符号（面、线、点）
const CATALOG = buildCatalog([
  {
    code: null,
    name: '测试',
    children: [
      layer('bgdc_dltb', '地类图斑', 'Polygon'),
      layer('bgdc_dltb_czc', '地类图斑（城镇村）', 'Polygon'),
      layer('csxhjctb_hydl', '水域线层', 'Line'),
      layer('bgdc_czcdyd', '城镇村等用地', 'Polygon'),
      layer('szy_kt', '坑塘', 'Polygon'),
      layer('bgdc_cjdcqjx', '村级调查区界线', 'Line'),
      layer('csxhjctb_gyssp', '公用设施点层', 'Point')
    ]
  }
]);

function checkAll(state: ResourceLayersState): ResourceLayersState {
  const displays = new Map([...state.displays].map(([code, display]) => [code, { ...display, checked: true }]));
  return { ...state, displays };
}

const ALL = checkAll(mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG));

function entryOf(entries: readonly LegendEntry[], code: string): LegendEntry {
  const found = entries.find(entry => entry.code === code);
  if (!found) {
    throw new Error(`图例里没有 ${code}`);
  }
  return found;
}

// 按资源取条目，比较时不看顺序
function byCode(entries: readonly LegendEntry[]): Record<string, LegendEntry> {
  return Object.fromEntries(entries.map(entry => [entry.code, entry]));
}

describe('legendEntries', () => {
  it('勾选且配置合法的资源，按叠放顺序从上到下；没勾选的、配置错误的不进图例', () => {
    const state = { ...ALL, order: ['szy_kt', ...ALL.order.filter(code => code !== 'szy_kt')] };
    const displays = new Map(state.displays);
    const hydl = displays.get('csxhjctb_hydl');
    if (hydl) {
      displays.set('csxhjctb_hydl', { ...hydl, checked: false });
    }

    const entries = legendEntries({ ...state, displays }, new Map([['bgdc_cjdcqjx', ['配置错误']]]));

    expect(entries.map(entry => entry.code)).toStrictEqual([
      'szy_kt',
      'bgdc_dltb',
      'bgdc_dltb_czc',
      'bgdc_czcdyd',
      'csxhjctb_gyssp'
    ]);
    expect(legendEntries(EMPTY_RESOURCE_LAYERS, new Map())).toStrictEqual([]);
  });

  it('地类图斑按编码、地类图斑（城镇村）按名称：内容是地类图例', () => {
    const entries = legendEntries(ALL, new Map());

    expect(entryOf(entries, 'bgdc_dltb')).toMatchObject({ kind: 'landuse', match: 'code', name: '地类图斑' });
    expect(entryOf(entries, 'bgdc_dltb_czc')).toMatchObject({ kind: 'landuse', match: 'name' });
  });

  it('按取值配色：列出取值和颜色，最后一项"其他"是兜底色；预览按几何类型', () => {
    const entries = legendEntries(ALL, new Map());

    expect(entryOf(entries, 'csxhjctb_hydl')).toStrictEqual({
      kind: 'values',
      code: 'csxhjctb_hydl',
      name: '水域线层',
      values: [
        { label: '河流', swatch: { geometry: 'line', color: '#1E88E5' } },
        { label: '水渠', swatch: { geometry: 'line', color: '#4FC3F7' } },
        { label: '其他', swatch: { geometry: 'line', color: '#2F80ED' } }
      ]
    });
    const czcdyd = entryOf(entries, 'bgdc_czcdyd');
    expect(czcdyd.kind === 'values' ? czcdyd.values.map(({ label, swatch }) => [label, swatch]) : null).toStrictEqual([
      ...['201', '201A', '202', '202A', '203', '203A', '204', '205'].map((label, index) => [
        label,
        { geometry: 'fill', fill: RESOURCE_PALETTE[index], outline: RESOURCE_PALETTE[index] }
      ]),
      ['其他', { geometry: 'fill', fill: LANDUSE_FALLBACK_COLOR, outline: LANDUSE_FALLBACK_COLOR }]
    ]);
  });

  it('统一符号：面是半透明填充加同色描边，线是实线，点带白边', () => {
    const entries = legendEntries(ALL, new Map());

    expect(entryOf(entries, 'szy_kt')).toMatchObject({
      kind: 'symbol',
      swatch: { geometry: 'fill', fill: 'rgba(176,58,107,0.35)', outline: RESOURCE_PALETTE[4] }
    });
    expect(entryOf(entries, 'bgdc_cjdcqjx')).toMatchObject({
      swatch: { geometry: 'line', color: RESOURCE_PALETTE[5] }
    });
    expect(entryOf(entries, 'csxhjctb_gyssp')).toMatchObject({
      swatch: { geometry: 'circle', fill: RESOURCE_PALETTE[6], stroke: '#FFFFFF' }
    });
  });

  it('颜色和分组推导出的图层是同一份：预览的颜色就是图层上的颜色', () => {
    const group = resourcesGroup({ state: ALL, invalid: new Map(), tileBase: 'http://localhost/tiles/' });
    const paintOf = (code: string) => group.layers.find(item => item.id === `resources-${code}`)?.paint;
    const entries = legendEntries(ALL, new Map());

    const fill = 'rgba(176,58,107,0.35)';
    expect(paintOf('szy_kt')).toMatchObject({ 'fill-color': fill, 'fill-outline-color': RESOURCE_PALETTE[4] });
    expect(entryOf(entries, 'szy_kt')).toMatchObject({ swatch: { fill } });
    expect(paintOf('csxhjctb_gyssp')).toMatchObject({ 'circle-color': RESOURCE_PALETTE[6] });
  });

  it('调整叠放顺序不改变颜色', () => {
    const reordered = { ...ALL, order: ALL.order.toReversed() };

    expect(byCode(legendEntries(reordered, new Map()))).toStrictEqual(byCode(legendEntries(ALL, new Map())));
  });
});

describe('legendEntrySet', () => {
  it('只看有哪些资源，不看顺序', () => {
    const entries = legendEntries(ALL, new Map());

    expect(legendEntrySet(entries.toReversed())).toBe(legendEntrySet(entries));
    expect(legendEntrySet(entries.slice(1))).not.toBe(legendEntrySet(entries));
  });
});

// 地类图例的轮廓："分组名:地类数"
function outline(view: LanduseLegendView, keyword?: string): string[] {
  return landuseLegend(view, keyword).map(section => `${section.name}:${section.items.length}`);
}

describe('landuseLegend', () => {
  it('三种展示：表 A.2 的 13 组、表 A.1 的 12 组、全部平铺；最后都是历史地类和未匹配的地类', () => {
    expect(outline('work')).toHaveLength(15);
    expect(outline('work').slice(0, 2)).toStrictEqual(['湿地:8', '耕地:3']);
    expect(outline('status')).toHaveLength(14);
    expect(outline('status').slice(0, 2)).toStrictEqual(['耕地:3', '园地:8']);
    expect(outline('all')).toStrictEqual(['全部地类:69', '历史地类:6', '未匹配的地类:1']);
  });

  it('地类带颜色、含义和可调整的标记；未匹配的地类是兜底色', () => {
    const [wetland] = landuseLegend('work');
    const [unmatched] = landuseLegend('all', '未匹配');

    expect(wetland?.items[0]).toStrictEqual({
      code: '0303',
      name: '红树林地',
      color: 'rgb(49, 173, 105)',
      meaning: '沿海生长红树植物的林地。',
      adjustable: false
    });
    expect(landuseLegend('all', '0201K')[0]?.items[0]?.adjustable).toBe(true);
    expect(unmatched?.items).toStrictEqual([
      expect.objectContaining({ code: null, color: LANDUSE_FALLBACK_COLOR })
    ]);
  });

  it('搜索编码或名称（不区分大小写、去掉首尾空格）；分组的编码或名称命中时留下整组', () => {
    expect(outline('work', ' 0101 ')).toStrictEqual(['耕地:1']);
    expect(outline('all', '05h1')).toStrictEqual(['全部地类:1']);
    expect(outline('work', '林地')).toContain('林地:7');
    expect(outline('status', '工矿仓储')).toStrictEqual(['工矿仓储用地:4']);
    expect(outline('status', '06')).toContain('工矿仓储用地:4');
    expect(outline('work', '城市')).toStrictEqual(['历史地类:1']);
    expect(outline('work', '没有这个')).toStrictEqual([]);
  });

  it('表 A.1 里物流仓储用地归工矿仓储用地、沼泽地归其他土地', () => {
    const status = landuseLegend('status');
    const namesIn = (name: string) => status.find(section => section.name === name)?.items.map(item => item.name);

    expect(namesIn('工矿仓储用地')).toContain('物流仓储用地');
    expect(namesIn('其他土地')).toContain('沼泽地');
    expect(namesIn('林地')).toContain('红树林地');
  });
});
