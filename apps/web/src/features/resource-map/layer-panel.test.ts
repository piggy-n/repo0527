// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ResourceTreeCategory } from './api';
import { buildCatalog } from './catalog';
import { checkedLayers, expandedByDefault, moveTarget, type PanelNode, panelTree } from './layer-panel';
import { EMPTY_RESOURCE_LAYERS, mergeDisplayState, type ResourceLayersState } from './resource-layers';

function layer(code: string, name: string, geoType: 'Polygon' | 'Line' | 'Point' = 'Polygon') {
  return { code, name, geoType, yearList: [2024] as [number] };
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
  { code: 'sqsx', name: '三区三线', children: [layer('poi', 'POI 点层', 'Point')] }
];

const INITIAL = mergeDisplayState(EMPTY_RESOURCE_LAYERS, buildCatalog(TREE));

function withChecked(state: ResourceLayersState, codes: readonly string[], checked = true): ResourceLayersState {
  const displays = new Map(state.displays);
  for (const code of codes) {
    const display = displays.get(code);
    if (display) {
      displays.set(code, { ...display, checked });
    }
  }
  return { ...state, displays };
}

// 树的轮廓：分类写成"名称(勾选状态)"，资源写成 code
function outline(nodes: readonly PanelNode[]): unknown[] {
  return nodes.map(node =>
    node.kind === 'resource' ? node.code : [`${node.name}(${node.checkState})`, outline(node.children)]
  );
}

// 按拥有者 move 的语义移动，返回移动后已勾选资源的顺序
function moved(state: ResourceLayersState, code: string, direction: 'up' | 'down'): string[] | null {
  const target = moveTarget(state, code, direction);
  if (target === null) {
    return null;
  }
  const order = state.order.toSpliced(state.order.indexOf(code), 1).toSpliced(target, 0, code);
  return checkedLayers({ ...state, order }).map(item => item.code);
}

describe('panelTree', () => {
  it('目录还没加载：空树', () => {
    expect(panelTree(EMPTY_RESOURCE_LAYERS)).toStrictEqual([]);
  });

  it('按目录顺序；没有资源的分类不显示；分类的勾选状态分全部、部分、都没有', () => {
    expect(outline(panelTree(INITIAL))).toStrictEqual([
      [
        '基础库(some)',
        [
          ['土地资源(some)', ['bgdc_dltb', 'bgdc_cjdcq', 'bgdc_cjdcqjx']],
          ['水资源(none)', ['szy_kt']]
        ]
      ],
      ['三区三线(none)', ['poi']]
    ]);

    const allLand = withChecked(INITIAL, ['bgdc_cjdcq', 'bgdc_cjdcqjx']);
    expect(outline(panelTree(allLand)).slice(0, 1)).toStrictEqual([
      ['基础库(some)', [['土地资源(all)', ['bgdc_dltb', 'bgdc_cjdcq', 'bgdc_cjdcqjx']], ['水资源(none)', ['szy_kt']]]]
    ]);
  });

  it('分类带着它下面全部资源的 code（勾选分类时一起勾选，数量显示在旁边）', () => {
    const [base] = panelTree(INITIAL);

    expect(base?.codes).toStrictEqual(['bgdc_dltb', 'bgdc_cjdcq', 'bgdc_cjdcqjx', 'szy_kt']);
  });

  it('关键字：只留名称命中的资源和它的路径，去掉首尾空格、不区分大小写；勾选和数量只算命中的', () => {
    const tree = panelTree(INITIAL, ' 村级 ');

    expect(outline(tree)).toStrictEqual([
      ['基础库(none)', [['土地资源(none)', ['bgdc_cjdcq', 'bgdc_cjdcqjx']]]]
    ]);
    expect(tree[0]?.codes).toStrictEqual(['bgdc_cjdcq', 'bgdc_cjdcqjx']);
    expect(outline(panelTree(INITIAL, 'poi'))).toStrictEqual([['三区三线(none)', ['poi']]]);
  });

  it('关键字命中分类的名称：留下它的全部资源；什么都没命中时是空树', () => {
    expect(outline(panelTree(INITIAL, '土地'))).toStrictEqual([
      ['基础库(some)', [['土地资源(some)', ['bgdc_dltb', 'bgdc_cjdcq', 'bgdc_cjdcqjx']]]]
    ]);
    expect(outline(panelTree(INITIAL, '基础库'))[0]).toStrictEqual(outline(panelTree(INITIAL))[0]);
    expect(panelTree(INITIAL, '没有这个')).toStrictEqual([]);
  });
});

describe('expandedByDefault', () => {
  it('展开含有勾选资源的分类', () => {
    expect(expandedByDefault(panelTree(INITIAL))).toStrictEqual(new Set(['基础库', '基础库 / 土地资源']));
    expect(expandedByDefault(panelTree(withChecked(INITIAL, ['bgdc_dltb'], false)))).toStrictEqual(new Set());
  });
});

describe('checkedLayers 与 moveTarget', () => {
  // 面板顺序：地类图斑、村级调查区、村级调查区界线、坑塘、POI；勾选其中三个
  const state = withChecked(INITIAL, ['bgdc_cjdcqjx', 'poi']);

  it('已勾选的资源按叠放顺序从上到下，带透明度', () => {
    const reordered = { ...state, order: ['poi', ...state.order.filter(code => code !== 'poi')] };

    expect(checkedLayers(reordered)).toStrictEqual([
      { code: 'poi', name: 'POI 点层', opacity: 0.9 },
      { code: 'bgdc_dltb', name: '地类图斑', opacity: 0.9 },
      { code: 'bgdc_cjdcqjx', name: '村级调查区界线', opacity: 0.9 }
    ]);
  });

  it('上移、下移一位：越过中间没勾选的资源，和相邻的已勾选资源交换', () => {
    expect(moved(state, 'bgdc_cjdcqjx', 'up')).toStrictEqual(['bgdc_cjdcqjx', 'bgdc_dltb', 'poi']);
    expect(moved(state, 'bgdc_cjdcqjx', 'down')).toStrictEqual(['bgdc_dltb', 'poi', 'bgdc_cjdcqjx']);
    expect(moved(state, 'bgdc_dltb', 'down')).toStrictEqual(['bgdc_cjdcqjx', 'bgdc_dltb', 'poi']);
  });

  it('已经在最上面、最下面，或者没有勾选：null', () => {
    expect(moveTarget(state, 'bgdc_dltb', 'up')).toBeNull();
    expect(moveTarget(state, 'poi', 'down')).toBeNull();
    expect(moveTarget(state, 'szy_kt', 'up')).toBeNull();
  });
});
