// @vitest-environment node
import type { SourceActivity } from '@mx/map-core';
import { describe, expect, it } from 'vitest';
import { type CatalogNode, expandedByDefault, leavesOf } from '@/shared/map/layer-panel/catalog-tree';
import type { ResourceTreeCategory } from './api';
import { buildCatalog } from './catalog';
import { currentLayers, resourceCatalogNodes, resourceCodeOfKey, resourceKey, resourceRequests } from './layer-panel';
import {
  EMPTY_RESOURCE_LAYERS,
  mergeDisplayState,
  type ResourceLayersState,
  resourceSourceId,
  withAdded,
  withMoved
} from './resource-layers';

function layer(
  code: string,
  name: string,
  geoType: 'Polygon' | 'Line' | 'Point' = 'Polygon',
  yearList: [number, ...number[]] = [2024]
) {
  return { code, name, geoType, yearList };
}

// 结构同真实的资源树：公共库、海洋资源是空分类
const TREE: ResourceTreeCategory[] = [
  {
    code: null,
    name: '基础库',
    children: [
      {
        code: 'tdzy',
        name: '土地资源',
        children: [
          layer('bgdc_dltb', '地类图斑'),
          layer('bgdc_cjdcq', '村级调查区'),
          layer('bgdc_cjdcqjx', '村级调查区界线', 'Line')
        ]
      },
      { code: null, name: '海洋资源', children: [] },
      { code: 'szy', name: '水资源', children: [layer('szy_kt', '坑塘')] }
    ]
  },
  { code: null, name: '公共库', children: [{ code: null, name: '气象', children: [] }] },
  { code: 'sqsx', name: '三区三线', children: [layer('poi', 'POI 点层', 'Point', [2023, 2024, 2025])] }
];

// 只有地类图斑默认在当前地图里
const INITIAL = mergeDisplayState(EMPTY_RESOURCE_LAYERS, buildCatalog(TREE));

// 节点的名称，分类后面括号里是它的子节点
function outline(nodes: readonly CatalogNode[]): unknown[] {
  return nodes.map(node => (node.kind === 'leaf' ? node.label : [node.label, outline(node.children)]));
}

describe('resourceKey', () => {
  it('资源的键带前缀，能反查资源；不是资源的键为 null', () => {
    expect(resourceKey('bgdc_dltb')).toBe('resource:bgdc_dltb');
    expect(resourceCodeOfKey('resource:bgdc_dltb')).toBe('bgdc_dltb');
    expect(resourceCodeOfKey('model:sz-station')).toBeNull();
  });
});

describe('resourceCatalogNodes', () => {
  it('目录还没加载：空', () => {
    expect(resourceCatalogNodes(EMPTY_RESOURCE_LAYERS)).toStrictEqual([]);
  });

  it('按目录的顺序，和叠放顺序无关；没有资源的分类不显示（ADR 0157）', () => {
    const reordered = withMoved(withAdded(INITIAL, ['poi', 'szy_kt']), 'bgdc_dltb', 0);

    expect(outline(resourceCatalogNodes(reordered))).toStrictEqual([
      ['基础库', [['土地资源', ['地类图斑', '村级调查区', '村级调查区界线']], ['水资源', ['坑塘']]]],
      ['三区三线', ['POI 点层']]
    ]);
  });

  it('项带着键、几何类型的图标和是否已加入', () => {
    const state = withAdded(INITIAL, ['poi']);
    const leaves = resourceCatalogNodes(state).flatMap(leavesOf);

    expect(leaves.map(({ key, icon, added }) => [key, icon, added])).toStrictEqual([
      ['resource:bgdc_dltb', 'geometry-polygon', true],
      ['resource:bgdc_cjdcq', 'geometry-polygon', false],
      ['resource:bgdc_cjdcqjx', 'geometry-line', false],
      ['resource:szy_kt', 'geometry-polygon', false],
      ['resource:poi', 'geometry-point', true]
    ]);
  });

  it('关键字：只留名称命中的资源和它的路径，去掉首尾空格、不区分大小写；分类名称命中时留下它的全部资源', () => {
    expect(outline(resourceCatalogNodes(INITIAL, '  poi '))).toStrictEqual([['三区三线', ['POI 点层']]]);
    expect(outline(resourceCatalogNodes(INITIAL, '土地'))).toStrictEqual([
      ['基础库', [['土地资源', ['地类图斑', '村级调查区', '村级调查区界线']]]]
    ]);
    expect(resourceCatalogNodes(INITIAL, '没有这个')).toStrictEqual([]);
  });

  it('默认展开含有已加入资源的分类；一个也没有加入时展开全部（ADR 0094）', () => {
    const nodes = resourceCatalogNodes(INITIAL);
    const labels = (keys: ReadonlySet<string>) =>
      [...keys].map(key => {
        const find = (list: readonly CatalogNode[]): string | undefined =>
          list.flatMap(node => (node.key === key ? [node.label] : node.kind === 'branch' ? [find(node.children)] : []))
            .find(label => label !== undefined);
        return find(nodes);
      });

    expect(labels(expandedByDefault(nodes))).toStrictEqual(['基础库', '土地资源']);
    const none: ResourceLayersState = {
      ...INITIAL,
      displays: new Map([...INITIAL.displays].map(([code, display]) => [code, { ...display, added: false }]))
    };
    expect(labels(expandedByDefault(resourceCatalogNodes(none)))).toStrictEqual(['基础库', '土地资源', '水资源', '三区三线']);
  });
});

describe('currentLayers', () => {
  it('当前地图里的资源按叠放顺序从上到下，带透明度、显示、年份和可选的年份（新的在前）；隐藏的也在', () => {
    const added = withAdded(INITIAL, ['poi']);
    const dltb = added.displays.get('bgdc_dltb');
    const state = dltb ? { ...added, displays: new Map([...added.displays, ['bgdc_dltb', { ...dltb, checked: false }]]) } : added;

    expect(currentLayers(state)).toStrictEqual([
      {
        code: 'poi',
        name: 'POI 点层',
        geometry: 'circle',
        opacity: 1,
        year: 2025,
        years: [2025, 2024, 2023],
        visible: true
      },
      { code: 'bgdc_dltb', name: '地类图斑', geometry: 'fill', opacity: 1, year: 2024, years: [2024], visible: false }
    ]);
  });

  it('目录还没加载：空', () => {
    expect(currentLayers(EMPTY_RESOURCE_LAYERS)).toStrictEqual([]);
  });
});

describe('resourceRequests', () => {
  it('当前地图里这一轮请求过瓦片的资源，按叠放顺序，键同当前图层的行；别的数据源、没加入的不算（ADR 0158）', () => {
    const state = withAdded(INITIAL, ['poi']);
    const activity: SourceActivity = { requested: 3, loaded: 1, failed: 0, startedAt: 0, finishedAt: null };
    const activities = new Map<string, SourceActivity>([
      [resourceSourceId('bgdc_dltb'), activity],
      [resourceSourceId('szy_kt'), activity],
      ['basemap-vector', activity],
      [resourceSourceId('poi'), { ...activity, finishedAt: 5 }]
    ]);

    expect(resourceRequests(state, activities)).toStrictEqual([
      { kind: 'tiles', key: 'resource:poi', name: 'POI 点层', icon: 'geometry-point', activity: { ...activity, finishedAt: 5 } },
      { kind: 'tiles', key: 'resource:bgdc_dltb', name: '地类图斑', icon: 'geometry-polygon', activity }
    ]);
  });
});
