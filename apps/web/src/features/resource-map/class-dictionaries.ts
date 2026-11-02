import { type ClassEntry, legacyItem } from './classification';
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
// 林草湿荒（ADR 0124）：只列探查到的取值，名称来自后端提供的代码表（全表在 docs/migration.md）

// 林种（lin_zhong）：色相按大类，防护林绿、特种用途林青蓝、用材林橙、经济林紫；约四分之一的图斑没有林种，归入"其他"
export const FOREST_TYPES: readonly ClassEntry[] = [
  { value: '111', label: '水源涵养林', color: '#1B5E20' },
  { value: '112', label: '水土保持林', color: '#2E7D32' },
  { value: '113', label: '防风固沙林', color: '#558B2F' },
  { value: '114', label: '农田牧场防护林', color: '#7CB342' },
  { value: '115', label: '护岸林', color: '#43A047' },
  { value: '116', label: '护路林', color: '#81C784' },
  { value: '117', label: '其他防护林', color: '#AED581' },
  { value: '122', label: '实验林', color: '#00695C' },
  { value: '123', label: '母树林', color: '#00897B' },
  { value: '124', label: '环境保护林', color: '#26A69A' },
  { value: '125', label: '风景林', color: '#00ACC1' },
  { value: '126', label: '名胜古迹和革命纪念林', color: '#0277BD' },
  { value: '127', label: '自然保护林', color: '#4FC3F7' },
  { value: '231', label: '短轮伐期用材林', color: '#EF6C00' },
  { value: '232', label: '速生丰产用材林', color: '#FFA726' },
  { value: '233', label: '一般用材林', color: '#FFD54F' },
  { value: '251', label: '果树林', color: '#8E24AA' },
  { value: '255', label: '其他经济林', color: '#CE93D8' }
];

// 土壤类型（tu_rang_lx）：色相按土纲；120、122 不在代码表里（待业务确认，docs/migration.md），先显示编码
export const SOIL_TYPES: readonly ClassEntry[] = [
  { value: '104', label: '黄壤', color: '#FDD835' },
  { value: '111', label: '黄棕壤', color: '#C49A6C' },
  { value: '112', label: '黄褐土', color: '#8D6E63' },
  { value: '113', label: '棕壤', color: '#6D4C41' },
  { value: '120', label: '120', color: '#FFB74D' },
  { value: '122', label: '122', color: '#FB8C00' },
  { value: '123', label: '灰褐土', color: '#E65100' },
  { value: '152', label: '灰棕漠土', color: '#9E9D24' },
  { value: '163', label: '新积土', color: '#66BB6A' },
  { value: '171', label: '石质土', color: '#546E7A' },
  { value: '182', label: '潮土', color: '#4FC3F7' },
  { value: '184', label: '林灌草甸土', color: '#0288D1' },
  { value: '211', label: '水稻土', color: '#7E57C2' }
];

// 草地分布图斑实际有的地类（dlbm）：编码 1208 不在表 A.2，按名称匹配历史地类"后备耕地"
export const GRASSLAND_LANDUSE: readonly string[] = [
  '0101', '0102', '0103', '0201', '0201K', '0202', '0204', '0204K', '0301', '0301K', '0302', '0305', '0307', '0307K',
  '0402', '0404', '0508', '05H1', '0601', '0602', '0603', '0701', '0702', '0809', '0810', '0810A', '08H1', '08H2',
  '08H2A', '09', '1001', '1002', '1003', '1004', '1005', '1006', '1007', '1008', '1009', '1101', '1102', '1103',
  '1104', '1104A', '1104K', '1105', '1106', '1107', '1109', '1201', '1202', '1204', '1207',
  legacyItem('后备耕地')
];

// 湿地分布图斑实际有的地类（dlbm）
export const WETLAND_LANDUSE: readonly string[] = [
  '0101', '0102', '0103', '0204', '0301', '0302', '0304', '0306', '0307', '0402', '0404', '0601', '0603', '0702',
  '0809', '0810', '09', '1003', '1006', '1008', '1101', '1102', '1103', '1104', '1104A', '1105', '1106', '1107',
  '1108', '1109', '1202', '1207'
];
