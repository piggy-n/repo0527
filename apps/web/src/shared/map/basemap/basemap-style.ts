import type {
  BackgroundLayerSpecification,
  RasterLayerSpecification,
  RasterSourceSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { StyleGroup } from '@yzt/map-core';
import type { TiandituConfig } from '../../config/app-config';

/** 底图的种类 */
export type BasemapId = 'vector' | 'imagery' | 'none';

/** 有瓦片的底图，各有自己的透明度 */
export type TiledBasemapId = Exclude<BasemapId, 'none'>;

/** 底图拥有者的状态：只有 ID 和数字，可以直接序列化 */
export interface BasemapState {
  readonly selected: BasemapId;
  /** 每种底图各记一个，0～1，同时作用于底图和注记 */
  readonly opacity: Readonly<Record<TiledBasemapId, number>>;
}

export interface BasemapOption {
  readonly id: BasemapId;
  readonly label: string;
  /** 缩略图下面的名称，只写类型（ADR 0053 第 4 节） */
  readonly shortLabel: string;
}

/** 缩略图：天地图的底图和注记各一张瓦片，focus 是要对准的位置（CSS 的 background-position） */
export interface BasemapThumbnail {
  readonly base: string;
  readonly labels: string;
  readonly focus: string;
}

/** 底图样式的推导：页面绑定到 basemap 和 basemap-labels 两个分组（ADR 0031） */
export interface BasemapStyles {
  /** 背景和所选底图 */
  basemapGroup(state: BasemapState): StyleGroup;
  /** 所选底图配套的注记 */
  labelsGroup(state: BasemapState): StyleGroup;
}

const OPTIONS: readonly BasemapOption[] = [
  { id: 'vector', label: '矢量底图', shortLabel: '矢量' },
  { id: 'imagery', label: '影像底图', shortLabel: '影像' },
  { id: 'none', label: '无底图', shortLabel: '无底图' }
];
const NONE_ONLY = OPTIONS.filter(option => option.id === 'none');

// 天地图 WMTS 的图层：底图和配套的注记
const TIANDITU_LAYERS = {
  vector: { base: 'vec', labels: 'cva' },
  imagery: { base: 'img', labels: 'cia' }
} as const satisfies Record<TiledBasemapId, { base: string; labels: string }>;

const SUBDOMAINS = ['0', '1', '2', '3', '4', '5', '6', '7'];

// 缩略图用南京所在的那张 10 级瓦片，不另做图片；南京在这张瓦片的 (86%, 67%)（ADR 0053 第 4 节）
const THUMBNAIL_TILE = { z: '10', x: '849', y: '415', focus: '86% 67%' };

// 地图样式里的颜色是数据，不走 CSS 令牌；接近天地图矢量的底色，无底图时显示，瓦片加载中和调低透明度时与它混合
const BACKGROUND_LAYER: BackgroundLayerSpecification = {
  id: 'basemap-background',
  type: 'background',
  paint: { 'background-color': '#F3F5F8' }
};
const BACKGROUND_ONLY: StyleGroup = { sources: {}, layers: [BACKGROUND_LAYER] };
const EMPTY: StyleGroup = { sources: {}, layers: [] };

/** 可选的底图；关闭天地图（内网部署）时只有"无底图" */
export function basemapOptions(tianditu: TiandituConfig | null): readonly BasemapOption[] {
  return tianditu ? OPTIONS : NONE_ONLY;
}

/** 各种底图的缩略图；无底图、关闭天地图时为 null，不请求天地图 */
export function basemapThumbnails(
  tianditu: TiandituConfig | null
): Readonly<Record<BasemapId, BasemapThumbnail | null>> {
  const thumbnail = (id: TiledBasemapId): BasemapThumbnail | null =>
    tianditu && {
      base: tileUrl(TIANDITU_LAYERS[id].base, tianditu.key, '0', THUMBNAIL_TILE),
      labels: tileUrl(TIANDITU_LAYERS[id].labels, tianditu.key, '0', THUMBNAIL_TILE),
      focus: THUMBNAIL_TILE.focus
    };
  return { vector: thumbnail('vector'), imagery: thumbnail('imagery'), none: null };
}

/** 进入页面时的状态：开启天地图时是矢量底图，否则是无底图；透明度都是 1 */
export function initialBasemapState(tianditu: TiandituConfig | null): BasemapState {
  return { selected: tianditu ? 'vector' : 'none', opacity: { vector: 1, imagery: 1 } };
}

// 一张瓦片的地址；z、x、y 也可以是 MapLibre 替换的占位符，所以不经过 URLSearchParams 转义
function tileUrl(layer: string, key: string, subdomain: string, { z, x, y }: Record<'z' | 'x' | 'y', string>): string {
  return (
    `https://t${subdomain}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
    `&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&tk=${key}`
  );
}

function tiandituSource(layer: string, key: string): RasterSourceSpecification {
  return {
    type: 'raster',
    tiles: SUBDOMAINS.map(subdomain => tileUrl(layer, key, subdomain, { z: '{z}', x: '{x}', y: '{y}' })),
    tileSize: 256,
    // 天地图只有 1～18 级有数据，0 级和 19 级以上返回占位图；超过 18 级时放大使用 18 级的瓦片
    minzoom: 1,
    maxzoom: 18
  };
}

function rasterLayer(id: string, opacity: number): RasterLayerSpecification {
  return { id, type: 'raster', source: id, paint: { 'raster-opacity': opacity } };
}

// 一种底图在两个分组里的数据源；数据源和图层用同一个 ID，以分组名为前缀
function tiledSources(id: TiledBasemapId, key: string) {
  const baseId = `basemap-${id}`;
  const labelsId = `basemap-labels-${id}`;
  return {
    baseId,
    labelsId,
    base: { [baseId]: tiandituSource(TIANDITU_LAYERS[id].base, key) },
    labels: { [labelsId]: tiandituSource(TIANDITU_LAYERS[id].labels, key) }
  };
}

/**
 * 创建底图样式的推导函数，数据源按配置在这里一次建好。
 * 关闭天地图时不建任何数据源，无论状态是什么，推导结果里都没有天地图（ADR 0031）
 */
export function createBasemapStyles(tianditu: TiandituConfig | null): BasemapStyles {
  const sources = tianditu
    ? { vector: tiledSources('vector', tianditu.key), imagery: tiledSources('imagery', tianditu.key) }
    : null;

  return {
    basemapGroup({ selected, opacity }) {
      if (selected === 'none' || !sources) {
        return BACKGROUND_ONLY;
      }
      const { baseId, base } = sources[selected];
      return { sources: base, layers: [BACKGROUND_LAYER, rasterLayer(baseId, opacity[selected])] };
    },
    labelsGroup({ selected, opacity }) {
      if (selected === 'none' || !sources) {
        return EMPTY;
      }
      const { labelsId, labels } = sources[selected];
      return { sources: labels, layers: [rasterLayer(labelsId, opacity[selected])] };
    }
  };
}
