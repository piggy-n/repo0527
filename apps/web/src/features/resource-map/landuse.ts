import { matchExpression } from './match-expression';

/** 表 A.2 的二级类 */
export interface LanduseClass {
  readonly code: string;
  readonly name: string;
  readonly color: string;
  /** 可调整地类（编码以 K 结尾） */
  readonly adjustable?: true;
}

/** 表 A.2 的一级类，图例（5C.4）按它分组 */
export interface LanduseGroup {
  readonly code: string;
  readonly name: string;
  readonly classes: readonly LanduseClass[];
}

// 编码表、历史名称表、兜底色、城镇村编码都迁移自 yzt 836f03b 的 landuseClassification.js 和 layer-style-registry.js，
// 测试与 test-fixtures/legacy-landuse.json（从旧仓库生成）逐条对照；地图样式里的颜色是数据，不走 CSS 令牌

/** 编码表：13 个一级类、69 个二级类 */
export const LANDUSE_GROUPS: readonly LanduseGroup[] = [
  {
    code: '00',
    name: '湿地',
    classes: [
      { code: '0303', name: '红树林地', color: 'rgb(49, 173, 105)' },
      { code: '0304', name: '森林沼泽', color: 'rgb(66, 165, 110)' },
      { code: '0306', name: '灌丛沼泽', color: 'rgb(100, 185, 104)' },
      { code: '0402', name: '沼泽草地', color: 'rgb(131, 194, 56)' },
      { code: '0603', name: '盐田', color: 'rgb(197, 230, 247)' },
      { code: '1105', name: '沿海滩涂', color: 'rgb(179, 222, 248)' },
      { code: '1106', name: '内陆滩涂', color: 'rgb(179, 222, 248)' },
      { code: '1108', name: '沼泽地', color: 'rgb(175, 200, 220)' }
    ]
  },
  {
    code: '01',
    name: '耕地',
    classes: [
      { code: '0101', name: '水田', color: 'rgb(248, 208, 114)' },
      { code: '0102', name: '水浇地', color: 'rgb(252, 234, 158)' },
      { code: '0103', name: '旱地', color: 'rgb(234, 243, 171)' }
    ]
  },
  {
    code: '02',
    name: '种植园用地',
    classes: [
      { code: '0201', name: '果园', color: 'rgb(214, 167, 201)' },
      { code: '0201K', name: '可调整果园', color: 'rgb(214, 167, 201)', adjustable: true },
      { code: '0202', name: '茶园', color: 'rgb(213, 167, 176)' },
      { code: '0202K', name: '可调整茶园', color: 'rgb(213, 167, 176)', adjustable: true },
      { code: '0203', name: '橡胶园', color: 'rgb(231, 204, 226)' },
      { code: '0203K', name: '可调整橡胶园', color: 'rgb(231, 204, 226)', adjustable: true },
      { code: '0204', name: '其他园地', color: 'rgb(233, 209, 229)' },
      { code: '0204K', name: '可调整其他园地', color: 'rgb(233, 209, 229)', adjustable: true }
    ]
  },
  {
    code: '03',
    name: '林地',
    classes: [
      { code: '0301', name: '乔木林地', color: 'rgb(49, 173, 105)' },
      { code: '0301K', name: '可调整乔木林地', color: 'rgb(49, 173, 105)', adjustable: true },
      { code: '0302', name: '竹林地', color: 'rgb(49, 173, 105)' },
      { code: '0302K', name: '可调整竹林地', color: 'rgb(49, 173, 105)', adjustable: true },
      { code: '0305', name: '灌木林地', color: 'rgb(100, 185, 104)' },
      { code: '0307', name: '其他林地', color: 'rgb(151, 207, 178)' },
      { code: '0307K', name: '可调整其他林地', color: 'rgb(151, 207, 178)', adjustable: true }
    ]
  },
  {
    code: '04',
    name: '草地',
    classes: [
      { code: '0401', name: '天然牧草地', color: 'rgb(131, 194, 56)' },
      { code: '0403', name: '人工牧草地', color: 'rgb(154, 206, 127)' },
      { code: '0403K', name: '可调整人工牧草地', color: 'rgb(154, 206, 127)', adjustable: true },
      { code: '0404', name: '其他草地', color: 'rgb(200, 227, 160)' }
    ]
  },
  {
    code: '05',
    name: '商业服务业用地',
    classes: [
      { code: '05H1', name: '商业服务业设施用地', color: 'rgb(226, 161, 149)' },
      { code: '0508', name: '物流仓储用地', color: 'rgb(197, 154, 140)' }
    ]
  },
  {
    code: '06',
    name: '工矿用地',
    classes: [
      { code: '0601', name: '工业用地', color: 'rgb(197, 154, 140)' },
      { code: '0602', name: '采矿用地', color: 'rgb(197, 154, 140)' }
    ]
  },
  {
    code: '07',
    name: '住宅用地',
    classes: [
      { code: '0701', name: '城镇住宅用地', color: 'rgb(227, 96, 94)' },
      { code: '0702', name: '农村宅基地', color: 'rgb(235, 133, 133)' }
    ]
  },
  {
    code: '08',
    name: '公共管理与公共服务用地',
    classes: [
      { code: '08H1', name: '机关团体新闻出版用地', color: 'rgb(241, 165, 18)' },
      { code: '08H2', name: '科教文卫用地', color: 'rgb(241, 165, 180)' },
      { code: '08H2A', name: '高教用地', color: 'rgb(241, 165, 180)' },
      { code: '0809', name: '公用设施用地', color: 'rgb(241, 165, 180)' },
      { code: '0810', name: '公园与绿地', color: 'rgb(129, 195, 93)' },
      { code: '0810A', name: '广场用地', color: 'rgb(129, 195, 93)' }
    ]
  },
  {
    code: '09',
    name: '特殊用地',
    classes: [
      { code: '09', name: '特殊用地', color: 'rgb(193, 114, 97)' }
    ]
  },
  {
    code: '10',
    name: '交通运输用地',
    classes: [
      { code: '1001', name: '铁路用地', color: 'rgb(178, 170, 176)' },
      { code: '1002', name: '轨道交通用地', color: 'rgb(178, 170, 176)' },
      { code: '1003', name: '公路用地', color: 'rgb(210, 216, 201)' },
      { code: '1004', name: '城镇村道路用地', color: 'rgb(222, 222, 221)' },
      { code: '1005', name: '交通服务场站用地', color: 'rgb(170, 169, 169)' },
      { code: '1006', name: '农村道路', color: 'rgb(170, 169, 169)' },
      { code: '1007', name: '机场用地', color: 'rgb(235, 137, 126)' },
      { code: '1008', name: '港口码头用地', color: 'rgb(235, 137, 126)' },
      { code: '1009', name: '管道运输用地', color: 'rgb(235, 137, 126)' }
    ]
  },
  {
    code: '11',
    name: '水域及水利设施用地',
    classes: [
      { code: '1101', name: '河流水面', color: 'rgb(163, 214, 245)' },
      { code: '1102', name: '湖泊水面', color: 'rgb(163, 214, 245)' },
      { code: '1103', name: '水库水面', color: 'rgb(163, 214, 245)' },
      { code: '1104', name: '坑塘水面', color: 'rgb(144, 170, 207)' },
      { code: '1104A', name: '养殖坑塘', color: 'rgb(144, 170, 207)' },
      { code: '1104K', name: '可调整养殖坑塘', color: 'rgb(144, 170, 207)', adjustable: true },
      { code: '1107', name: '沟渠', color: 'rgb(160, 205, 240)' },
      { code: '1107A', name: '干渠', color: 'rgb(160, 205, 240)' },
      { code: '1109', name: '水工建筑用地', color: 'rgb(230, 130, 100)' },
      { code: '1110', name: '冰川及永久积雪', color: 'rgb(215, 237, 251)' }
    ]
  },
  {
    code: '12',
    name: '其他土地',
    classes: [
      { code: '1201', name: '空闲地', color: 'rgb(225, 220, 225)' },
      { code: '1202', name: '设施农用地', color: 'rgb(220, 180, 130)' },
      { code: '1203', name: '田坎', color: 'rgb(220, 180, 130)' },
      { code: '1204', name: '盐碱地', color: 'rgb(200, 204, 210)' },
      { code: '1205', name: '沙地', color: 'rgb(200, 190, 170)' },
      { code: '1206', name: '裸土地', color: 'rgb(215, 200, 150)' },
      { code: '1207', name: '裸岩石砾地', color: 'rgb(222, 221, 214)' }
    ]
  }
];

/** 历史名称表：表 A.2 之外的历史地类名称，编码表没命中时按名称兜底 */
export const LANDUSE_LEGACY_NAME_COLORS: Readonly<Record<string, string>> = {
  后备耕地: 'rgb(76, 230, 0)',
  城市用地: 'rgb(222, 103, 102)',
  建制镇用地: 'rgb(224, 100, 94)',
  村庄用地: 'rgb(236, 137, 138)',
  采矿及盐田用地: 'rgb(197, 154, 140)',
  风景名胜及特殊用地: 'rgb(199, 128, 11)'
};

/** 编码和名称都没命中时的颜色 */
export const LANDUSE_FALLBACK_COLOR = 'rgba(128, 128, 128, 0.5)';

/** 城镇村编码对应的历史名称：城镇村瓦片只有编码，没有名称 */
export const URBAN_VILLAGE_CODE_NAMES: Readonly<Record<string, string>> = {
  '201': '城市用地',
  '202': '建制镇用地',
  '203': '村庄用地',
  '204': '采矿及盐田用地',
  '205': '风景名胜及特殊用地',
  '203A': '村庄用地'
};

const LANDUSE_CLASSES = LANDUSE_GROUPS.flatMap(group => group.classes);

/** 地类图斑的颜色：先按编码（`dlbm`）匹配编码表，没命中再按名称（`dlmc`）匹配历史名称表 */
export const LANDUSE_COLOR_BY_CODE = matchExpression(
  ['get', 'dlbm'],
  LANDUSE_CLASSES.map(({ code, color }) => [code, color]),
  matchExpression(['get', 'dlmc'], Object.entries(LANDUSE_LEGACY_NAME_COLORS), LANDUSE_FALLBACK_COLOR)
);

// 瓦片里没有名称时（城镇村瓦片只有编码，5C.1b 实测）把编码换成名称
const NAME_FROM_CODE = matchExpression(
  ['get', 'dlbm'],
  [...LANDUSE_CLASSES.map(({ code, name }) => [code, name] as const), ...Object.entries(URBAN_VILLAGE_CODE_NAMES)],
  ''
);

/** 地类图斑（城镇村）的颜色：按名称匹配编码表和历史名称表 */
export const LANDUSE_COLOR_BY_NAME = matchExpression(
  ['coalesce', ['get', 'dlmc'], NAME_FROM_CODE],
  [...LANDUSE_CLASSES.map(({ name, color }) => [name, color] as const), ...Object.entries(LANDUSE_LEGACY_NAME_COLORS)],
  LANDUSE_FALLBACK_COLOR
);
