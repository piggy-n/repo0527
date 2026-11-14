// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { computed, shallowRef } from 'vue';
import type { CatalogNode } from '@/shared/map/layer-panel/catalog-tree';
import { sceneManifestSchema } from './api';
import { buildModelCatalog } from './catalog';
import {
  canRoamModel,
  modelCatalogNodes,
  modelCityNodes,
  modelIdOfKey,
  modelKey,
  modelKindOptions,
  modelRequests
} from './layer-panel';

const CATALOG = buildModelCatalog(
  sceneManifestSchema.parse({
    models: [
      {
        id: 'station',
        name: '苏州站地下空间',
        cityCode: '320500',
        kind: 'indoor',
        underground: true,
        tileset: 'S.json',
        routes: [{ id: 'enter', name: '进站', path: [[120.666, 31.3175, -5.1], [120.667, 31.3175, -5.1]] }]
      },
      {
        id: 'white',
        name: '苏州白膜',
        cityCode: '320500',
        kind: 'white',
        underground: false,
        effects: [{ id: 'plain', label: '无纹理', tileset: 'W/plain.json' }]
      },
      { id: 'city', name: '新街口倾斜摄影', cityCode: '320100', kind: 'oblique', underground: false, tileset: 'C.json' }
    ]
  }),
  'https://maps.test/3dt/manifest.json'
);

// 节点的键和名称，分类下面缩进
const outline = (nodes: readonly CatalogNode[], depth = 0): string[] =>
  nodes.flatMap(node => [
    `${'  '.repeat(depth)}${node.key} ${node.label}${node.kind === 'leaf' ? ` · ${node.note ?? ''}${node.added ? ' ✓' : ''}` : ''}`,
    ...(node.kind === 'branch' ? outline(node.children, depth + 1) : [])
  ]);

describe('三维模型在资源图层面板上', () => {
  it('键带种类前缀，能还原成模型；别的键不是模型', () => {
    expect(modelIdOfKey(modelKey('station'))).toBe('station');
    expect(modelIdOfKey('resource:bgdc_dltb')).toBeNull();
  });

  it('目录最后的"三维模型"按市分组、市按区划代码排，名称后面是类型，标出已加入的', () => {
    expect(outline(modelCatalogNodes(CATALOG, ['white']))).toStrictEqual([
      'model-root 三维模型',
      '  model-city:320100 南京市',
      '    model:city 新街口倾斜摄影 · 倾斜摄影',
      '  model-city:320500 苏州市',
      '    model:station 苏州站地下空间 · 室内',
      '    model:white 苏州白膜 · 白膜 ✓'
    ]);
  });

  it('搜索匹配模型名、市名，搜"三维"列出全部；没有匹配、没有模型时没有这个分类', () => {
    expect(outline(modelCatalogNodes(CATALOG, [], ' 南京 '))).toStrictEqual([
      'model-root 三维模型',
      '  model-city:320100 南京市',
      '    model:city 新街口倾斜摄影 · 倾斜摄影'
    ]);
    expect(outline(modelCatalogNodes(CATALOG, [], '白膜'))).toHaveLength(3);
    expect(outline(modelCatalogNodes(CATALOG, [], '三维'))).toHaveLength(6);
    expect(modelCatalogNodes(CATALOG, [], '地类')).toStrictEqual([]);
    expect(modelCatalogNodes([], [])).toStrictEqual([]);
  });

  it('三维里目录的"三维模型"页直接按市分组，可以只看一类；类型的选项只列清单里有的（用户 2026-11-15 方案乙）', () => {
    expect(outline(modelCityNodes(CATALOG, ['white']))).toStrictEqual([
      'model-city:320100 南京市',
      '  model:city 新街口倾斜摄影 · 倾斜摄影',
      'model-city:320500 苏州市',
      '  model:station 苏州站地下空间 · 室内',
      '  model:white 苏州白膜 · 白膜 ✓'
    ]);
    expect(outline(modelCityNodes(CATALOG, [], '苏州', 'white'))).toStrictEqual([
      'model-city:320500 苏州市',
      '  model:white 苏州白膜 · 白膜'
    ]);
    expect(modelCityNodes(CATALOG, [], '', 'splat')).toStrictEqual([]);
    expect(modelKindOptions(CATALOG)).toStrictEqual([
      { kind: 'oblique', label: '倾斜摄影' },
      { kind: 'white', label: '白膜' },
      { kind: 'indoor', label: '室内' }
    ]);
  });

  it('有出生点或路线才能漫游', () => {
    const [station, white] = CATALOG;
    expect(station && canRoamModel(station)).toBe(true);
    expect(white && canRoamModel(white)).toBe(false);
    expect(white && canRoamModel({ ...white, spawn: { lng: 120, lat: 31, height: 0, heading: 0 } })).toBe(true);
  });
});

describe('modelRequests', () => {
  it('加入、显示着的模型按当前图层的先后，带加载状态；隐藏的、目录里没有的不算（ADR 0158）', () => {
    const states: Record<string, 'loading' | 'ready' | 'failed'> = { white: 'ready', station: 'failed', city: 'loading' };
    const models = {
      models: computed(() => CATALOG),
      added: shallowRef(['city', 'white', 'gone', 'station']),
      hidden: shallowRef<ReadonlySet<string>>(new Set(['white'])),
      stateOf: (id: string) => states[id] ?? 'loading'
    };

    expect(modelRequests(models)).toStrictEqual([
      { kind: 'model', key: 'model:city', name: '新街口倾斜摄影', icon: 'model-3d', state: 'loading' },
      { kind: 'model', key: 'model:station', name: '苏州站地下空间', icon: 'model-3d', state: 'failed' }
    ]);
  });
});
