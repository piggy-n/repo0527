// @vitest-environment node
import { diffStyle, StyleModel } from '@mx/map-core';
import { describe, expect, it } from 'vitest';
import {
  basemapOption,
  basemapOptions,
  basemapThumbnails,
  type BasemapId,
  type BasemapState,
  type BasemapStyles,
  createBasemapStyles,
  initialBasemapState,
  initialLabelsVisible
} from './basemap-style';
import { staticBasemapGroup, staticLabelsGroup } from './static-basemap';

const KEY = '0123456789abcdef0123456789abcdef';
const TIANDITU = { key: KEY };
const SELECTIONS: readonly BasemapId[] = ['vector', 'imagery', 'static', 'none'];

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
  return { selected, opacity: { vector: 1, imagery: 1, static: 1, ...opacity } };
}

// 两个分组组合成完整的样式；StyleModel 提交时会校验 ID 重复和引用不存在的数据源
function compose(styles: BasemapStyles, basemap: BasemapState) {
  const model = new StyleModel({ groups: ['basemap', 'basemap-labels'] });
  model.setGroups({ basemap: styles.basemapGroup(basemap), 'basemap-labels': styles.labelsGroup(basemap, true) });
  return model.current;
}

describe('可选的底图与初始状态', () => {
  it('开启天地图：矢量、影像、无底图，进入时是矢量底图，透明度都是 1', () => {
    expect(basemapOptions(TIANDITU)).toStrictEqual([
      { id: 'vector', label: '矢量底图', shortLabel: '矢量' },
      { id: 'imagery', label: '影像底图', shortLabel: '影像' },
      { id: 'none', label: '无底图', shortLabel: '无底图' }
    ]);
    expect(initialBasemapState(TIANDITU)).toStrictEqual({
      selected: 'vector',
      opacity: { vector: 1, imagery: 1, static: 1 }
    });
  });

  it('关闭天地图：静态底图和无底图，进入时是静态底图（ADR 0133）', () => {
    expect(basemapOptions(null)).toStrictEqual([
      { id: 'static', label: '静态底图', shortLabel: '静态' },
      { id: 'none', label: '无底图', shortLabel: '无底图' }
    ]);
    expect(initialBasemapState(null)).toStrictEqual({
      selected: 'static',
      opacity: { vector: 1, imagery: 1, static: 1 }
    });
  });

  it('进入时天地图的注记显示，静态底图的地名不显示（ADR 0134）', () => {
    expect(initialLabelsVisible(TIANDITU)).toBe(true);
    expect(initialLabelsVisible(null)).toBe(false);
  });

  it('按 ID 取一种底图的名称和简称：底图卡写简称，无障碍名称写全称（ADR 0057）', () => {
    expect(basemapOption('vector')).toBe(basemapOptions(TIANDITU)[0]);
    expect(basemapOption('imagery')).toStrictEqual({ id: 'imagery', label: '影像底图', shortLabel: '影像' });
    expect(basemapOption('static')).toBe(basemapOptions(null)[0]);
    expect(basemapOption('none')).toBe(basemapOptions(null)[1]);
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
    expect(styles.labelsGroup(basemap, true)).toStrictEqual({
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
    expect(styles.labelsGroup(basemap, true)).toStrictEqual({
      sources: { 'basemap-labels-imagery': tiandituSource('cia') },
      layers: [rasterLayer('basemap-labels-imagery', 0.3)]
    });
  });

  it('无底图：只有背景，没有注记', () => {
    const basemap = state('none', { vector: 0.6, imagery: 0.3 });

    expect(styles.basemapGroup(basemap)).toStrictEqual({ sources: {}, layers: [BACKGROUND] });
    expect(styles.labelsGroup(basemap, true)).toStrictEqual({ sources: {}, layers: [] });
  });

  it.each(SELECTIONS)('%s：ID 以所在分组的名称为前缀，组合后通过样式模型的校验', selected => {
    const basemap = state(selected);
    const base = styles.basemapGroup(basemap);
    const labels = styles.labelsGroup(basemap, true);

    for (const id of [...Object.keys(base.sources), ...base.layers.map(layer => layer.id)]) {
      expect(id).toMatch(/^basemap-(?!labels-)/);
    }
    for (const id of [...Object.keys(labels.sources), ...labels.layers.map(layer => layer.id)]) {
      expect(id).toMatch(/^basemap-labels-/);
    }
    expect(() => compose(styles, basemap)).not.toThrow();
  });

  it.each(SELECTIONS)('%s：标注关闭时注记分组是空的，底图分组不变', selected => {
    const basemap = state(selected);

    expect(styles.labelsGroup(basemap, false)).toStrictEqual({ sources: {}, layers: [] });
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

  it.each(['vector', 'imagery', 'none'] as const)('选择 %s 时也只有背景', selected => {
    const basemap = state(selected);

    expect(styles.basemapGroup(basemap)).toStrictEqual({ sources: {}, layers: [BACKGROUND] });
    expect(styles.labelsGroup(basemap, true)).toStrictEqual({ sources: {}, layers: [] });
  });

  it.each(SELECTIONS)('选择 %s 时推导结果里没有天地图', selected => {
    expect(JSON.stringify(compose(styles, state(selected)))).not.toContain('tianditu');
  });

  it('静态底图：两个分组来自 static-basemap，用它自己的透明度', () => {
    const basemap = state('static', { vector: 0.3, imagery: 0.2, static: 0.5 });

    expect(styles.basemapGroup(basemap)).toStrictEqual(staticBasemapGroup(0.5));
    expect(styles.labelsGroup(basemap, true)).toStrictEqual(staticLabelsGroup(0.5));
  });

  it('静态底图的标注关闭时没有地名，也不引用地名数据', () => {
    expect(styles.labelsGroup(state('static'), false)).toStrictEqual({ sources: {}, layers: [] });
  });

  it('改静态底图的透明度只产生 setPaintProperty，不重新下载数据', () => {
    const commands = diffStyle(compose(styles, state('static')), compose(styles, state('static', { static: 0.5 })));

    expect(new Set(commands.map(({ command }) => command))).toStrictEqual(new Set(['setPaintProperty']));
  });

  it('静态底图和无底图之间切换：换掉面和线，底色跟着变', () => {
    const commands = diffStyle(compose(styles, state('static')), compose(styles, state('none')));
    const touched = commands.map(({ command, args }) => [command, args[0]]);

    expect(touched).toEqual(
      expect.arrayContaining([
        ['removeLayer', 'basemap-static-land'],
        ['removeLayer', 'basemap-static-line'],
        ['removeSource', 'basemap-static'],
        ['setPaintProperty', 'basemap-background']
      ])
    );
  });
});

// 南京所在的 10 级瓦片：底图和配套的注记各一张
const thumbnailTile = (layer: string) =>
  `https://t0.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
  `&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX=10&TILEROW=415&TILECOL=849&tk=${KEY}`;

describe('缩略图', () => {
  it('矢量、影像各用南京附近的一张 10 级瓦片，叠上配套的注记；无底图没有图片', () => {
    expect(basemapThumbnails(TIANDITU)).toMatchObject({
      vector: { base: thumbnailTile('vec'), labels: thumbnailTile('cva'), focus: '86% 67%' },
      imagery: { base: thumbnailTile('img'), labels: thumbnailTile('cia'), focus: '86% 67%' },
      none: null
    });
  });

  it('关闭天地图时矢量、影像没有图片，静态底图是打包的小图，不请求天地图', () => {
    const { vector, imagery, static: staticThumbnail, none } = basemapThumbnails(null);

    expect([vector, imagery, none]).toStrictEqual([null, null, null]);
    expect(staticThumbnail?.base).toMatch(/static-thumbnail/);
    expect(staticThumbnail?.labels).toBeNull();
  });
});
