import { buildCatalog } from '@/features/resource-map/catalog';
import { sceneManifestSchema } from '@/features/scene-models/api';
import { buildModelCatalog } from '@/features/scene-models/catalog';
import { type BasemapId, type BasemapThumbnail, basemapThumbnails } from '@/shared/map/basemap/basemap-style';
import type { RequestItem } from '@/shared/map/request-status/request-status';
import imagery from './sample-imagery.svg?url';
import vector from './sample-vector.svg?url';

/** 两个三维模型（ADR 0161 的平铺列表）：只进面板，样例没有地图，不加载 */
export const SAMPLE_MODELS = buildModelCatalog(
  sceneManifestSchema.parse({
    models: [
      {
        id: 'sample-station',
        name: '星海广场站',
        cityCode: '320500',
        kind: 'indoor',
        underground: true,
        tileset: 'station/tileset.json',
        routes: [{ id: 'enter', name: '进站', path: [[120.666, 31.3175, -5.1], [120.667, 31.3175, -5.1]] }]
      },
      {
        id: 'sample-white',
        name: '星海广场站周边建筑白模',
        cityCode: '320500',
        kind: 'white',
        underground: false,
        effects: [{ id: 'plain', label: '无纹理', tileset: 'white/plain.json' }]
      }
    ]
  }),
  'http://localhost/3dt/manifest.json'
);

/** 固定目录：涵盖单年份、多年份、点线面及两种复杂图例，不读取后台 */
export const SAMPLE_CATALOG = buildCatalog([{
  code: null,
  name: '基础库',
  children: [
    {
      code: 'land',
      name: '土地资源',
      children: [
        { code: 'bgdc_dltb', name: '地类图斑（城镇村）', geoType: 'Polygon', yearList: [2021] },
        { code: 'bgdc_cjdcq', name: '村级调查区界线', geoType: 'Line', yearList: [2023, 2024, 2025] }
      ]
    },
    {
      code: 'water',
      name: '水资源',
      children: [
        { code: 'csxhjctb_hydl', name: '水域线层', geoType: 'Line', yearList: [2023, 2024, 2025] },
        { code: 'lcsh_sdtb', name: '湿地分布图斑', geoType: 'Polygon', yearList: [2024] }
      ]
    },
    {
      code: 'facilities',
      name: '公共设施',
      children: [
        { code: 'csxhjctb_xxp', name: '学校点层', geoType: 'Point', yearList: [2024, 2025] },
        { code: 'sample_long', name: '用于检查完整名称与换行的公共服务设施面层', geoType: 'Polygon', yearList: [2025] }
      ]
    }
  ]
}]);

/**
 * 本地示意图替代天地图缩略图，预览页不发外部地图请求；静态底图的缩略图本来就是本地的。
 * 服务器底图的瓦片是数据方的数据，不入库，三套矢量借用矢量的示意图（地名印在图上，没有注记）
 */
export const SAMPLE_THUMBNAILS: Readonly<Record<BasemapId, BasemapThumbnail | null>> = {
  vector: { base: vector, labels: vector, focus: 'center' },
  imagery: { base: imagery, labels: imagery, focus: 'center' },
  static: basemapThumbnails(null).static,
  standard: { base: vector, labels: null, focus: 'center' },
  black: { base: vector, labels: null, focus: 'center' },
  'night-blue': { base: vector, labels: null, focus: 'center' },
  none: null
};

// 数据加载明细的一项；时间按样例的时钟 10000
const request = (item: Pick<RequestItem, 'key' | 'kind' | 'name' | 'icon'> & Partial<RequestItem>): RequestItem => ({
  requested: 0,
  loaded: 0,
  failed: 0,
  previousFailed: 0,
  detail: null,
  startedAt: 9000,
  finishedAt: null,
  ...item
});

/** 数据加载明细的固定几项：三组都有，不随时间变化 */
export const SAMPLE_REQUESTS: readonly RequestItem[] = [
  request({
    key: 'resource:bgdc_dltb',
    kind: 'tiles',
    name: '地类图斑（城镇村）',
    icon: 'geometry-polygon',
    requested: 52,
    loaded: 34
  }),
  request({ key: 'model:sample-white', kind: 'model', name: '星海广场站周边建筑白模', icon: 'model-3d' }),
  request({
    key: 'resource:bgdc_cjdcq',
    kind: 'tiles',
    name: '村级调查区界线',
    icon: 'geometry-line',
    requested: 20,
    loaded: 18,
    failed: 2,
    finishedAt: 9500
  }),
  request({ key: 'basemap', kind: 'tiles', name: '底图', icon: 'nav-current-map', requested: 24, loaded: 24, finishedAt: 9600 })
];
