import type { ClassEntry } from './classification';
import { URBAN_VILLAGE_CODE_NAMES } from './landuse';
import { paletteColor } from './palette';

// 分类字典（ADR 0123）：取值、名称和颜色，同一取值在点层、面层同色，改颜色只改这里；哪个资源用哪个字典在 style-registry.ts。
// 取值来自 2026-11-02 的探查（docs/migration.md）。地图样式里的颜色是数据，不走 CSS 令牌

// 按顺序从配色板取色：一个字典不超过 10 项时颜色不重复
function fromPalette(...pairs: readonly (readonly [value: string, label: string])[]): readonly ClassEntry[] {
  return pairs.map(([value, label], index) => ({ value, label, color: paletteColor(index) }));
}

// 取值本身就是名称
function named(...values: readonly string[]): readonly ClassEntry[] {
  return fromPalette(...values.map(value => [value, value] as const));
}

/** 字典里的部分取值：只列资源实际有的，图例不出现没有数据的类别 */
export function pickEntries(entries: readonly ClassEntry[], ...values: readonly string[]): readonly ClassEntry[] {
  return values.map(value => {
    const entry = entries.find(item => item.value === value);
    if (!entry) {
      throw new Error(`字典里没有取值 ${value}`);
    }
    return entry;
  });
}

// 城市国土空间监测的类型代码（cc → ccn），按资源分组：组内颜色不重复，组之间可以重复

export const SCHOOL_TYPES = fromPalette(
  ['08H211', '高等院校'],
  ['08H212', '中等职业学校'],
  ['08H213', '中小学'],
  ['08H214', '幼托机构'],
  ['08H215', '特殊教育学校'],
  ['08H216', '专门学校（工读学校）']
);

export const MEDICAL_TYPES = fromPalette(['08H221', '医院'], ['08H221A', '方舱医院'], ['08H222', '社区卫生服务设施']);

export const WELFARE_TYPES = fromPalette(
  ['08H223', '养老设施'],
  ['08H226', '儿童社会福利设施'],
  ['08H227', '残疾人福利设施']
);

export const UTILITY_TYPES = fromPalette(
  ['080901', '消防站'],
  ['080902', '自来水厂'],
  ['080903', '污水处理厂'],
  ['080904', '垃圾集中处理设施'],
  ['080905', '邮政局（所）'],
  ['080906', '供热厂']
);

export const PARK_TYPES = fromPalette(['081001', '公园'], ['081002', '绿地'], ['0810A', '广场']);

export const TRANSPORT_STATION_TYPES = fromPalette(
  ['100501', '公共停车场（地上）'],
  ['100502', '公共停车楼（地上）'],
  ['100503', '对外交通场站'],
  ['100504', '公共交通场站'],
  ['100701', '机场']
);

export const TRANSPORT_LAND_TYPES = fromPalette(['100201', '轨道交通站点（地铁站）'], ['100301', '高速公路服务区']);

export const COMMERCE_TYPES = fromPalette(['05H101', '零售商业场所'], ['05H102', '旅馆'], ['05H103', '商务办公场所']);

export const HOUSING_TYPES = fromPalette(['070101', '商品住房（地上）'], ['070102', '保障性住房（地上）']);

// 水域类别（ccn）：蓝色系，水域线层只有河流、水渠
export const WATER_TYPES: readonly ClassEntry[] = [
  { value: '河流', label: '河流', color: '#1E88E5' },
  { value: '水渠', label: '水渠', color: '#4FC3F7' },
  { value: '湖泊', label: '湖泊', color: '#3949AB' },
  { value: '水库', label: '水库', color: '#00897B' },
  { value: '坑塘', label: '坑塘', color: '#80CBC4' },
  { value: '海面', label: '海面', color: '#0D47A1' }
];

// 各资源自己的枚举（type），按等级或业务顺序排

export const RURAL_ROAD_TYPES: readonly ClassEntry[] = [
  { value: '农村硬化道路', label: '农村硬化道路', color: '#E67E22' },
  { value: '机耕路', label: '机耕路', color: '#C49A6C' },
  { value: '乡村路', label: '乡村路', color: '#8D6E63' }
];

export const CITY_ROAD_TYPES = named('快速路', '主干路', '次干路', '支路', '地铁', '地面轨道');

export const HIGHWAY_TYPES = named('国道', '省道', '县道', '乡道', '村道', '专用公路', '其他公路', '连接道');

export const RAMP_TYPES = named('立体', '平面');

export const HIGHWAY_EXIT_TYPES = named('入口', '出口');

export const RAILWAY_TYPES = named('高速', '普通');

export const RAIL_STATION_TYPES = named('地铁站', '轻轨站', '有轨电车站');

export const URBAN_RENEWAL_TYPES = named(
  '老旧小区改造',
  '老旧厂区改造',
  '老旧街区改造',
  '城中村改造',
  '棚户区改造',
  '三旧改造'
);

export const SHELTER_TYPES = named('户外', '室内');

// 城镇村属性（czclx）：名称来自旧项目的对照，201A、202A 还没有名称（待业务确认，docs/migration.md），先显示编码
export const URBAN_VILLAGE_TYPES = fromPalette(
  ...['201', '201A', '202', '202A', '203', '203A', '204', '205'].map(code => {
    const name = URBAN_VILLAGE_CODE_NAMES[code];
    return [code, name ? `${code} ${name}` : code] as const;
  })
);

// 三区三线

export const DEVELOPMENT_ZONE_TYPES = fromPalette(
  ['410', '城镇集中建设区'],
  ['420', '城镇弹性发展区'],
  ['430', '特别用途区']
);

export const RED_LINE_TYPES = named('水源涵养', '生物多样性维护', '水土保持', '其他生态系统服务功能重要性');
