import { buildCatalog } from '@/features/resource-map/catalog';
import { sceneManifestSchema } from '@/features/scene-models/api';
import { buildModelCatalog } from '@/features/scene-models/catalog';
import { type BasemapId, type BasemapThumbnail, basemapThumbnails } from '@/shared/map/basemap/basemap-style';
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

/** 本地示意图替代天地图缩略图，预览页不发外部地图请求；静态底图的缩略图本来就是本地的 */
export const SAMPLE_THUMBNAILS: Readonly<Record<BasemapId, BasemapThumbnail | null>> = {
  vector: { base: vector, labels: vector, focus: 'center' },
  imagery: { base: imagery, labels: imagery, focus: 'center' },
  static: basemapThumbnails(null).static,
  none: null
};
