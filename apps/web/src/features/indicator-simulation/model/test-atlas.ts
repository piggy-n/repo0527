// 只供测试：用真实的县界建推演范围，经由正式的边界加载器，只是不下载、直接读入县界文件
import county from '@/shared/map/boundary/data/jiangsu-county.json';
import { districtsOf, JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { createRegionBoundaryLoader } from '@/shared/map/region/region-geometry';
import { createDistrictAtlas, type DistrictAtlas } from './districts';

let atlas: Promise<DistrictAtlas> | undefined;

/** 全省 95 个区县；同一个测试文件里共用一份 */
export function loadTestAtlas(): Promise<DistrictAtlas> {
  atlas ??= (async () => {
    const loader = createRegionBoundaryLoader(() => Promise.resolve(county));
    const regions = JIANGSU_CITIES.flatMap(city => districtsOf(city.code));
    const shapes = await Promise.all(regions.map(async region => ({ region, boundary: await loader.load(region) })));
    return createDistrictAtlas(shapes);
  })();
  return atlas;
}
