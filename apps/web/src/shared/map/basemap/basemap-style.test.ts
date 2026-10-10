// @vitest-environment node
import { diffStyle, StyleModel } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import {
  basemapOptions,
  type BasemapId,
  type BasemapState,
  type BasemapStyles,
  createBasemapStyles,
  initialBasemapState
} from './basemap-style';

const KEY = '0123456789abcdef0123456789abcdef';
const TIANDITU = { key: KEY };
const SELECTIONS: readonly BasemapId[] = ['vector', 'imagery', 'none'];

const BACKGROUND = { id: 'basemap-background', type: 'background', paint: { 'background-color': '#F3F5F8' } };

// 天地图 WMTS 的瓦片地址是外部约定，这里按文档写出完整的地址
function tiandituSource(layer: string) {
  return {
    type: 'raster',
    tiles: ['0', '1', '2', '3', '4', '5', '6', '7'].map(
      subdomain =>
        `https://t${subdomain}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
        `&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${KEY}`
    ),
    tileSize: 256,
    minzoom: 1,
    maxzoom: 18
  };
}

function rasterLayer(id: string, opacity: number) {
  return { id, type: 'raster', source: id, paint: { 'raster-opacity': opacity } };
}

function state(selected: BasemapId, opacity: Partial<BasemapState['opacity']> = {}): BasemapState {
  return { selected, opacity: { vector: 1, imagery: 1, ...opacity } };
}

// 两个分组组合成完整的样式；StyleModel 提交时会校验 ID 重复和引用不存在的数据源
function compose(styles: BasemapStyles, basemap: BasemapState) {
  const model = new StyleModel({ groups: ['basemap', 'basemap-labels'] });
  model.setGroups({ basemap: styles.basemapGroup(basemap), 'basemap-labels': styles.labelsGroup(basemap) });
  return model.current;
}

describe('可选的底图与初始状态', () => {
  it('开启天地图：矢量、影像、无底图，进入时是矢量底图，透明度都是 1', () => {
    expect(basemapOptions(TIANDITU)).toStrictEqual([
      { id: 'vector', label: '矢量底图' },
      { id: 'imagery', label: '影像底图' },
      { id: 'none', label: '无底图' }
    ]);
    expect(initialBasemapState(TIANDITU)).toStrictEqual({ selected: 'vector', opacity: { vector: 1, imagery: 1 } });
  });

  it('关闭天地图：只有无底图，进入时就是它', () => {
    expect(basemapOptions(null)).toStrictEqual([{ id: 'none', label: '无底图' }]);
    expect(initialBasemapState(null)).toStrictEqual({ selected: 'none', opacity: { vector: 1, imagery: 1 } });
  });
});

describe('createBasemapStyles：开启天地图', () => {
  const styles = createBasemapStyles(TIANDITU);

  it('矢量底图：背景加天地图 vec，注记是 cva，透明度同时作用于两者', () => {
    const basemap = state('vector', { vector: 0.6, imagery: 0.3 });

    expect(styles.basemapGroup(basemap)).toStrictEqual({
      sources: { 'basemap-vector': tiandituSource('vec') },
      layers: [BACKGROUND, rasterLayer('basemap-vector', 0.6)]
    });
    expect(styles.labelsGroup(basemap)).toStrictEqual({
      sources: { 'basemap-labels-vector': tiandituSource('cva') },
      layers: [rasterLayer('basemap-labels-vector', 0.6)]
    });
  });

  it('影像底图：背景加天地图 img，注记是 cia，用影像自己的透明度', () => {
    const basemap = state('imagery', { vector: 0.6, imagery: 0.3 });

    expect(styles.basemapGroup(basemap)).toStrictEqual({
      sources: { 'basemap-imagery': tiandituSource('img') },
      layers: [BACKGROUND, rasterLayer('basemap-imagery', 0.3)]
    });
    expect(styles.labelsGroup(basemap)).toStrictEqual({
      sources: { 'basemap-labels-imagery': tiandituSource('cia') },
      layers: [rasterLayer('basemap-labels-imagery', 0.3)]
    });
  });

  it('无底图：只有背景，没有注记', () => {
    const basemap = state('none', { vector: 0.6, imagery: 0.3 });

    expect(styles.basemapGroup(basemap)).toStrictEqual({ sources: {}, layers: [BACKGROUND] });
    expect(styles.labelsGroup(basemap)).toStrictEqual({ sources: {}, layers: [] });
  });

  it.each(SELECTIONS)('%s：ID 以所在分组的名称为前缀，组合后通过样式模型的校验', selected => {
    const basemap = state(selected);
    const base = styles.basemapGroup(basemap);
    const labels = styles.labelsGroup(basemap);

    for (const id of [...Object.keys(base.sources), ...base.layers.map(layer => layer.id)]) {
      expect(id).toMatch(/^basemap-(?!labels-)/);
    }
    for (const id of [...Object.keys(labels.sources), ...labels.layers.map(layer => layer.id)]) {
      expect(id).toMatch(/^basemap-labels-/);
    }
    expect(() => compose(styles, basemap)).not.toThrow();
  });

  // 数据源的内容不变就不会重建：style-spec 的 diff 对数据源做深比较，与是不是同一个对象无关
  it('改透明度只产生 setPaintProperty，不重新加载瓦片', () => {
    const commands = diffStyle(compose(styles, state('vector')), compose(styles, state('vector', { vector: 0.5 })));

    expect(commands.map(({ command, args }) => [command, args[0], args[1], args[2]])).toStrictEqual([
      ['setPaintProperty', 'basemap-vector', 'raster-opacity', 0.5],
      ['setPaintProperty', 'basemap-labels-vector', 'raster-opacity', 0.5]
    ]);
  });

  it('切换底图时换掉底图和注记，背景不动', () => {
    const commands = diffStyle(compose(styles, state('vector')), compose(styles, state('imagery')));
    const touched = commands.map(({ command, args }) => [command, args[0]]);

    expect(touched).toEqual(
      expect.arrayContaining([
        ['removeLayer', 'basemap-vector'],
        ['removeLayer', 'basemap-labels-vector'],
        ['removeSource', 'basemap-vector'],
        ['removeSource', 'basemap-labels-vector'],
        ['addSource', 'basemap-imagery'],
        ['addSource', 'basemap-labels-imagery']
      ])
    );
    expect(JSON.stringify(commands)).not.toContain('basemap-background');
  });
});

describe('createBasemapStyles：关闭天地图（内网部署）', () => {
  const styles = createBasemapStyles(null);

  it.each(SELECTIONS)('选择 %s 时也只有背景，推导结果里没有天地图', selected => {
    const basemap = state(selected);

    expect(styles.basemapGroup(basemap)).toStrictEqual({ sources: {}, layers: [BACKGROUND] });
    expect(styles.labelsGroup(basemap)).toStrictEqual({ sources: {}, layers: [] });
    expect(JSON.stringify(compose(styles, basemap))).not.toContain('tianditu');
  });
});
