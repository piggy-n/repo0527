// 固定交互样例，只摘取旧配置的代表性字段，不作为正式查询目录
export const MODULES = [
  { value: 'land', label: '国土变更调查' },
  { value: 'city', label: '城市国土空间监测' },
  { value: 'forest', label: '森林草原湿地荒漠调查监测' },
  { value: 'water', label: '水资源基础调查' }
] as const;
export type QueryModule = (typeof MODULES)[number]['value'];
export const MODES = [
  { value: 'attribute', label: '属性查询' },
  { value: 'spatial', label: '空间查询' },
  { value: 'natural', label: '自然语言' },
  { value: 'advanced', label: '高级查询' }
] as const;
export type QueryMode = (typeof MODES)[number]['value'];
export type PreviewScene = 'normal' | 'empty' | 'loading' | 'error';

export interface PreviewField {
  code: string;
  label: string;
  values?: string[];
}
export interface PreviewLayer {
  code: string;
  label: string;
  fields: PreviewField[];
}

const schoolFields: PreviewField[] = [
  { code: 'TYPE', label: '类型', values: ['小学', '初级中学', '高级中学', '幼儿园'] },
  { code: 'NAME', label: '学校名称' },
  { code: 'GXSJ', label: '更新时间' }
];
const hospitalFields: PreviewField[] = [
  { code: 'TYPE', label: '类型', values: ['综合医院', '专科医院', '中医医院'] },
  { code: 'GRADE', label: '医院等级', values: ['一级', '二级', '三级'] },
  { code: 'NAME', label: '医疗机构名称' }
];
export const LAYERS: Record<QueryModule, PreviewLayer[]> = {
  city: [
    { code: 'csxhjctb_xxp_2022', label: '学校点层', fields: schoolFields },
    { code: 'csxhjctb_xxa_2022', label: '学校面层', fields: schoolFields },
    { code: 'csxhjctb_yljgp_2022', label: '医疗机构点层', fields: hospitalFields },
    { code: 'csxhjctb_yljga_2022', label: '医疗机构面层', fields: hospitalFields }
  ],
  land: [
    { code: 'bgdc_czcdyd_2022', label: '城镇村等用地', fields: [
      { code: 'CZCLX', label: '城镇村等用地类型', values: ['201', '201A', '202', '202A', '203'] },
      { code: 'CZCMC', label: '城镇村名称' },
      { code: 'BSM', label: '标识码' }
    ] },
    { code: 'bgdc_dltb_2022', label: '地类图斑', fields: [
      { code: 'DLBM', label: '地类编码', values: ['0101', '0102', '0301', '1101'] },
      { code: 'DLMC', label: '地类名称' },
      { code: 'BSM', label: '标识码' }
    ] }
  ],
  forest: [],
  water: []
};

export const DEMO_ROWS = Array.from({ length: 46 }, (_, index) => ({
  id: index + 1,
  name: `示例调查对象 ${String(index + 1).padStart(2, '0')}`,
  region: ['南京市', '苏州市', '无锡市'][index % 3],
  type: ['类型一', '类型二', '类型三'][index % 3],
  area: (6800 + index * 127).toLocaleString('zh-CN'),
  year: '2022'
}));

export type PreviewRow = (typeof DEMO_ROWS)[number];
