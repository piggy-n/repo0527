// 数据申请的共用清单：资源管理提交申请、系统管理审核申请都用（ADR 0092）；旧项目在 QushuNodeForm 和 ResourceApplyDialog 里各写了一份

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

/** 图层代码对应的名称；清单里没有的代码原样显示 */
export function dataLayerLabel(code: string): string {
  return DATA_LAYERS.find(layer => layer.value === code)?.label ?? code;
}

/** 接口里的格式（小写，如 excel；统计任务是 .zip）对应的显示名称；清单里没有的去掉开头的点、改成大写 */
export function dataFormatLabel(value: string): string {
  return DATA_FORMATS.find(format => format.toLowerCase() === value) ?? value.replace(/^\./, '').toUpperCase();
}
