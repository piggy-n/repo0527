// 标注可选的字段（ADR 0160）：目录接口不给字段清单，按 code 登记，一个资源一行。只列这个资源瓦片里实际有的、
// 业务上看得懂的属性：名称、类型这类，和业务上常看的编码、编号（地类编码、图斑编号、路线编号、批准文号）；机器用的标识码、
// 单位代码、面积、日期不列。第一个是默认字段；字段来自 2026-11-01 的探查（probe:resource-classes 的属性抽样，
// 年份取各资源最新的一年）。没有登记的资源不提供标注

/** 一个可选的字段 */
export interface LabelFieldOption {
  readonly field: string;
  /** 下拉框里的名称，后面写字段名 */
  readonly name: string;
}

// 字段的通用叫法；个别资源的叫法不同时写在那一行里
const FIELD_NAMES: Readonly<Record<string, string>> = {
  name: '名称',
  type: '类型',
  ccn: '类别名称',
  dlmc: '地类名称',
  dlbm: '地类编码',
  zldwmc: '坐落单位名称',
  qsdwmc: '权属单位名称',
  tbbh: '图斑编号',
  czcmc: '城镇村名称',
  bhqmc: '保护区名称',
  bhqjb: '保护区级别',
  lyd: '利用等',
  zrd: '自然等',
  jjd: '经济等',
  kfyqmc: '开发园区名称',
  mc: '名称',
  pzwh: '批准文号',
  pzwjmc: '批准文件名称',
  xmmc: '项目名称',
  xzqmc: '行政区名称',
  csmc: '城市名称',
  bfccn: '类别名称',
  use: '用途',
  grade: '等级',
  rn: '路线编号',
  hxcmc: '滑雪场名称',
  xmc: '县名称',
  ghfqmc: '规划分区名称',
  hxmc: '红线名称',
  hxlx: '红线类型',
  zrbhdmc: '自然保护地名称',
  hlmc: '河流名称',
  xjxzqmc: '县级行政区名称',
  hpmc: '湖泊名称',
  skmc: '水库名称'
};

// 字段，或 [字段, 这个资源里的叫法]
type FieldRow = string | readonly [field: string, name: string];

const ROWS: readonly (readonly [code: string, fields: readonly FieldRow[]])[] = [
  ['bgdc_cjdcq', ['zldwmc']],
  ['bgdc_dltb', ['dlmc', 'dlbm', 'zldwmc', 'qsdwmc', 'tbbh']],
  ['bgdc_dltb_czc', ['dlmc', 'dlbm', 'czcmc', 'zldwmc', 'tbbh']],
  ['bgdc_fjmsq', ['bhqmc', 'bhqjb']],
  ['bgdc_gddb', ['dlmc', 'lyd', 'zrd', 'jjd']],
  ['bgdc_kfyq', ['kfyqmc']],
  ['bgdc_lmfw', ['mc']],
  ['bgdc_lsyd', ['pzwh', 'pzwjmc']],
  ['bgdc_pzwjstd', ['xmmc', 'pzwh', 'tbbh']],
  ['bgdc_stbhhx', ['mc']],
  ['bgdc_xzq', ['xzqmc']],
  ['bgdc_yjjbnttb', ['dlmc', 'zldwmc', 'tbbh']],
  ['bgdc_zrbhd', ['bhqmc', 'bhqjb']],
  ['csxhjctb_bzssa', ['name', 'type', 'ccn', 'dlmc']],
  ['csxhjctb_cqjcfwa', ['xzqmc', 'csmc']],
  ['csxhjctb_czzza', ['ccn', 'dlmc']],
  ['csxhjctb_dltbbha', ['bfccn']],
  ['csxhjctb_dltbbhp', ['bfccn']],
  ['csxhjctb_dxkja', ['name', 'use', 'type']],
  ['csxhjctb_dxkjl', ['name', 'use', 'type']],
  ['csxhjctb_fljga', ['name', 'ccn', 'dlmc']],
  ['csxhjctb_fljgp', ['name', 'ccn', 'dlmc']],
  ['csxhjctb_gyssa', ['name', 'ccn', 'type', 'dlmc']],
  ['csxhjctb_gyssp', ['name', 'ccn', 'type', 'dlmc']],
  ['csxhjctb_gyylda', ['name', 'ccn', 'dlmc']],
  ['csxhjctb_hyda', ['name', 'ccn']],
  // 名称有三分之二是 -9999（后端的占位值），标注里不显示
  ['csxhjctb_hydl', ['name', 'ccn', 'type']],
  ['csxhjctb_jgtta', ['name', 'dlmc']],
  ['csxhjctb_jgttp', ['name', 'dlmc']],
  ['csxhjctb_jtfwcza', ['name', 'ccn', 'type', 'dlmc']],
  ['csxhjctb_jtysyda', ['name', 'ccn', 'type', 'dlmc']],
  ['csxhjctb_jtysydp', ['name', 'type', 'dlmc']],
  ['csxhjctb_lctl', [['name', '道路名称'], ['type', '道路等级'], 'rn']],
  ['csxhjctb_llkl', ['name', 'type']],
  ['csxhjctb_llkp', ['name', 'type']],
  ['csxhjctb_lrdl', [['names', '路线简称'], ['name', '路线名称'], 'rn', ['type', '行政等级']]],
  ['csxhjctb_lrrl', [['name', '铁路名称'], 'type']],
  ['csxhjctb_lvll', ['type']],
  ['csxhjctb_sdza', ['name', 'dlmc']],
  ['csxhjctb_swhxcbctqtba', ['hxcmc', 'xmc']],
  ['csxhjctb_swhxcwydctba', ['hxcmc', 'xmc']],
  ['csxhjctb_syfwya', ['name', 'ccn', 'dlmc']],
  ['csxhjctb_syfwyp', ['name', 'ccn', 'dlmc']],
  ['csxhjctb_tyhda', ['name', 'dlmc']],
  ['csxhjctb_tyhdp', ['name', 'dlmc']],
  ['csxhjctb_whhda', ['name', 'type', 'dlmc']],
  ['csxhjctb_whhdp', ['name', 'type', 'dlmc']],
  ['csxhjctb_wycga', ['name', 'type', 'dlmc']],
  ['csxhjctb_wycgp', ['name', 'type', 'dlmc']],
  ['csxhjctb_xxa', ['name', 'type', 'ccn', 'dlmc']],
  ['csxhjctb_xxp', ['name', 'type', 'ccn', 'dlmc']],
  ['csxhjctb_xzcsgxgzyda', ['name', 'type']],
  ['csxhjctb_yjbna', ['name', 'type']],
  ['csxhjctb_yljga', ['name', 'type', 'ccn', 'grade', 'dlmc']],
  ['csxhjctb_yljgp', ['name', 'type', 'ccn', 'grade', 'dlmc']],
  ['gtkjgh_czkfbj', ['ghfqmc', 'xzqmc']],
  ['gtkjgh_stbhhx', ['hxmc', 'hxlx', 'zrbhdmc', 'xzqmc']],
  ['lcsh_cdtb', ['dlmc']],
  ['lcsh_hmtb', ['dlmc']],
  ['lcsh_sdtb', ['dlmc', 'zldwmc', 'tbbh']],
  ['lcsh_sltb', ['dlmc', 'zldwmc', 'tbbh']],
  ['szy_hl_fs', ['hlmc', 'xjxzqmc']],
  ['szy_hl_ks', ['hlmc', 'xjxzqmc']],
  ['szy_hp_fs', ['hpmc']],
  ['szy_hp_ks', ['hpmc']],
  ['szy_sk_fs', ['skmc']],
  ['szy_sk_ks', ['skmc']]
];

const toOption = (row: FieldRow): LabelFieldOption => {
  const [field, name] = typeof row === 'string' ? [row, undefined] : row;
  const known = name ?? FIELD_NAMES[field];
  if (known === undefined) {
    throw new Error(`字段 ${field} 没有叫法`);
  }
  return { field, name: known };
};

const LABEL_FIELDS: ReadonlyMap<string, readonly LabelFieldOption[]> = new Map(
  ROWS.map(([code, fields]) => [code, fields.map(toOption)])
);

/** 资源可选的标注字段，第一个是默认字段；没有登记时为空，这个资源不提供标注 */
export function labelFieldsOf(code: string): readonly LabelFieldOption[] {
  return LABEL_FIELDS.get(code) ?? [];
}

/** 登记了标注字段的资源 */
export function labeledCodes(): string[] {
  return [...LABEL_FIELDS.keys()];
}
