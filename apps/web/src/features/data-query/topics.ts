import { type ConditionField, HOSPITAL_FIELDS, PARCEL_FIELDS, SCHOOL_FIELDS, TOWN_FIELDS } from './layer-fields';

/** 数据查询的四个专题，对应查询统计菜单下的四个页面 */
export type TopicId = 'land-change' | 'space-monitoring' | 'forest-grass-wetland-desert' | 'water-resource';

/** 结果表的一列；decimals 是面积这类数值保留的小数位 */
export interface ResultColumn {
  readonly prop: string;
  readonly label: string;
  readonly decimals?: number;
}

/** 可查询的一个图层 */
export interface QueryLayer {
  readonly label: string;
  /** 接口的 layerCode */
  readonly table: string;
  /** 点层画圆点，面层画边线；预览和结果都按它出图层 */
  readonly geometry: 'point' | 'polygon';
  /** MVT 瓦片里的图层名：城镇村等用地是表名中段，其余是完整表名（旧页面实测） */
  readonly sourceLayer: string;
  readonly fields: readonly ConditionField[];
  readonly columns: readonly ResultColumn[];
}

/** 自然语言查询的一条模拟解析规则：示例原样命中，或者包含全部关键词 */
export interface NaturalLanguageRule {
  readonly examples: readonly string[];
  readonly keywords: readonly string[];
  readonly table: string;
  readonly region: string;
  /** 回填到属性查询的一个多选条件 */
  readonly condition?: { readonly field: string; readonly value: readonly string[] };
}

export interface NaturalLanguageConfig {
  readonly placeholder: string;
  /** "换一组"依次轮换；第一条是默认的输入 */
  readonly examples: readonly string[];
  readonly rules: readonly NaturalLanguageRule[];
}

export interface QueryTopic {
  readonly id: TopicId;
  /** 面板标题，同旧页面的路由标题 */
  readonly title: string;
  /** 为空时是建设中的专题：只有地图和说明 */
  readonly layers: readonly QueryLayer[];
  readonly natural: NaturalLanguageConfig | null;
}

// 结果表的列沿用旧页面，字段名按接口实际返回修正（学校的 ifch → iftc，地类图斑的 Tbxhmc → tbxhmc）；
// 接口不返回的列（学校、医院的 gxsj，医院的 quota、bz）保留，显示为空，记在 docs/migration.md
const SCHOOL_COLUMNS: readonly ResultColumn[] = [
  { prop: 'cc', label: '变化(或细化)后类型代码' },
  { prop: 'ccn', label: '变化(或细化)后类型名称' },
  { prop: 'name', label: '学校名称' },
  { prop: 'type', label: '类型' },
  { prop: 'iftc', label: '是否为职业教育院校' },
  { prop: 'gxsj', label: '更新时间' }
];

const HOSPITAL_COLUMNS: readonly ResultColumn[] = [
  { prop: 'cc', label: '变化(或细化)后类型代码' },
  { prop: 'ccn', label: '变化(或细化)后类型名称' },
  { prop: 'name', label: '医疗机构名称' },
  { prop: 'type', label: '类型' },
  { prop: 'grade', label: '医院等级' },
  { prop: 'quota', label: '规模' },
  { prop: 'ifch', label: '是否为县(区)级及以上医院' },
  { prop: 'gxsj', label: '更新时间' },
  { prop: 'bz', label: '备注' }
];

const TOWN_COLUMNS: readonly ResultColumn[] = [
  { prop: 'bsm', label: '标识码' },
  { prop: 'ysdm', label: '要素代码' },
  { prop: 'czclx', label: '城镇村等用地类型' },
  { prop: 'czcdm', label: '城镇村代码' },
  { prop: 'czcmc', label: '城镇村名称' },
  { prop: 'czcmj', label: '城镇村面积（亩）', decimals: 1 },
  { prop: 'bz', label: '备注' }
];

const PARCEL_COLUMNS: readonly ResultColumn[] = [
  { prop: 'bsm', label: '标识码' },
  { prop: 'tbbh', label: '图斑编号' },
  { prop: 'dlbm', label: '地类编码' },
  { prop: 'dlmc', label: '地类名称' },
  { prop: 'qsxz', label: '权属性质' },
  { prop: 'tbxhmc', label: '图斑细化名称' },
  { prop: 'tbmj', label: '图斑面积（亩）', decimals: 1 },
  { prop: 'bz', label: '备注' }
];

const school = (label: string, table: string, geometry: QueryLayer['geometry']): QueryLayer => ({
  label,
  table,
  geometry,
  sourceLayer: table,
  fields: SCHOOL_FIELDS,
  columns: SCHOOL_COLUMNS
});

const hospital = (label: string, table: string, geometry: QueryLayer['geometry']): QueryLayer => ({
  label,
  table,
  geometry,
  sourceLayer: table,
  fields: HOSPITAL_FIELDS,
  columns: HOSPITAL_COLUMNS
});

// 自然语言的示例与规则原样来自旧页面；国土变更调查的输入提示换成能识别的示例（旧提示的"耕地分布"规则已注释掉）
const SPACE_MONITORING_NATURAL: NaturalLanguageConfig = {
  placeholder: '请输入自然语言描述，例如：“查询江苏省学校面层数据”',
  examples: [
    '查询江苏省学校面层数据',
    '查询江苏省学校面层中类型为普通高等学校本科院校、小学、高级中学、托儿所的数据',
    '查询南京市学校点层中类型为小学、高级中学的数据',
    '查询江苏省学校点层中类型为普通高等学校本科院校、小学的数据',
    '查询江苏省学校面层中类型为幼儿园、托儿所的数据'
  ],
  rules: [
    {
      examples: ['查询江苏省学校面层数据'],
      keywords: ['学校面层', '数据'],
      table: 'csxhjctb_xxa_2022',
      region: '320000'
    },
    {
      examples: ['查询江苏省学校面层中类型为普通高等学校本科院校、小学、高级中学、托儿所的数据'],
      keywords: ['学校面层', '普通高等学校本科院校', '小学', '高级中学', '托儿所'],
      table: 'csxhjctb_xxa_2022',
      region: '320000',
      condition: { field: 'TYPE', value: ['普通高等学校本科院校', '小学', '高级中学', '托儿所'] }
    },
    {
      examples: ['查询南京市学校点层中类型为小学、高级中学的数据'],
      keywords: ['南京市', '学校点层', '小学', '高级中学'],
      table: 'csxhjctb_xxp_2022',
      region: '320100',
      condition: { field: 'TYPE', value: ['小学', '高级中学'] }
    },
    {
      examples: ['查询江苏省学校点层中类型为普通高等学校本科院校、小学的数据'],
      keywords: ['学校点层', '普通高等学校本科院校', '小学'],
      table: 'csxhjctb_xxp_2022',
      region: '320000',
      condition: { field: 'TYPE', value: ['普通高等学校本科院校', '小学'] }
    },
    {
      examples: ['查询江苏省学校面层中类型为幼儿园、托儿所的数据'],
      keywords: ['学校面层', '幼儿园', '托儿所'],
      table: 'csxhjctb_xxa_2022',
      region: '320000',
      condition: { field: 'TYPE', value: ['幼儿园', '托儿所'] }
    }
  ]
};

const LAND_CHANGE_NATURAL: NaturalLanguageConfig = {
  placeholder: '请输入自然语言描述，例如：“南京市城镇村等用地类型为201、201A的数据”',
  examples: [
    '江苏省南京市城镇村等用地类型为201、201A的城镇村等用地',
    '查询江苏省城镇村等用地类型为202、202A的数据',
    '南京市城镇村等用地类型为201、201A的数据',
    '查询江苏省城镇村等用地类型为201、201A、202的数据'
  ],
  rules: [
    {
      examples: ['查询江苏省城镇村等用地类型为201、201A、202的数据'],
      keywords: ['城镇村等用地', '201', '201A', '202'],
      table: 'bgdc_czcdyd_2022',
      region: '320000',
      condition: { field: 'CZCLX', value: ['201', '201A', '202'] }
    },
    {
      examples: ['江苏省南京市城镇村等用地类型为201、201A的城镇村等用地', '南京市城镇村等用地类型为201、201A的数据'],
      keywords: ['城镇村等用地', '201', '201A'],
      table: 'bgdc_czcdyd_2022',
      region: '320100',
      condition: { field: 'CZCLX', value: ['201', '201A'] }
    },
    {
      examples: ['查询江苏省城镇村等用地类型为202、202A的数据'],
      keywords: ['城镇村等用地', '202', '202A'],
      table: 'bgdc_czcdyd_2022',
      region: '320000',
      condition: { field: 'CZCLX', value: ['202', '202A'] }
    }
  ]
};

/** 四个专题；国土变更调查的两个图层是旧配置里从城市国土空间监测拆出来的 */
export const QUERY_TOPICS: Readonly<Record<TopicId, QueryTopic>> = {
  'land-change': {
    id: 'land-change',
    title: '国土变更调查查询',
    layers: [
      {
        label: '城镇村等用地',
        table: 'bgdc_czcdyd_2022',
        geometry: 'polygon',
        sourceLayer: 'czcdyd',
        fields: TOWN_FIELDS,
        columns: TOWN_COLUMNS
      },
      {
        label: '地类图斑',
        table: 'bgdc_dltb_2022',
        geometry: 'polygon',
        sourceLayer: 'bgdc_dltb_2022',
        fields: PARCEL_FIELDS,
        columns: PARCEL_COLUMNS
      }
    ],
    natural: LAND_CHANGE_NATURAL
  },
  'space-monitoring': {
    id: 'space-monitoring',
    title: '城市国土空间监测查询',
    layers: [
      school('学校点层', 'csxhjctb_xxp_2022', 'point'),
      school('学校面层', 'csxhjctb_xxa_2022', 'polygon'),
      hospital('医疗机构点层', 'csxhjctb_yljgp_2022', 'point'),
      hospital('医疗机构面层', 'csxhjctb_yljga_2022', 'polygon')
    ],
    natural: SPACE_MONITORING_NATURAL
  },
  'forest-grass-wetland-desert': {
    id: 'forest-grass-wetland-desert',
    title: '森林草原湿地荒漠调查监测',
    layers: [],
    natural: null
  },
  'water-resource': { id: 'water-resource', title: '水资源基础调查', layers: [], natural: null }
};

/** 专题里的图层；不在这个专题里时为 undefined */
export function layerOf(topic: QueryTopic, table: string): QueryLayer | undefined {
  return topic.layers.find(layer => layer.table === table);
}
