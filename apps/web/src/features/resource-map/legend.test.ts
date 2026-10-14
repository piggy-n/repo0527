// @vitest-environment node
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import type { ResourceTreeLayer } from './api';
import { buildCatalog } from './catalog';
import { LANDUSE_FALLBACK_COLOR } from './landuse';
import { type LanduseLegendView, landuseLegend, type LegendEntry, legendEntries, legendEntrySet } from './legend';
import { RESOURCE_PALETTE } from './palette';
import {
  EMPTY_RESOURCE_LAYERS,
  mergeDisplayState,
  type ResourceLayersState,
  resourcesGroup
} from './resource-layers';
import type { ResourceSymbolOverride } from './resource-symbols';
import { sizeCurve } from './symbols';

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
      mode: 'classified',
      // 统一样式的预览：按目录顺序从配色板取色
      swatch: { geometry: 'line', color: RESOURCE_PALETTE[2] },
      values: [
        { key: '河流', label: '河流', swatch: { geometry: 'line', color: '#1E88E5' } },
        { key: '水渠', label: '水渠', swatch: { geometry: 'line', color: '#4FC3F7' } },
        { key: '$other', label: '其他', swatch: { geometry: 'line', color: '#2F80ED' } }
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

  it('符号覆盖：图层和图例都从叠加后的符号推导；分类样式不用统一样式的覆盖', () => {
    const overrides = new Map<string, ResourceSymbolOverride>([
      ['szy_kt', { uniform: { fillColor: 'rgba(0, 0, 255, 0.5)' } }],
      ['bgdc_cjdcqjx', { uniform: { color: 'rgba(0, 128, 0, 1)', width: 'L', dash: 'dashed' } }],
      ['csxhjctb_gyssp', { uniform: { strokeColor: 'rgba(0, 0, 0, 1)', size: 6, strokeWidth: 3 } }],
      ['csxhjctb_hydl', { uniform: { color: 'rgba(0, 0, 0, 1)' } }]
    ]);
    const overrideOf = (code: string) => overrides.get(code);
    const tileBase = 'http://localhost/tiles/';
    const group = resourcesGroup({ state: ALL, invalid: new Map(), tileBase, overrideOf });
    const paintOf = (code: string) => group.layers.find(item => item.id === `resources-${code}`)?.paint;
    const entries = legendEntries(ALL, new Map(), overrideOf);

    // 填充换了颜色、描边没换：描边随缩放从主色（10 级）过渡到描边色（14 级，ADR 0045）
    expect(paintOf('szy_kt')).toMatchObject({
      'fill-color': 'rgba(0, 0, 255, 0.5)',
      'fill-outline-color': ['interpolate', ['linear'], ['zoom'], 10, 'rgba(0,0,255,1)', 14, RESOURCE_PALETTE[4]]
    });
    expect(entryOf(entries, 'szy_kt')).toMatchObject({ swatch: { fill: 'rgba(0, 0, 255, 0.5)', outline: RESOURCE_PALETTE[4] } });
    expect(paintOf('bgdc_cjdcqjx')).toMatchObject({
      'line-color': 'rgba(0, 128, 0, 1)',
      'line-width': sizeCurve('line', 'L'),
      'line-dasharray': [3, 2]
    });
    expect(entryOf(entries, 'bgdc_cjdcqjx')).toMatchObject({ swatch: { color: 'rgba(0, 128, 0, 1)' } });
    expect(paintOf('csxhjctb_gyssp')).toMatchObject({
      'circle-color': RESOURCE_PALETTE[6],
      'circle-radius': sizeCurve('circle', 6),
      'circle-stroke-color': 'rgba(0, 0, 0, 1)',
      'circle-stroke-width': 3
    });
    expect(entryOf(entries, 'csxhjctb_gyssp')).toMatchObject({ swatch: { stroke: 'rgba(0, 0, 0, 1)' } });

    const plain = resourcesGroup({ state: ALL, invalid: new Map(), tileBase });
    expect(paintOf('csxhjctb_hydl')).toStrictEqual(plain.layers.find(item => item.id === 'resources-csxhjctb_hydl')?.paint);
    // 分类样式的取值预览不变，变的只是统一样式的预览
    const hydl = entryOf(entries, 'csxhjctb_hydl');
    const plainHydl = entryOf(legendEntries(ALL, new Map()), 'csxhjctb_hydl');
    expect(hydl.kind === 'values' && hydl.values).toStrictEqual(plainHydl.kind === 'values' && plainHydl.values);
    expect(validateStyleMin({ version: 8, sources: group.sources, layers: group.layers.slice() })).toStrictEqual([]);
  });

  it('分类样式的覆盖：取值的预览和图层一起变；选了统一样式时图例带上方式和统一样式的预览', () => {
    const overrides = new Map<string, ResourceSymbolOverride>([
      ['csxhjctb_hydl', { uniform: { color: 'rgba(0, 0, 0, 1)' }, items: { 水渠: { color: 'rgba(255, 0, 0, 1)' } } }],
      ['bgdc_dltb', { mode: 'uniform', items: { '0101': { fillColor: 'rgba(0, 0, 255, 1)' } } }],
      ['bgdc_dltb_czc', { items: { 'legacy:城市用地': { fillColor: 'rgba(0, 255, 0, 1)' } } }]
    ]);
    const entries = legendEntries(ALL, new Map(), code => overrides.get(code));

    const hydl = entryOf(entries, 'csxhjctb_hydl');
    expect(hydl).toMatchObject({ mode: 'classified', swatch: { color: 'rgba(0, 0, 0, 1)' } });
    expect(hydl.kind === 'values' ? hydl.values.map(value => value.swatch) : []).toStrictEqual([
      { geometry: 'line', color: '#1E88E5' },
      { geometry: 'line', color: 'rgba(255, 0, 0, 1)' },
      { geometry: 'line', color: '#2F80ED' }
    ]);
    const dltb = entryOf(entries, 'bgdc_dltb');
    expect(dltb).toMatchObject({ kind: 'landuse', mode: 'uniform', swatch: { geometry: 'fill' } });
    expect(dltb.kind === 'landuse' ? dltb.swatches.get('0101') : null).toStrictEqual({
      geometry: 'fill',
      fill: 'rgba(0, 0, 255, 1)',
      outline: 'rgb(248, 208, 114)'
    });
    const czc = entryOf(entries, 'bgdc_dltb_czc');
    expect(czc.kind === 'landuse' ? czc.swatches.get('legacy:城市用地') : null).toMatchObject({ fill: 'rgba(0, 255, 0, 1)' });
    expect(czc.kind === 'landuse' ? czc.swatches.size : 0).toBe(76);
  });

  it('无填充的面：预览的填充透明，描边照常', () => {
    const overrides = new Map<string, ResourceSymbolOverride>([['szy_kt', { uniform: { fillStyle: 'none' } }]]);
    const entries = legendEntries(ALL, new Map(), code => overrides.get(code));

    expect(entryOf(entries, 'szy_kt')).toMatchObject({
      swatch: { geometry: 'fill', fill: 'rgba(0, 0, 0, 0)', outline: RESOURCE_PALETTE[4] }
    });
  });

  it('有花纹的面：预览带上花纹和纹理颜色；分类样式的取值也一样，纹理颜色默认是取值颜色加深', () => {
    const overrides = new Map<string, ResourceSymbolOverride>([
      ['szy_kt', { uniform: { fillStyle: 'xCross', patternColor: 'rgba(0, 0, 0, 1)' } }],
      ['bgdc_dltb', { items: { '0101': { fillStyle: 'dot' } } }]
    ]);
    const entries = legendEntries(ALL, new Map(), code => overrides.get(code));

    expect(entryOf(entries, 'szy_kt')).toMatchObject({
      swatch: { pattern: { name: 'xCross', color: 'rgba(0, 0, 0, 1)' } }
    });
    const dltb = entryOf(entries, 'bgdc_dltb');
    expect(dltb.kind === 'landuse' && dltb.swatches.get('0101')).toMatchObject({
      pattern: { name: 'dot', color: 'rgba(141,119,69,1)' }
    });
    expect(dltb.kind === 'landuse' && dltb.swatches.get('0102')).not.toHaveProperty('pattern');
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

  it('地类带取值的键、含义和可调整的标记；历史地类的键是 legacy:名称，未匹配的地类是 $other', () => {
    const [wetland] = landuseLegend('work');
    const [unmatched] = landuseLegend('all', '未匹配');

    expect(wetland?.items[0]).toStrictEqual({
      key: '0303',
      code: '0303',
      name: '红树林地',
      meaning: '沿海生长红树植物的林地。',
      adjustable: false
    });
    expect(landuseLegend('all', '0201K')[0]?.items[0]?.adjustable).toBe(true);
    expect(unmatched?.items).toStrictEqual([expect.objectContaining({ key: '$other', code: null })]);
    expect(landuseLegend('all', '城市用地').at(0)?.items[0]?.key).toBe('legacy:城市用地');
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
