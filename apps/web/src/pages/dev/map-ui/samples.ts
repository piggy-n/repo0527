import { buildCatalog } from '@/features/resource-map/catalog';
import type { BasemapThumbnail } from '@/shared/map/basemap/basemap-style';
import imagery from './sample-imagery.svg?url';
import vector from './sample-vector.svg?url';

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
        { code: 'szy_kt', name: '坑塘水面', geoType: 'Polygon', yearList: [2024] }
      ]
    },
    {
      code: 'facilities',
      name: '公共设施',
      children: [
        { code: 'sample_point', name: '公共设施点层', geoType: 'Point', yearList: [2024, 2025] },
        { code: 'sample_long', name: '用于检查完整名称与换行的公共服务设施面层', geoType: 'Polygon', yearList: [2025] }
      ]
    }
  ]
}]);

/** 本地示意图替代天地图缩略图，预览页不发外部地图请求 */
export const SAMPLE_THUMBNAILS: Readonly<Record<'vector' | 'imagery' | 'none', BasemapThumbnail | null>> = {
  vector: { base: vector, labels: vector, focus: 'center' },
  imagery: { base: imagery, labels: imagery, focus: 'center' },
  none: null
};
