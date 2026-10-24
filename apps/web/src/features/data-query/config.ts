import { HOSPITAL_FIELDS, LAND_FIELDS, SCHOOL_FIELDS, TOWN_FIELDS } from './fields';
import type { QueryLayer, QueryModule } from './types';

export const MODULE_LABELS: Record<QueryModule, string> = {
  land: '国土变更调查', city: '城市国土空间监测', forest: '森林草原湿地荒漠调查监测', water: '水资源基础调查'
};

export const QUERY_MODES = [
  { value: 'attribute', label: '属性查询' }, { value: 'spatial', label: '空间查询' },
  { value: 'natural', label: '自然语言' }, { value: 'advanced', label: '高级查询' }
];

/** 后两个模块尚无业务配置；不把其他模块的图层当作它们的数据 */
export const QUERY_LAYERS: Record<QueryModule, readonly QueryLayer[]> = {
  land: [
    { code: 'bgdc_czcdyd_2022', label: '城镇村等用地', sourceLayer: 'czcdyd', geometry: 'polygon', fields: TOWN_FIELDS },
    { code: 'bgdc_dltb_2022', label: '地类图斑', sourceLayer: 'bgdc_dltb_2022', geometry: 'polygon', fields: LAND_FIELDS }
  ],
  city: [
    { code: 'csxhjctb_xxp_2022', label: '学校点层', sourceLayer: 'csxhjctb_xxp_2022',
      geometry: 'point', fields: SCHOOL_FIELDS },
    { code: 'csxhjctb_xxa_2022', label: '学校面层', sourceLayer: 'csxhjctb_xxa_2022',
      geometry: 'polygon', fields: SCHOOL_FIELDS },
    { code: 'csxhjctb_yljgp_2022', label: '医疗机构点层', sourceLayer: 'csxhjctb_yljgp_2022',
      geometry: 'point', fields: HOSPITAL_FIELDS },
    { code: 'csxhjctb_yljga_2022', label: '医疗机构面层', sourceLayer: 'csxhjctb_yljga_2022',
      geometry: 'polygon', fields: HOSPITAL_FIELDS }
  ],
  forest: [],
  water: []
};

export const PAGE_SIZE = 20;

/** 只保留旧版明确配置的示例，未接入通用自然语言解析服务 */
export interface NaturalRule {
  text: string;
  layerCode: string;
  region: string;
  field?: string;
  values?: string[];
}

export const NATURAL_RULES: Record<QueryModule, readonly NaturalRule[]> = {
  city: [
    { text: '查询江苏省学校面层数据', layerCode: 'csxhjctb_xxa_2022', region: '320000' },
    { text: '查询江苏省学校面层中类型为普通高等学校本科院校、小学、高级中学、托儿所的数据',
      layerCode: 'csxhjctb_xxa_2022', region: '320000', field: 'TYPE',
      values: ['普通高等学校本科院校', '小学', '高级中学', '托儿所'] },
    { text: '查询南京市学校点层中类型为小学、高级中学的数据', layerCode: 'csxhjctb_xxp_2022',
      region: '320100', field: 'TYPE', values: ['小学', '高级中学'] },
    { text: '查询江苏省学校点层中类型为普通高等学校本科院校、小学的数据', layerCode: 'csxhjctb_xxp_2022',
      region: '320000', field: 'TYPE', values: ['普通高等学校本科院校', '小学'] },
    { text: '查询江苏省学校面层中类型为幼儿园、托儿所的数据', layerCode: 'csxhjctb_xxa_2022',
      region: '320000', field: 'TYPE', values: ['幼儿园', '托儿所'] }
  ],
  land: [
    { text: '查询江苏省城镇村等用地类型为201、201A、202的数据', layerCode: 'bgdc_czcdyd_2022',
      region: '320000', field: 'CZCLX', values: ['201', '201A', '202'] },
    { text: '南京市城镇村等用地类型为201、201A的数据', layerCode: 'bgdc_czcdyd_2022',
      region: '320100', field: 'CZCLX', values: ['201', '201A'] },
    { text: '查询江苏省城镇村等用地类型为202、202A的数据', layerCode: 'bgdc_czcdyd_2022',
      region: '320000', field: 'CZCLX', values: ['202', '202A'] }
  ],
  forest: [], water: []
};
