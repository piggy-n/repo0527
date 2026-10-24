import type { QueryField } from './types';

/** 点面图层复用旧版地类编码枚举 */
const LAND_CODE_OPTIONS = [
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

/** 点面图层复用旧版地类名称枚举 */
const LAND_NAME_OPTIONS = [
  { code: '耕地', name: '耕地' },
  { code: '水田', name: '水田' },
  { code: '水浇地', name: '水浇地' },
  { code: '旱地', name: '旱地' },
  { code: '园地', name: '园地' },
  { code: '果园', name: '果园' },
  { code: '茶园', name: '茶园' },
  { code: '可调整茶园', name: '可调整茶园' },
  { code: '橡胶园', name: '橡胶园' },
  { code: '可调整橡胶园', name: '可调整橡胶园' },
  { code: '其他园地', name: '其他园地' },
  { code: '可调整其他园地', name: '可调整其他园地' },
  { code: '林地', name: '林地' },
  { code: '乔木林地', name: '乔木林地' },
  { code: '可调整乔木林地', name: '可调整乔木林地' },
  { code: '竹林地', name: '竹林地' },
  { code: '可调整竹林地', name: '可调整竹林地' },
  { code: '红树林地', name: '红树林地' },
  { code: '森林沼泽', name: '森林沼泽' },
  { code: '灌木林地', name: '灌木林地' },
  { code: '灌丛沼泽', name: '灌丛沼泽' },
  { code: '其他林地', name: '其他林地' },
  { code: '可调整其他林地', name: '可调整其他林地' },
  { code: '草地', name: '草地' },
  { code: '天然牧草地', name: '天然牧草地' },
  { code: '沼泽草地', name: '沼泽草地' },
  { code: '人工牧草地', name: '人工牧草地' },
  { code: '可调整人工牧草地', name: '可调整人工牧草地' },
  { code: '其他草地', name: '其他草地' },
  { code: '商服用地', name: '商服用地' },
  { code: '商业服务设施', name: '商业服务设施' },
  { code: '物流仓储用地', name: '物流仓储用地' },
  { code: '工矿用地', name: '工矿用地' },
  { code: '0601', name: '工业用地' },
  { code: '工业用地', name: '采矿用地' },
  { code: '盐田', name: '盐田' },
  { code: '住宅用地', name: '住宅用地' },
  { code: '城镇住宅', name: '城镇住宅' },
  { code: '农村宅基地', name: '农村宅基地' },
  { code: '公共管理与公共服务', name: '公共管理与公共服务' },
  { code: '机关团体新闻出版', name: '机关团体新闻出版' },
  { code: '科教文卫用地', name: '科教文卫用地' },
  { code: '高教用地', name: '高教用地' },
  { code: '公用设施用地', name: '公用设施用地' },
  { code: '公园与绿地', name: '公园与绿地' },
  { code: '广场用地', name: '广场用地' },
  { code: '特殊用地', name: '特殊用地' },
  { code: '交通运输用地', name: '交通运输用地' },
  { code: '铁路用地', name: '铁路用地' },
  { code: '轨道交通用地', name: '轨道交通用地' },
  { code: '公路用地', name: '公路用地' },
  { code: '城镇村道路用地', name: '城镇村道路用地' },
  { code: '交通服务场站用地', name: '交通服务场站用地' },
  { code: '农村道路', name: '农村道路' },
  { code: '机场用地', name: '机场用地' },
  { code: '港口码头用地', name: '港口码头用地' },
  { code: '管道运输用地', name: '管道运输用地' },
  { code: '水域', name: '水域' },
  { code: '河流水面', name: '河流水面' },
  { code: '湖泊水面', name: '湖泊水面' },
  { code: '水库水面', name: '水库水面' },
  { code: '坑塘水面', name: '坑塘水面' },
  { code: '养殖坑塘', name: '养殖坑塘' },
  { code: '可调整养殖坑塘', name: '可调整养殖坑塘' },
  { code: '沿海滩涂', name: '沿海滩涂' },
  { code: '内陆滩涂', name: '内陆滩涂' },
  { code: '沟渠', name: '沟渠' },
  { code: '干渠', name: '干渠' },
  { code: '水工建筑用地', name: '水工建筑用地' },
  { code: '冰川及永久积雪', name: '冰川及永久积雪' },
  { code: '其他土地', name: '其他土地' },
  { code: '空闲地', name: '空闲地' },
  { code: '设施农用地', name: '设施农用地' },
  { code: '田坎', name: '田坎' },
  { code: '盐碱地', name: '盐碱地' },
  { code: '沙地', name: '沙地' },
  { code: '裸土地', name: '裸土地' },
  { code: '裸岩石砾地', name: '裸岩石砾地' },
  { code: '后备耕地', name: '后备耕地' }
];

/** 点面图层复用旧版监测一致性枚举 */
const LAND_CONSISTENCY_OPTIONS = [
  { code: '是', name: '监测时实地与上年度国土变更调查成果地类二级类一致' },
  { code: '否', name: '监测时实地与上年度国土变更调查成果地类二级类不一致' },
  {
    code: '-9999',
    name: '监测时实地与上年度国土变更调查成果地类二级类不一致，但是视为特例，无需举证的；\n' +
      '监测时实地与上年度国土变更调查成果地类二级类不一致，但是在之前年份的监测中已举证过，且监测时没有新变化，无需举证'
  }
];

/** 学校点层的字段与枚举，点面图层共用同一份配置 */
export const SCHOOL_FIELDS: readonly QueryField[] = [
  {
    code: 'DLBM',
    label: '变化(或细化)前地类编码',
    type: 'singleSelect',
    options: LAND_CODE_OPTIONS
  },
  {
    code: 'DLMC',
    label: '变化(或细化)前地类名称',
    type: 'singleSelect',
    options: LAND_NAME_OPTIONS
  },
  {
    code: 'CC',
    label: '变化(或细化)后类型代码',
    type: 'singleSelect',
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
    code: 'CCN',
    label: '变化(或细化)后类型名称',
    type: 'singleSelect',
    options: [
      { code: '高等院校', name: '高等院校' },
      { code: '中等职业学校', name: '中等职业学校' },
      { code: '中小学', name: '中小学' },
      { code: '幼托机构', name: '幼托机构' },
      { code: '特殊教育学校', name: '特殊教育学校' },
      { code: '专门学校（工读学校）', name: '专门学校（工读学校）' }
    ]
  },
  {
    code: 'NAME',
    label: '学校名称',
    type: 'input',
    operators: [
      'LIKE',
      'NOT'
    ]
  },
  {
    code: 'TYPE',
    label: '类型',
    type: 'multipleSelect',
    options: [
      { code: '普通高等学校本科院校', name: '普通高等学校本科院校' },
      { code: '普通高等学校高职（专科）院校', name: '普通高等学校高职（专科）院校' },
      { code: '成人高等学校', name: '成人高等学校' },
      { code: '军事院校', name: '军事院校' },
      { code: '其他', name: '其他' },
      { code: '小学', name: '小学' },
      { code: '初级中学', name: '初级中学' },
      { code: '高级中学', name: '高级中学' },
      { code: '9年一贯制学校', name: '9年一贯制学校' },
      { code: '12年一贯制学校', name: '12年一贯制学校' },
      { code: '完全中学', name: '完全中学' },
      { code: '幼儿园', name: '幼儿园' },
      { code: '幼儿园（含幼托）', name: '幼儿园（含幼托）' },
      { code: '托儿所', name: '托儿所' },
      { code: '盲人学校', name: '盲人学校' },
      { code: '聋人学校', name: '聋人学校' },
      { code: '培智学校', name: '培智学校' },
      { code: '其他特殊教育学校', name: '其他特殊教育学校' }
    ],
    initial: [
      '普通高等学校本科院校',
      '小学',
      '高级中学',
      '托儿所'
    ],
    shown: true
  },
  {
    code: 'QUOTA',
    label: '班级数',
    type: 'input',
    operators: [
      '>',
      '<',
      '=',
      '>=',
      '<='
    ],
    numeric: true
  },
  {
    code: 'IFTC',
    label: '是否为职业教育院校',
    type: 'singleSelect',
    options: [
      { code: '是', name: '是' },
      { code: '否', name: '否' }
    ]
  },
  {
    code: 'FEATID',
    label: '要素唯一标识码',
    type: 'input',
    operators: [
      'LIKE',
      'NOT'
    ]
  },
  {
    code: 'IFCON',
    label: '监测时实地与上年度国土变更调查成果地类二级类是否一致',
    type: 'singleSelect',
    options: LAND_CONSISTENCY_OPTIONS
  },
  {
    code: 'GXSJ',
    label: '更新时间',
    type: 'datetime'
  }
];

/** 医疗机构点层的字段与枚举，点面图层共用同一份配置 */
export const HOSPITAL_FIELDS: readonly QueryField[] = [
  {
    code: 'DLBM',
    label: '变化(或细化)前地类编码',
    type: 'singleSelect',
    options: LAND_CODE_OPTIONS
  },
  {
    code: 'DLMC',
    label: '变化(或细化)前地类名称',
    type: 'singleSelect',
    options: LAND_NAME_OPTIONS
  },
  {
    code: 'CC',
    label: '变化(或细化)后类型代码',
    type: 'singleSelect',
    options: [
      { code: '08H22', name: '医疗设施' },
      { code: '08H221', name: '医院' },
      { code: '08H221A', name: '方舱医院' },
      { code: '08H222', name: '社区卫生服务设施' }
    ]
  },
  {
    code: 'CCN',
    label: '变化(或细化)后类型名称',
    type: 'singleSelect',
    options: [
      { code: '医院', name: '医院' },
      { code: '方舱医院', name: '方舱医院' },
      { code: '社区卫生服务设施', name: '社区卫生服务设施' }
    ]
  },
  {
    code: 'NAME',
    label: '医疗机构名称',
    type: 'input',
    operators: [
      'LIKE',
      'NOT'
    ]
  },
  {
    code: 'TYPE',
    label: '类型',
    type: 'multipleSelect',
    options: [
      { code: '综合医院', name: '综合医院' },
      { code: '专科医院', name: '专科医院' },
      { code: '中医医院', name: '中医医院' },
      { code: '中西医结合医院', name: '中西医结合医院' },
      { code: '民族医医院', name: '民族医医院' },
      { code: '护理院', name: '护理院' },
      { code: '康复医院', name: '康复医院' },
      { code: '妇幼保健机构', name: '妇幼保健机构' },
      { code: '急救中心（站）', name: '急救中心（站）' },
      { code: '疾病预防控制中心', name: '疾病预防控制中心' },
      { code: '社区卫生服务中心', name: '社区卫生服务中心' },
      { code: '社区卫生服务站', name: '社区卫生服务站' }
    ],
    initial: [
      '综合医院',
      '专科医院',
      '中医医院',
      '中西医结合医院'
    ],
    shown: true
  },
  {
    code: 'GRADE',
    label: '医院等级',
    type: 'singleSelect',
    options: [
      { code: '一级', name: '一级' },
      { code: '一级甲等', name: '一级甲等' },
      { code: '一级乙等', name: '一级乙等' },
      { code: '一级丙等', name: '一级丙等' },
      { code: '二级', name: '二级' },
      { code: '二级甲等', name: '二级甲等' },
      { code: '二级乙等', name: '二级乙等' },
      { code: '二级丙等', name: '二级丙等' },
      { code: '三级', name: '三级' },
      { code: '三级甲等', name: '三级甲等' },
      { code: '三级乙等', name: '三级乙等' },
      { code: '三级丙等', name: '三级丙等' },
      { code: '等外', name: '等外' },
      { code: '未定级', name: '未定级' },
      { code: '-9999', name: '-9999' }
    ],
    initial: '一级',
    shown: true
  },
  {
    code: 'QUOTA',
    label: '规模',
    type: 'input',
    operators: [
      '>',
      '<',
      '=',
      '>=',
      '<='
    ],
    numeric: true
  },
  {
    code: 'IFTC',
    label: '是否为县(区)级及以上医院',
    type: 'singleSelect',
    options: [
      { code: '是', name: '是' },
      { code: '否', name: '否' },
      { code: '-9999', name: '-9999' }
    ]
  },
  {
    code: 'FEATID',
    label: '要素唯一标识码',
    type: 'input',
    operators: [
      'LIKE',
      'NOT'
    ]
  },
  {
    code: 'IFCON',
    label: '监测时实地与上年度国土变更调查成果地类二级类是否一致',
    type: 'singleSelect',
    options: LAND_CONSISTENCY_OPTIONS
  },
  {
    code: 'GXSJ',
    label: '更新时间',
    type: 'datetime'
  }
];

/** 城镇村等用地的字段与枚举，点面图层共用同一份配置 */
export const TOWN_FIELDS: readonly QueryField[] = [
  {
    code: 'CZCLX',
    label: '城镇村等用地类型',
    type: 'multipleSelect',
    options: [
      { code: '201', name: '201' },
      { code: '201A', name: '201A' },
      { code: '202', name: '202' },
      { code: '202A', name: '202A' },
      { code: '203', name: '203' },
      { code: '203A', name: '203A' },
      { code: '204', name: '204' },
      { code: '205', name: '205' }
    ],
    initial: [
      '201',
      '201A',
      '202',
      '202A'
    ],
    shown: true
  },
  {
    code: 'CZCDM',
    label: '城镇村代码',
    type: 'input',
    operators: [
      'LIKE',
      'NOT'
    ]
  },
  {
    code: 'CZCMC',
    label: '城镇村名称',
    type: 'input',
    operators: [
      'LIKE',
      'NOT'
    ]
  },
  {
    code: 'CZCMJ',
    label: '城镇村面积',
    type: 'input',
    operators: [
      '>',
      '<',
      '=',
      '>=',
      '<='
    ],
    numeric: true
  },
  {
    code: 'FEATID',
    label: '备注',
    type: 'input',
    operators: [
      'LIKE',
      'NOT'
    ]
  }
];

/** 地类图斑的字段与枚举，点面图层共用同一份配置 */
export const LAND_FIELDS: readonly QueryField[] = [
  {
    code: 'DLBM',
    label: '地类编码',
    type: 'multipleSelect',
    options: LAND_CODE_OPTIONS,
    initial: [
      '0101',
      '0102',
      '0103'
    ],
    shown: true
  },
  {
    code: 'QSXZ',
    label: '权属性质',
    type: 'singleSelect',
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
    initial: [
      '10'
    ]
  },
  {
    code: 'QSDWMC',
    label: '权属单位名称',
    type: 'input',
    operators: [
      'LIKE',
      'NOT'
    ]
  }
];
