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

// 表 A.1（土地利用现状分类，GB/T 21010-2017）的一级类：没有"湿地"，湿地相关的地类归回林地、草地、工矿仓储、水域、其他土地
const STATUS_GROUPS: readonly { readonly code: string; readonly name: string }[] = [
  { code: '01', name: '耕地' },
  { code: '02', name: '园地' },
  { code: '03', name: '林地' },
  { code: '04', name: '草地' },
  { code: '05', name: '商业服务业用地' },
  { code: '06', name: '工矿仓储用地' },
  { code: '07', name: '住宅用地' },
  { code: '08', name: '公共管理与公共服务用地' },
  { code: '09', name: '特殊用地' },
  { code: '10', name: '交通运输用地' },
  { code: '11', name: '水域及水利设施用地' },
  { code: '12', name: '其他土地' }
];

// 在表 A.1 里归属和编码前两位不同的二级类（旧项目列了 9 个，其中 7 个和按前两位的结果相同）
const STATUS_GROUP_OVERRIDES = new Map([
  ['0508', '06'],
  ['1108', '12']
]);

/** 表 A.1 的分组（图例的"现状分类"）：复用表 A.2 的二级类和配色，只按现状分类的一级类重新分组 */
export const LANDUSE_STATUS_GROUPS: readonly LanduseGroup[] = STATUS_GROUPS.map(({ code, name }) => ({
  code,
  name,
  classes: LANDUSE_CLASSES.filter(item => (STATUS_GROUP_OVERRIDES.get(item.code) ?? item.code.slice(0, 2)) === code)
}));

/** 地类的含义（摘自《第三次全国国土调查土地分类》表 A.2），图例上的说明 */
export const LANDUSE_MEANINGS: Readonly<Record<string, string>> = {
  '0303': '沿海生长红树植物的林地。',
  '0304': '以乔木森林植物为主的淡水沼泽。',
  '0306': '以灌丛植物为主的淡水沼泽。',
  '0402': '以天然草本植物为主，常年或季节性积水、潮湿的内陆沼泽化低地草甸、高寒草甸。',
  '0603': '用于生产盐的土地，包括晒盐场所、盐池及附属设施用地。',
  '1105': '沿海大潮高潮位与低潮位之间的潮浸地带，包括海岛沿海滩涂，不包括红树林地。',
  '1106': '河流、湖泊常水位至洪水位间的滩地，以及水库、坑塘的正常蓄水位与洪水位间的滩地，不包括已利用的滩地。',
  '1108': '经常积水或渍水、一般生长沼生植物的土地，包括草本沼泽、苔藓沼泽、内陆盐沼等，不包括森林沼泽、灌丛沼泽和沼泽草地。',
  '0101': '用于种植水稻、莲藕等水生农作物的耕地，包括实行水生、旱生农作物轮种的耕地。',
  '0102': '有水源保证和灌溉设施、一般年景能正常灌溉、种植旱生农作物（含蔬菜）的耕地，也包括种植蔬菜的非工厂化大棚用地。',
  '0103': '无灌溉设施、主要靠天然降水种植旱生农作物的耕地，包括仅靠引洪淤灌的耕地。',
  '0201': '种植果树的园地。',
  '0201K': '由耕地改种果树、耕作层未破坏的可调整果园。',
  '0202': '种植茶树的园地。',
  '0202K': '由耕地改种茶树、耕作层未破坏的可调整茶园。',
  '0203': '种植橡胶树的园地。',
  '0203K': '由耕地改种橡胶树、耕作层未破坏的可调整橡胶园。',
  '0204': '种植桑树、可可、咖啡、油棕、胡椒、药材等其他多年生作物的园地。',
  '0204K': '由耕地改种其他多年生作物、耕作层未破坏的可调整其他园地。',
  '0301': '乔木郁闭度≥0.2 的林地，不包括森林沼泽。',
  '0301K': '由耕地改为乔木林、耕作层未破坏的可调整乔木林地。',
  '0302': '生长竹类植物、郁闭度≥0.2 的林地。',
  '0302K': '由耕地改为竹林、耕作层未破坏的可调整竹林地。',
  '0305': '灌木覆盖度≥40% 的林地，不包括灌丛沼泽。',
  '0307': '疏林地（郁闭度≥0.1、＜0.2）、未成林地、迹地、苗圃等林地。',
  '0307K': '由耕地改为其他林地、耕作层未破坏的可调整其他林地。',
  '0401': '以天然草本植物为主、用于放牧或割草的草地，包括实施禁牧措施的草地，不包括沼泽草地。',
  '0403': '人工种植牧草的草地。',
  '0403K': '由耕地改为人工牧草、耕作层未破坏的可调整人工牧草地。',
  '0404': '树木郁闭度＜0.1、表层为土质、以生长草本植物为主、不用于畜牧业的草地。',
  '05H1': '主要用于商业、服务业的土地，包括批发零售、住宿餐饮、商务金融、娱乐及其他商业服务业等用地。',
  '0508': '用于物资储备、中转、配送等的物流仓储设施用地。',
  '0601': '工业生产及直接为工业生产服务的附属设施用地。',
  '0602': '采矿、采石、采砂（沙）场，砖瓦窑等地面生产用地及尾矿堆放地。',
  '0701': '城镇用于生活居住的各类房屋用地及其附属设施用地。',
  '0702': '农村用于生活居住的宅基地。',
  '08H1': '用于党政机关、社会团体、群众自治组织及广播电视、报刊通讯、出版等的用地。',
  '08H2': '用于科研、教育、文化、体育、医疗卫生及其设施的用地。',
  '08H2A': '高等院校及科研院所用地。',
  '0809': '城乡基础设施用地，包括供水、排水、供电、供气、供热、邮政、电信、消防、环卫、公交场站等设施用地。',
  '0810': '城镇、村庄范围内的公园、动物园、植物园、街心花园、广场及用于休憩、美化环境和防护的绿化用地。',
  '0810A': '城镇、村庄范围内的广场用地。',
  '09': '用于军事设施、涉外、宗教、监教、殡葬、风景名胜等的土地。',
  '1001': '用于铁道线路及场站的用地，包括路堤、路堑、桥梁、车站、信号、机务站等用地。',
  '1002': '用于轻轨、现代有轨电车、单轨等轨道交通线路及场站的用地。',
  '1003': '用于国家、省、县、乡、村各级公路及其附属设施的用地。',
  '1004': '城镇、村庄范围内的公用道路及行道树用地，包括快速路、主次干路、支路、专用人行道和非机动车道及交叉口等。',
  '1005': '城镇、村庄范围内的交通服务设施用地，包括公交首末站、出租车场站、教练场等用地。',
  '1006': '公路用地以外、用于村间田间交通运输并以服务农业生产为主的农村道路（含机耕道）。',
  '1007': '用于民用机场、军民合用机场的用地。',
  '1008': '用于客运、货运、捕捞及工作船舶停靠的场所及其附属建筑用地，不包括常水位以下部分。',
  '1009': '用于运输煤炭、矿石、石油、天然气等的管道及其附属设施的地面用地。',
  '1101': '天然形成或人工开挖河流常水位岸线之间的水面，不包括水库水面。',
  '1102': '天然形成的积水区常水位岸线所围成的水面。',
  '1103': '人工拦截汇集、总库容≥10 万立方米的水库正常蓄水位岸线所围成的水面。',
  '1104': '人工开挖或天然形成、蓄水量＜10 万立方米的坑塘常水位岸线所围成的水面。',
  '1104A': '用于水产养殖的坑塘水面及相应附属设施用地。',
  '1104K': '由耕地改为养殖坑塘、耕作层未破坏的可调整养殖坑塘。',
  '1107': '人工修建、用于引排灌的渠道，包括渠槽、渠堤、护堤林及小型泵站。',
  '1107A': '人工修建的引、排、灌干渠及其附属建筑物用地。',
  '1109': '人工修建的闸、坝、堤路林、水电厂房、扬水站等常水位岸线以上的建筑物用地。',
  '1110': '表层被冰雪常年覆盖的土地。',
  '1201': '城镇、村庄、工矿范围内尚未使用的土地，包括尚未确定用途的土地。',
  '1202': '直接用于经营性畜禽养殖、作物栽培或水产养殖等生产及附属设施，以及为农业生产服务的晾晒、烘干、存放等设施用地。',
  '1203': '梯田及梯状坡耕地中主要用于拦蓄水和护坡的地坎（南方宽≥1.0 米、北方宽≥2.0 米）。',
  '1204': '表层盐碱聚集、生长天然耐盐植物的土地。',
  '1205': '表层为沙覆盖、基本无植被的土地，不包括滩涂中的沙地。',
  '1206': '表层为土质、基本无植被覆盖的土地。',
  '1207': '表层为岩石或石砾、覆盖面积≥70% 的土地。'
};

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
