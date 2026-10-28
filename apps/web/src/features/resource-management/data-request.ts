import { districtsOf, JIANGSU_CITIES } from '@/shared/map/region/region-catalog';

// 自助取数和下载申请的区划选项；图层、格式和时间格式在 shared/data-request，系统管理也用（ADR 0091）

// 用 type 而不是 interface：Element 的级联选项带索引签名，只有对象类型别名能直接赋给它
export type RegionOption = {
  label: string;
  value: string;
  children?: RegionOption[];
};

/** 全省、市、区县三级，用项目已校验的区划目录（ADR 0036），任一级都可以选 */
export const REGION_OPTIONS: RegionOption[] = [
  {
    label: '江苏省',
    value: '320000',
    children: JIANGSU_CITIES.map(city => ({
      label: city.name,
      value: city.code,
      children: districtsOf(city.code).map(district => ({ label: district.name, value: district.code }))
    }))
  }
];

/** 默认的区划：全省 */
export const PROVINCE_PATH = ['320000'];
