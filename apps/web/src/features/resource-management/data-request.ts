import { districtsOf, JIANGSU_CITIES } from '@/shared/map/region/region-catalog';

// 自助取数和下载申请共用的选项：旧项目在 QushuNodeForm 和 ResourceApplyDialog 里各写了一份，内容相同

/** 可申请的主题图层；正式的可申请范围和代码目录还没有后端接口，沿用旧页面写死的六项 */
export const DATA_LAYERS = [
  { label: '学校点层', value: 'csxhjctb_xxp_2022' },
  { label: '学校面层', value: 'csxhjctb_xxa_2022' },
  { label: '医疗机构点层', value: 'csxhjctb_yljgp_2022' },
  { label: '医疗机构面层', value: 'csxhjctb_yljga_2022' },
  { label: '城镇村等用地', value: 'bgdc_czcdyd_2022' },
  { label: '地类图斑', value: 'bgdc_dltb_2022' }
] as const;

export const DATA_FORMATS = ['Excel', 'Word', 'Echarts', 'SHP', 'GDB'] as const;

export type DataFormat = (typeof DATA_FORMATS)[number];

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

const pad = (value: number) => String(value).padStart(2, '0');

/** 接口和日期选择器用的格式 YYYY-MM-DD HH:mm:ss，按本地时间 */
export function formatDateTime(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
