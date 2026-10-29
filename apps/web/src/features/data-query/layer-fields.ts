// 各图层的查询条件字段，来自旧项目 space-monitoring-query/config.js；字段名按接口实际认的修正（见 docs/migration.md）

/** 下拉选项：code 拼进条件，name 显示 */
export interface FieldOption {
  readonly code: string;
  readonly name: string;
}

/** 文字的运算符：显示为"包含 / 不包含"，按 LIKE '%值%'、NOT LIKE '%值%' 拼（ADR 0104） */
export type TextOperator = 'LIKE' | 'NOT';
export type NumberOperator = '>' | '<' | '=' | '>=' | '<=';
export type InputOperator = TextOperator | NumberOperator;

export const TEXT_OPERATORS: readonly TextOperator[] = ['LIKE', 'NOT'];
export const NUMBER_OPERATORS: readonly NumberOperator[] = ['>', '<', '=', '>=', '<='];

interface FieldBase {
  readonly label: string;
  /** 字段名，拼进条件 */
  readonly field: string;
}

/** 一个可以加进属性查询的条件字段；shown 的字段选图层时默认加上，initial 是加上时的初始值 */
export type ConditionField =
  | (FieldBase & {
      readonly type: 'single';
      readonly options: readonly FieldOption[];
      readonly initial?: string;
      readonly shown?: true;
    })
  | (FieldBase & {
      readonly type: 'multiple';
      readonly options: readonly FieldOption[];
      readonly initial?: readonly string[];
      readonly shown?: true;
    })
  | (FieldBase & { readonly type: 'input'; readonly operators: readonly InputOperator[] })
  | (FieldBase & { readonly type: 'datetime' });

// 编码和显示相同的选项
function named(...values: string[]): FieldOption[] {
  return values.map(value => ({ code: value, name: value }));
}

/** 第三次国土调查的地类编码 */
export const LAND_CLASS_OPTIONS: readonly FieldOption[] = [
  { code: '01', name: '耕地' },
  { code: '0101', name: '水田' },
  { code: '0102', name: '水浇地' },
  { code: '0103', name: '旱地' },
  { code: '02', name: '园地' },
  { code: '0201', name: '果园' },
  { code: '0202', name: '茶园' },
  { code: '0202K', name: '可调整茶园' },
  { code: '0203', name: '橡胶园' },
  { code: '0203K', name: '可调整橡胶园' },
  { code: '0204', name: '其他园地' },
  { code: '0204K', name: '可调整其他园地' },
  { code: '03', name: '林地' },
  { code: '0301', name: '乔木林地' },
  { code: '0301K', name: '可调整乔木林地' },
  { code: '0302', name: '竹林地' },
  { code: '0302K', name: '可调整竹林地' },
  { code: '0303', name: '红树林地' },
  { code: '0304', name: '森林沼泽' },
  { code: '0305', name: '灌木林地' },
  { code: '0306', name: '灌丛沼泽' },
  { code: '0307', name: '其他林地' },
  { code: '0307K', name: '可调整其他林地' },
  { code: '04', name: '草地' },
  { code: '0401', name: '天然牧草地' },
  { code: '0402', name: '沼泽草地' },
  { code: '0403', name: '人工牧草地' },
  { code: '0403K', name: '可调整人工牧草地' },
  { code: '0404', name: '其他草地' },
  { code: '05', name: '商服用地' },
  { code: '05H1', name: '商业服务设施' },
  { code: '0508', name: '物流仓储用地' },
  { code: '06', name: '工矿用地' },
  { code: '0601', name: '工业用地' },
  { code: '0602', name: '采矿用地' },
  { code: '0603', name: '盐田' },
  { code: '07', name: '住宅用地' },
  { code: '0701', name: '城镇住宅' },
  { code: '0702', name: '农村宅基地' },
  { code: '08', name: '公共管理与公共服务' },
  { code: '08H1', name: '机关团体新闻出版' },
  { code: '08H2', name: '科教文卫用地' },
  { code: '08H2A', name: '高教用地' },
  { code: '0809', name: '公用设施用地' },
  { code: '0810', name: '公园与绿地' },
  { code: '0810A', name: '广场用地' },
  { code: '09', name: '特殊用地' },
  { code: '10', name: '交通运输用地' },
  { code: '1001', name: '铁路用地' },
  { code: '1002', name: '轨道交通用地' },
  { code: '1003', name: '公路用地' },
  { code: '1004', name: '城镇村道路用地' },
  { code: '1005', name: '交通服务场站用地' },
  { code: '1006', name: '农村道路' },
  { code: '1007', name: '机场用地' },
  { code: '1008', name: '港口码头用地' },
  { code: '1009', name: '管道运输用地' },
  { code: '11', name: '水域' },
  { code: '1101', name: '河流水面' },
  { code: '1102', name: '湖泊水面' },
  { code: '1103', name: '水库水面' },
  { code: '1104', name: '坑塘水面' },
  { code: '1104A', name: '养殖坑塘' },
  { code: '1104K', name: '可调整养殖坑塘' },
  { code: '1105', name: '沿海滩涂' },
  { code: '1106', name: '内陆滩涂' },
  { code: '1107', name: '沟渠' },
  { code: '1107A', name: '干渠' },
  { code: '1109', name: '水工建筑用地' },
  { code: '1110', name: '冰川及永久积雪' },
  { code: '12', name: '其他土地' },
  { code: '1201', name: '空闲地' },
  { code: '1202', name: '设施农用地' },
  { code: '1203', name: '田坎' },
  { code: '1204', name: '盐碱地' },
  { code: '1205', name: '沙地' },
  { code: '1206', name: '裸土地' },
  { code: '1207', name: '裸岩石砾地' },
  { code: '1208', name: '后备耕地' }
];

// 地类名称的选项由编码表推出（旧配置手写的有两处错位：选"采矿用地"拼出的是 DLMC = '工业用地'）
const LAND_CLASS_NAME_OPTIONS = named(...LAND_CLASS_OPTIONS.map(option => option.name));

// 城市国土空间监测四个图层共有的前两个字段
const LAND_CLASS_FIELDS: readonly ConditionField[] = [
  { label: '变化(或细化)前地类编码', field: 'DLBM', type: 'single', options: LAND_CLASS_OPTIONS },
  { label: '变化(或细化)前地类名称', field: 'DLMC', type: 'single', options: LAND_CLASS_NAME_OPTIONS }
];

const CONSISTENCY_FIELD: ConditionField = {
  label: '监测时实地与上年度国土变更调查成果地类二级类是否一致',
  field: 'IFCON',
  type: 'single',
  options: [
    { code: '是', name: '监测时实地与上年度国土变更调查成果地类二级类一致' },
    { code: '否', name: '监测时实地与上年度国土变更调查成果地类二级类不一致' },
    {
      code: '-9999',
      name:
        '监测时实地与上年度国土变更调查成果地类二级类不一致，但是视为特例，无需举证的；' +
        '监测时实地与上年度国土变更调查成果地类二级类不一致，但是在之前年份的监测中已举证过，且监测时没有新变化，无需举证'
    }
  ]
};

/** 学校点层、面层 */
export const SCHOOL_FIELDS: readonly ConditionField[] = [
  ...LAND_CLASS_FIELDS,
  {
    label: '变化(或细化)后类型代码',
    field: 'CC',
    type: 'single',
    options: [
      { code: '08H211', name: '高等院校' },
      { code: '08H212', name: '中等职业学校' },
      { code: '08H213', name: '中小学' },
      { code: '08H214', name: '幼托机构' },
      { code: '08H215', name: '特殊教育学校' },
      { code: '08H216', name: '专门学校（工读学校）' }
    ]
  },
  {
    label: '变化(或细化)后类型名称',
    field: 'CCN',
    type: 'single',
    options: named('高等院校', '中等职业学校', '中小学', '幼托机构', '特殊教育学校', '专门学校（工读学校）')
  },
  { label: '学校名称', field: 'NAME', type: 'input', operators: TEXT_OPERATORS },
  {
    label: '类型',
    field: 'TYPE',
    type: 'multiple',
    options: named(
      '普通高等学校本科院校',
      '普通高等学校高职（专科）院校',
      '成人高等学校',
      '军事院校',
      '其他',
      '小学',
      '初级中学',
      '高级中学',
      '9年一贯制学校',
      '12年一贯制学校',
      '完全中学',
      '幼儿园',
      '幼儿园（含幼托）',
      '托儿所',
      '盲人学校',
      '聋人学校',
      '培智学校',
      '其他特殊教育学校'
    ),
    initial: ['普通高等学校本科院校', '小学', '高级中学', '托儿所'],
    shown: true
  },
  { label: '班级数', field: 'QUOTA', type: 'input', operators: NUMBER_OPERATORS },
  { label: '是否为职业教育院校', field: 'IFTC', type: 'single', options: named('是', '否') },
  { label: '要素唯一标识码', field: 'FEATID', type: 'input', operators: TEXT_OPERATORS },
  CONSISTENCY_FIELD,
  { label: '更新时间', field: 'GXSJ', type: 'datetime' }
];

/** 医疗机构点层、面层；两个"是否"字段旧配置都写成了 IFTC，接口实际是 IFCH、IFIDH */
export const HOSPITAL_FIELDS: readonly ConditionField[] = [
  ...LAND_CLASS_FIELDS,
  {
    label: '变化(或细化)后类型代码',
    field: 'CC',
    type: 'single',
    options: [
      { code: '08H22', name: '医疗设施' },
      { code: '08H221', name: '医院' },
      { code: '08H221A', name: '方舱医院' },
      { code: '08H222', name: '社区卫生服务设施' }
    ]
  },
  { label: '变化(或细化)后类型名称', field: 'CCN', type: 'single', options: named('医院', '方舱医院', '社区卫生服务设施') },
  { label: '医疗机构名称', field: 'NAME', type: 'input', operators: TEXT_OPERATORS },
  {
    label: '类型',
    field: 'TYPE',
    type: 'multiple',
    options: named(
      '综合医院',
      '专科医院',
      '中医医院',
      '中西医结合医院',
      '民族医医院',
      '护理院',
      '康复医院',
      '妇幼保健机构',
      '急救中心（站）',
      '疾病预防控制中心',
      '社区卫生服务中心',
      '社区卫生服务站'
    ),
    initial: ['综合医院', '专科医院', '中医医院', '中西医结合医院'],
    shown: true
  },
  {
    label: '医院等级',
    field: 'GRADE',
    type: 'single',
    options: named(
      '一级',
      '一级甲等',
      '一级乙等',
      '一级丙等',
      '二级',
      '二级甲等',
      '二级乙等',
      '二级丙等',
      '三级',
      '三级甲等',
      '三级乙等',
      '三级丙等',
      '等外',
      '未定级',
      '-9999'
    ),
    initial: '一级',
    shown: true
  },
  { label: '规模', field: 'QUOTA', type: 'input', operators: NUMBER_OPERATORS },
  { label: '是否为县(区)级及以上医院', field: 'IFCH', type: 'single', options: named('是', '否', '-9999') },
  {
    label: '是否为传染病医院(含设置独立传染病院区(病区)的综合性医疗机构)',
    field: 'IFIDH',
    type: 'single',
    options: named('是', '否', '-9999')
  },
  { label: '要素唯一标识码', field: 'FEATID', type: 'input', operators: TEXT_OPERATORS },
  CONSISTENCY_FIELD,
  { label: '更新时间', field: 'GXSJ', type: 'datetime' }
];

/** 城镇村等用地；"备注"旧配置写成了 FEATID，接口实际是 BZ */
export const TOWN_FIELDS: readonly ConditionField[] = [
  {
    label: '城镇村等用地类型',
    field: 'CZCLX',
    type: 'multiple',
    options: named('201', '201A', '202', '202A', '203', '203A', '204', '205'),
    initial: ['201', '201A', '202', '202A'],
    shown: true
  },
  { label: '城镇村代码', field: 'CZCDM', type: 'input', operators: TEXT_OPERATORS },
  { label: '城镇村名称', field: 'CZCMC', type: 'input', operators: TEXT_OPERATORS },
  { label: '城镇村面积', field: 'CZCMJ', type: 'input', operators: NUMBER_OPERATORS },
  { label: '备注', field: 'BZ', type: 'input', operators: TEXT_OPERATORS }
];

/** 地类图斑 */
export const PARCEL_FIELDS: readonly ConditionField[] = [
  {
    label: '地类编码',
    field: 'DLBM',
    type: 'multiple',
    options: LAND_CLASS_OPTIONS,
    initial: ['0101', '0102', '0103'],
    shown: true
  },
  {
    label: '权属性质',
    field: 'QSXZ',
    type: 'single',
    options: [
      { code: '10', name: '国有土地所有权' },
      { code: '20', name: '国有土地使用权' },
      { code: '21', name: '国有无居民海岛使用权' },
      { code: '30', name: '集体土地所有权' },
      { code: '31', name: '村民小组' },
      { code: '32', name: '村集体经济组织' },
      { code: '33', name: '乡集体经济组织' },
      { code: '34', name: '其它农民集体经济组织' },
      { code: '40', name: '集体土地使用权' },
      { code: '41', name: '集体无居民海岛使用权' }
    ],
    initial: '10'
  },
  { label: '权属单位名称', field: 'QSDWMC', type: 'input', operators: TEXT_OPERATORS }
];
