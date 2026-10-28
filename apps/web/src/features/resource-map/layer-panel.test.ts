// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ResourceTreeCategory } from './api';
import { buildCatalog } from './catalog';
import { CATALOG_ROOT } from './catalog-order';
import {
  checkedDropTarget,
  checkedLayers,
  expandedByDefault,
  moveTarget,
  type PanelNode,
  panelTree
} from './layer-panel';
import { EMPTY_RESOURCE_LAYERS, mergeDisplayState, type ResourceLayersState } from './resource-layers';

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

// 树里的全部资源，按显示的顺序
function flatten(node: PanelNode): PanelNode[] {
  return node.kind === 'resource' ? [node] : node.children.flatMap(flatten);
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
  });

  it('一个也没有勾选时展开全部分类（ADR 0094）', () => {
    expect(expandedByDefault(panelTree(withChecked(INITIAL, ['bgdc_dltb'], false)))).toStrictEqual(
      new Set(['基础库', '基础库 / 土地资源', '基础库 / 水资源', '三区三线'])
    );
  });
});

describe('checkedLayers 与 moveTarget', () => {
  // 面板顺序：地类图斑、村级调查区、村级调查区界线、坑塘、POI；勾选其中三个
  const state = withChecked(INITIAL, ['bgdc_cjdcqjx', 'poi']);

  it('已勾选的资源按叠放顺序从上到下，带透明度、显示的年份和可选的年份（新的在前）', () => {
    const reordered = { ...state, order: ['poi', ...state.order.filter(code => code !== 'poi')] };

    expect(checkedLayers(reordered)).toStrictEqual([
      { code: 'poi', name: 'POI 点层', opacity: 1, year: 2025, years: [2025, 2024, 2023] },
      { code: 'bgdc_dltb', name: '地类图斑', opacity: 1, year: 2024, years: [2024] },
      { code: 'bgdc_cjdcqjx', name: '村级调查区界线', opacity: 1, year: 2024, years: [2024] }
    ]);
  });

  it('显示的年份跟着显示状态，名称不带年份', () => {
    const poi = state.displays.get('poi');
    const older = poi ? { ...state, displays: new Map([...state.displays, ['poi', { ...poi, year: 2023 }]]) } : state;

    expect(checkedLayers(older).find(({ code }) => code === 'poi')).toMatchObject({ name: 'POI 点层', year: 2023 });
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

describe('目录顺序（ADR 0053 第 6 节）', () => {
  it('按记录的顺序排：记录里的在前，目录里新出现的按目录顺序排在后面，已经不在的键忽略', () => {
    const order = {
      [CATALOG_ROOT]: ['三区三线', '基础库'],
      '基础库 / 土地资源': ['bgdc_cjdcqjx', '已删除的资源', 'bgdc_dltb']
    };

    expect(outline(panelTree(INITIAL, '', order))).toStrictEqual([
      ['三区三线(none)', ['poi']],
      [
        '基础库(some)',
        [
          ['土地资源(some)', ['bgdc_cjdcqjx', 'bgdc_dltb', 'bgdc_cjdcq']],
          ['水资源(none)', ['szy_kt']]
        ]
      ]
    ]);
  });

  it('搜索时保留调整过的相对顺序', () => {
    const order = { '基础库 / 土地资源': ['bgdc_cjdcqjx', 'bgdc_dltb', 'bgdc_cjdcq'] };

    expect(outline(panelTree(INITIAL, '村级', order))).toStrictEqual([
      ['基础库(none)', [['土地资源(none)', ['bgdc_cjdcqjx', 'bgdc_cjdcq']]]]
    ]);
  });

  it('资源带几何类型，名称前显示对应的图标', () => {
    const resources = panelTree(INITIAL).flatMap(flatten);

    expect(resources.map(node => (node.kind === 'resource' ? [node.code, node.geometry] : null))).toStrictEqual([
      ['bgdc_dltb', 'fill'],
      ['bgdc_cjdcq', 'fill'],
      ['bgdc_cjdcqjx', 'line'],
      ['szy_kt', 'fill'],
      ['poi', 'circle']
    ]);
  });
});

describe('checkedDropTarget', () => {
  // 面板顺序：地类图斑、村级调查区、村级调查区界线、坑塘、POI；勾选其中三个
  const state = withChecked(INITIAL, ['bgdc_cjdcqjx', 'poi']);

  function dropped(code: string, to: number): string[] | null {
    const target = checkedDropTarget(state, code, to);
    if (target === null) {
      return null;
    }
    const order = state.order.toSpliced(state.order.indexOf(code), 1).toSpliced(target, 0, code);
    return checkedLayers({ ...state, order }).map(item => item.code);
  }

  it('拖到"已选择图层"里的第几位，就交给拥有者那个位置上原来的资源所在的位置；中间没勾选的不算', () => {
    expect(dropped('poi', 0)).toStrictEqual(['poi', 'bgdc_dltb', 'bgdc_cjdcqjx']);
    expect(dropped('bgdc_dltb', 2)).toStrictEqual(['bgdc_cjdcqjx', 'poi', 'bgdc_dltb']);
    expect(dropped('bgdc_dltb', 1)).toStrictEqual(['bgdc_cjdcqjx', 'bgdc_dltb', 'poi']);
  });

  it('位置不变、不在"已选择图层"里时为 null；位置越界时抛错', () => {
    expect(checkedDropTarget(state, 'poi', 2)).toBeNull();
    expect(checkedDropTarget(state, 'szy_kt', 0)).toBeNull();
    expect(() => checkedDropTarget(state, 'poi', 3)).toThrow(RangeError);
  });
});
