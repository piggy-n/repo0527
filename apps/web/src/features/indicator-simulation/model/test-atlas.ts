// 只供测试：用真实的县界建推演范围，经由正式的边界加载器，只是不下载、直接读入县界文件
import county from '@/shared/map/boundary/data/jiangsu-county.json';
import { createRegionBoundaryLoader } from '@/shared/map/region/region-geometry';
import { type DistrictAtlas, loadDistrictAtlas } from './districts';

let atlas: Promise<DistrictAtlas> | undefined;

/** 全省 95 个区县；同一个测试文件里共用一份 */
export function loadTestAtlas(): Promise<DistrictAtlas> {
  atlas ??= loadDistrictAtlas(createRegionBoundaryLoader(() => Promise.resolve(county)));
  return atlas;
}
