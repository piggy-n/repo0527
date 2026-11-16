// 标注可选的字段（ADR 0160）：目录接口不给字段清单，按 code 登记，一个资源一行。只列这个资源瓦片里实际有的、
// 业务上看得懂的属性：名称、类型这类，和业务上常看的编码、编号（地类编码、图斑编号、路线编号、批准文号）；机器用的标识码、
// 单位代码、面积、日期不列。第一个是默认字段；比例是有值的要素占多少，来自 2026-11-01 的探查
// （probe:resource-classes 的属性抽样，-9999 算没有值，年份取各资源最新的一年）。没有登记的资源不提供标注

/** 一个可选的字段 */
export interface LabelFieldOption {
  readonly field: string;
  /** 下拉框里的名称，后面写字段名 */
  readonly name: string;
  /** 有值的比例，0～1 */
  readonly share: number;
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

// [字段, 有值的比例] 或 [字段, 有值的比例, 这个资源里的叫法]
type FieldRow = readonly [field: string, share: number, name?: string];

const ROWS: readonly (readonly [code: string, fields: readonly FieldRow[]])[] = [
  ['bgdc_cjdcq', [['zldwmc', 1]]],
  ['bgdc_dltb', [['dlmc', 1], ['dlbm', 1], ['zldwmc', 1], ['qsdwmc', 1], ['tbbh', 1]]],
  ['bgdc_dltb_czc', [['dlmc', 1], ['dlbm', 1], ['czcmc', 0.4], ['zldwmc', 1], ['tbbh', 1]]],
  ['bgdc_fjmsq', [['bhqmc', 1], ['bhqjb', 1]]],
  ['bgdc_gddb', [['dlmc', 1], ['lyd', 1], ['zrd', 1], ['jjd', 1]]],
  ['bgdc_kfyq', [['kfyqmc', 1]]],
  ['bgdc_lmfw', [['mc', 0.75]]],
  ['bgdc_lsyd', [['pzwh', 1], ['pzwjmc', 1]]],
  ['bgdc_pzwjstd', [['xmmc', 1], ['pzwh', 0.9], ['tbbh', 1]]],
  ['bgdc_stbhhx', [['mc', 1]]],
  ['bgdc_xzq', [['xzqmc', 1]]],
  ['bgdc_yjjbnttb', [['dlmc', 1], ['zldwmc', 1], ['tbbh', 1]]],
  ['bgdc_zrbhd', [['bhqmc', 1], ['bhqjb', 1]]],
  ['csxhjctb_bzssa', [['name', 1], ['type', 1], ['ccn', 1], ['dlmc', 1]]],
  ['csxhjctb_cqjcfwa', [['xzqmc', 1], ['csmc', 1]]],
  ['csxhjctb_czzza', [['ccn', 1], ['dlmc', 1]]],
  ['csxhjctb_dltbbha', [['bfccn', 1]]],
  ['csxhjctb_dltbbhp', [['bfccn', 1]]],
  ['csxhjctb_dxkja', [['name', 1], ['use', 1], ['type', 1]]],
  ['csxhjctb_dxkjl', [['name', 1], ['use', 1], ['type', 1]]],
  ['csxhjctb_fljga', [['name', 1], ['ccn', 1], ['dlmc', 1]]],
  ['csxhjctb_fljgp', [['name', 1], ['ccn', 1], ['dlmc', 1]]],
  ['csxhjctb_gyssa', [['name', 1], ['ccn', 1], ['type', 0.4], ['dlmc', 1]]],
  ['csxhjctb_gyssp', [['name', 1], ['ccn', 1], ['type', 0.96], ['dlmc', 1]]],
  ['csxhjctb_gyylda', [['name', 1], ['ccn', 1], ['dlmc', 1]]],
  ['csxhjctb_hyda', [['name', 0.04], ['ccn', 1]]],
  // 名称有三分之二是 -9999（后端的占位值），标注里不显示
  ['csxhjctb_hydl', [['name', 0.34], ['ccn', 1], ['type', 0.35]]],
  ['csxhjctb_jgtta', [['name', 1], ['dlmc', 1]]],
  ['csxhjctb_jgttp', [['name', 1], ['dlmc', 1]]],
  ['csxhjctb_jtfwcza', [['name', 1], ['ccn', 1], ['type', 0.21], ['dlmc', 1]]],
  ['csxhjctb_jtysyda', [['name', 1], ['ccn', 1], ['type', 0.35], ['dlmc', 1]]],
  ['csxhjctb_jtysydp', [['name', 1], ['type', 1], ['dlmc', 1]]],
  ['csxhjctb_lctl', [['name', 0.74, '道路名称'], ['type', 1, '道路等级'], ['rn', 0.41]]],
  ['csxhjctb_llkl', [['name', 0.03], ['type', 1]]],
  ['csxhjctb_llkp', [['name', 1], ['type', 1]]],
  ['csxhjctb_lrdl', [['names', 0.96, '路线简称'], ['name', 0.3, '路线名称'], ['rn', 0.96], ['type', 1, '行政等级']]],
  ['csxhjctb_lrrl', [['name', 1, '铁路名称'], ['type', 1]]],
  ['csxhjctb_lvll', [['type', 1]]],
  ['csxhjctb_sdza', [['name', 1], ['dlmc', 1]]],
  ['csxhjctb_swhxcbctqtba', [['hxcmc', 1], ['xmc', 1]]],
  ['csxhjctb_swhxcwydctba', [['hxcmc', 1], ['xmc', 1]]],
  ['csxhjctb_syfwya', [['name', 1], ['ccn', 0.99], ['dlmc', 1]]],
  ['csxhjctb_syfwyp', [['name', 1], ['ccn', 1], ['dlmc', 1]]],
  ['csxhjctb_tyhda', [['name', 1], ['dlmc', 1]]],
  ['csxhjctb_tyhdp', [['name', 1], ['dlmc', 1]]],
  ['csxhjctb_whhda', [['name', 1], ['type', 1], ['dlmc', 1]]],
  ['csxhjctb_whhdp', [['name', 1], ['type', 1], ['dlmc', 1]]],
  ['csxhjctb_wycga', [['name', 1], ['type', 1], ['dlmc', 1]]],
  ['csxhjctb_wycgp', [['name', 1], ['type', 1], ['dlmc', 1]]],
  ['csxhjctb_xxa', [['name', 1], ['type', 0.96], ['ccn', 1], ['dlmc', 1]]],
  ['csxhjctb_xxp', [['name', 1], ['type', 0.98], ['ccn', 1], ['dlmc', 1]]],
  ['csxhjctb_xzcsgxgzyda', [['name', 1], ['type', 1]]],
  ['csxhjctb_yjbna', [['name', 1], ['type', 1]]],
  ['csxhjctb_yljga', [['name', 1], ['type', 1], ['ccn', 1], ['grade', 0.73], ['dlmc', 1]]],
  ['csxhjctb_yljgp', [['name', 1], ['type', 1], ['ccn', 1], ['grade', 0.21], ['dlmc', 1]]],
  ['gtkjgh_czkfbj', [['ghfqmc', 1], ['xzqmc', 1]]],
  ['gtkjgh_stbhhx', [['hxmc', 1], ['hxlx', 1], ['zrbhdmc', 0.46], ['xzqmc', 1]]],
  ['lcsh_cdtb', [['dlmc', 1]]],
  ['lcsh_hmtb', [['dlmc', 1]]],
  ['lcsh_sdtb', [['dlmc', 1], ['zldwmc', 1], ['tbbh', 1]]],
  ['lcsh_sltb', [['dlmc', 1], ['zldwmc', 1], ['tbbh', 1]]],
  ['szy_hl_fs', [['hlmc', 0.32], ['xjxzqmc', 1]]],
  ['szy_hl_ks', [['hlmc', 0.32], ['xjxzqmc', 1]]],
  ['szy_hp_fs', [['hpmc', 0.96]]],
  ['szy_hp_ks', [['hpmc', 0.95]]],
  ['szy_sk_fs', [['skmc', 0.9]]],
  ['szy_sk_ks', [['skmc', 0.89]]]
];

const toOption = ([field, share, name]: FieldRow): LabelFieldOption => {
  const known = name ?? FIELD_NAMES[field];
  if (known === undefined) {
    throw new Error(`字段 ${field} 没有叫法`);
  }
  return { field, name: known, share };
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
