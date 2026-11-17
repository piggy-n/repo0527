import type {
  BackgroundLayerSpecification,
  RasterLayerSpecification,
  RasterSourceSpecification
} from '@maplibre/maplibre-gl-style-spec';
import { compactTileTemplate, type StyleGroup } from '@mx/map-core';
import type { TiandituConfig } from '../../config/app-config';
import {
  SERVER_BASEMAP_OPTIONS,
  type ServerBasemapId,
  type ServerBasemapOption
} from '../../config/server-basemap-options';
import staticThumbnailUrl from './images/static-thumbnail.svg?url';
import { NO_SERVER_BASEMAPS, type ServerBasemaps } from './server-basemaps';
import { staticBasemapGroup, staticLabelsGroup } from './static-basemap';

/**
 * 底图的种类：矢量、影像来自天地图，静态只用本地数据（ADR 0133）；
 * 内网的影像和标准、黑色、极夜蓝来自服务器上的切片缓存，按探测结果出现（ADR 0165）
 */
export type BasemapId = 'vector' | 'imagery' | 'static' | 'none' | ServerBasemapId;

/** 有画面的底图，各有自己的透明度 */
export type DrawnBasemapId = Exclude<BasemapId, 'none'>;

/** 底图拥有者的状态：只有 ID 和数字，可以直接序列化 */
export interface BasemapState {
  readonly selected: BasemapId;
  /** 每种底图各记一个，0～1，同时作用于底图和注记 */
  readonly opacity: Readonly<Record<DrawnBasemapId, number>>;
}

/**
 * 标注开关对一种底图的作用：switchable 跟着开关（天地图的注记、静态底图的地名）；
 * baked 地名印在底图上，开关不起作用，面板里置灰（ADR 0165 第 7 节）；none 没有标注（无底图）
 */
export type BasemapLabels = 'switchable' | 'baked' | 'none';

export interface BasemapOption {
  readonly id: BasemapId;
  readonly label: string;
  /** 缩略图下面的名称，只写类型（ADR 0053 第 4 节） */
  readonly shortLabel: string;
  readonly labels: BasemapLabels;
}

/** 缩略图：底图和注记各一张图，focus 是要对准的位置（CSS 的 background-position）；静态底图的图里已经全有，没有注记 */
export interface BasemapThumbnail {
  readonly base: string;
  readonly labels: string | null;
  readonly focus: string;
}

/** 底图样式的推导：页面绑定到 basemap 和 basemap-labels 两个分组（ADR 0031） */
export interface BasemapStyles {
  /** 背景和所选底图 */
  basemapGroup(state: BasemapState): StyleGroup;
  /** 所选底图配套的标注；visible 为 false 时是空的 */
  labelsGroup(state: BasemapState, visible: boolean): StyleGroup;
}

// 服务器底图的开关作用取自选项表的地名来源，面板置灰和样式里的地名读同一处；影像在天地图和服务器上都跟着开关
function serverLabels(id: ServerBasemapId): BasemapLabels {
  const option = SERVER_BASEMAP_OPTIONS.find(candidate => candidate.id === id);
  return option?.labels === 'baked' ? 'baked' : 'switchable';
}

const OPTION_BY_ID: Readonly<Record<BasemapId, BasemapOption>> = {
  vector: { id: 'vector', label: '矢量底图', shortLabel: '矢量', labels: 'switchable' },
  imagery: { id: 'imagery', label: '影像底图', shortLabel: '影像', labels: serverLabels('imagery') },
  static: { id: 'static', label: '静态底图', shortLabel: '静态', labels: 'switchable' },
  standard: { id: 'standard', label: '标准底图', shortLabel: '标准', labels: serverLabels('standard') },
  black: { id: 'black', label: '黑色底图', shortLabel: '黑色', labels: serverLabels('black') },
  'night-blue': { id: 'night-blue', label: '极夜蓝底图', shortLabel: '极夜蓝', labels: serverLabels('night-blue') },
  none: { id: 'none', label: '无底图', shortLabel: '无底图', labels: 'none' }
};
const TIANDITU_OPTIONS: readonly BasemapOption[] = [OPTION_BY_ID.vector, OPTION_BY_ID.imagery, OPTION_BY_ID.none];

/**
 * 内网的面板顺序（ADR 0165 第 1、7 节）：三列，4 套服务器底图都有时第一行标准、影像、静态，第二行黑色、极夜蓝、无底图；
 * 服务器没有的不占位
 */
const INTRANET_ORDER: readonly BasemapId[] = ['standard', 'imagery', 'static', 'black', 'night-blue', 'none'];

/** 天地图的底图 */
type TiandituBasemapId = 'vector' | 'imagery';

// 天地图 WMTS 的图层：底图和配套的注记
const TIANDITU_LAYERS = {
  vector: { base: 'vec', labels: 'cva' },
  imagery: { base: 'img', labels: 'cia' }
} as const satisfies Record<TiandituBasemapId, { base: string; labels: string }>;

const SUBDOMAINS = ['0', '1', '2', '3', '4', '5', '6', '7'];

// 缩略图用南京所在的那张 10 级瓦片，不另做图片；南京在这张瓦片的 (86%, 67%)（ADR 0053 第 4 节）。
// 服务器底图的缩略图是探测时读的同一块（SERVER_BASEMAP_PROBE_TILE）
const THUMBNAIL_TILE = { z: '10', x: '849', y: '415', focus: '86% 67%' };

// 地图样式里的颜色是数据，不走 CSS 令牌；接近天地图矢量的底色，无底图时显示，瓦片加载中和调低透明度时与它混合
const BACKGROUND_LAYER: BackgroundLayerSpecification = {
  id: 'basemap-background',
  type: 'background',
  paint: { 'background-color': '#F3F5F8' }
};
const BACKGROUND_ONLY: StyleGroup = { sources: {}, layers: [BACKGROUND_LAYER] };
const EMPTY: StyleGroup = { sources: {}, layers: [] };

/** 一种底图的名称、简称和标注开关的作用：底图卡写简称，无障碍名称写全称（ADR 0057） */
export function basemapOption(id: BasemapId): BasemapOption {
  return OPTION_BY_ID[id];
}

/**
 * 可选的底图：开启天地图时是矢量、影像、无底图；关闭天地图（内网部署）时是这台服务器探测到的服务器底图、
 * 静态底图和无底图，按 INTRANET_ORDER 排；公网不看探测结果
 */
export function basemapOptions(
  tianditu: TiandituConfig | null,
  servers: ServerBasemaps = NO_SERVER_BASEMAPS
): readonly BasemapOption[] {
  if (tianditu) {
    return TIANDITU_OPTIONS;
  }
  const present = new Set<BasemapId>(servers.map(server => server.id));
  return INTRANET_ORDER.filter(id => id === 'static' || id === 'none' || present.has(id)).map(id => OPTION_BY_ID[id]);
}

/**
 * 二维的默认底图（ADR 0165 第 1 节）：公网是矢量；内网有标准时是标准，没有时是静态。
 * 进入页面、三维切回二维时都选它
 */
export function defaultBasemap(
  tianditu: TiandituConfig | null,
  servers: ServerBasemaps = NO_SERVER_BASEMAPS
): BasemapId {
  if (tianditu) {
    return 'vector';
  }
  return servers.some(server => server.id === 'standard') ? 'standard' : 'static';
}

/**
 * 各种底图的缩略图；静态底图是打包的小图，无底图没有图片，关闭天地图时不请求天地图；
 * 服务器底图用探测读到的那块瓦片，没有注记，服务器没有的为 null
 */
export function basemapThumbnails(
  tianditu: TiandituConfig | null,
  servers: ServerBasemaps = NO_SERVER_BASEMAPS
): Readonly<Record<BasemapId, BasemapThumbnail | null>> {
  const thumbnail = (id: TiandituBasemapId): BasemapThumbnail | null =>
    tianditu && {
      base: tileUrl(TIANDITU_LAYERS[id].base, tianditu.key, '0', THUMBNAIL_TILE),
      labels: tileUrl(TIANDITU_LAYERS[id].labels, tianditu.key, '0', THUMBNAIL_TILE),
      focus: THUMBNAIL_TILE.focus
    };
  const server = (id: ServerBasemapId): BasemapThumbnail | null => {
    const found = tianditu ? undefined : servers.find(candidate => candidate.id === id);
    return found ? { base: found.thumbnail, labels: null, focus: THUMBNAIL_TILE.focus } : null;
  };
  return {
    vector: thumbnail('vector'),
    imagery: thumbnail('imagery') ?? server('imagery'),
    static: { base: staticThumbnailUrl, labels: null, focus: '50% 50%' },
    standard: server('standard'),
    black: server('black'),
    'night-blue': server('night-blue'),
    none: null
  };
}

/** 进入页面时的状态：二维的默认底图（defaultBasemap），透明度都是 1 */
export function initialBasemapState(
  tianditu: TiandituConfig | null,
  servers: ServerBasemaps = NO_SERVER_BASEMAPS
): BasemapState {
  return {
    selected: defaultBasemap(tianditu, servers),
    opacity: { vector: 1, imagery: 1, static: 1, standard: 1, black: 1, 'night-blue': 1 }
  };
}

/** 进入页面时标注是否显示：天地图的注记显示，静态底图的地名不显示（ADR 0134） */
export function initialLabelsVisible(tianditu: TiandituConfig | null): boolean {
  return tianditu !== null;
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

// 服务器的切片缓存经自定义协议读（ADR 0165 第 3 节）；范围外不请求，最高级以上放大最高级的瓦片
function serverSource(option: ServerBasemapOption, root: string): RasterSourceSpecification {
  const [west, south, east, north] = option.bounds;
  return {
    type: 'raster',
    tiles: [compactTileTemplate(root)],
    tileSize: 256,
    minzoom: option.minzoom,
    maxzoom: option.maxzoom,
    bounds: [west, south, east, north]
  };
}

function rasterLayer(id: string, opacity: number): RasterLayerSpecification {
  return { id, type: 'raster', source: id, paint: { 'raster-opacity': opacity } };
}

/** 一种瓦片底图：底图的数据源，和配套的标注（天地图的注记、静态底图的地名，或者印在图上） */
interface TiledBasemap {
  readonly baseId: string;
  readonly base: Readonly<Record<string, RasterSourceSpecification>>;
  readonly labels:
    | { readonly id: string; readonly sources: Readonly<Record<string, RasterSourceSpecification>> }
    | 'static'
    | 'baked';
}

// 一种天地图底图在两个分组里的数据源；数据源和图层用同一个 ID，以分组名为前缀
function tiandituBasemap(id: TiandituBasemapId, key: string): TiledBasemap {
  const baseId = `basemap-${id}`;
  const labelsId = `basemap-labels-${id}`;
  return {
    baseId,
    base: { [baseId]: tiandituSource(TIANDITU_LAYERS[id].base, key) },
    labels: { id: labelsId, sources: { [labelsId]: tiandituSource(TIANDITU_LAYERS[id].labels, key) } }
  };
}

// 这台服务器有的服务器底图：影像叠静态底图的地名，三套矢量的地名印在图上
function serverBasemaps(servers: ServerBasemaps): Partial<Record<DrawnBasemapId, TiledBasemap>> {
  const tiled: Partial<Record<DrawnBasemapId, TiledBasemap>> = {};
  for (const option of SERVER_BASEMAP_OPTIONS) {
    const server = servers.find(candidate => candidate.id === option.id);
    if (server) {
      const baseId = `basemap-${option.id}`;
      tiled[option.id] = { baseId, base: { [baseId]: serverSource(option, server.root) }, labels: option.labels };
    }
  }
  return tiled;
}

/**
 * 创建底图样式的推导函数，数据源按配置在这里一次建好。
 * 关闭天地图时不建任何天地图的数据源，无论状态是什么，推导结果里都没有天地图（ADR 0031）；
 * 服务器底图只在关闭天地图时、按探测结果建（ADR 0165）
 */
export function createBasemapStyles(
  tianditu: TiandituConfig | null,
  servers: ServerBasemaps = NO_SERVER_BASEMAPS
): BasemapStyles {
  const tiled: Partial<Record<DrawnBasemapId, TiledBasemap>> = tianditu
    ? { vector: tiandituBasemap('vector', tianditu.key), imagery: tiandituBasemap('imagery', tianditu.key) }
    : serverBasemaps(servers);

  return {
    basemapGroup({ selected, opacity }) {
      if (selected === 'static') {
        return staticBasemapGroup(opacity.static);
      }
      if (selected === 'none') {
        return BACKGROUND_ONLY;
      }
      const basemap = tiled[selected];
      if (!basemap) {
        return BACKGROUND_ONLY;
      }
      return { sources: basemap.base, layers: [BACKGROUND_LAYER, rasterLayer(basemap.baseId, opacity[selected])] };
    },
    labelsGroup({ selected, opacity }, visible) {
      if (!visible) {
        return EMPTY;
      }
      if (selected === 'static') {
        return staticLabelsGroup(opacity.static);
      }
      if (selected === 'none') {
        return EMPTY;
      }
      const basemap = tiled[selected];
      if (!basemap || basemap.labels === 'baked') {
        return EMPTY;
      }
      // 地名用这种底图自己的透明度
      if (basemap.labels === 'static') {
        return staticLabelsGroup(opacity[selected]);
      }
      return { sources: basemap.labels.sources, layers: [rasterLayer(basemap.labels.id, opacity[selected])] };
    }
  };
}
