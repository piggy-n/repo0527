import {
  assessFields,
  coverageOf,
  type FieldAssessment,
  mergeSamples,
  missingZooms,
  type SampleStats,
  withUnseenValues
} from './analyze.ts';
import type { ProbeResult, ResourceInfo, TilesetProbe } from './probe.ts';

// 把探查结果整理成给人看的表：候选（业务确认用）、切片要求（交给切片的同事）、概览

// 样式登记表现有规则用的字段（style-registry.ts），测试保证一致
export const CURRENT_RULE_FIELDS: Readonly<Record<string, string>> = {
  bgdc_dltb: 'dlbm',
  bgdc_dltb_czc: 'dlmc',
  bgdc_czcdyd: 'czclx',
  bgdc_gddb: 'lyd',
  bgdc_pzwjstd: 'ywlx',
  bgdc_xzqjx: 'jxlx',
  bgdc_cjdcqjx: 'jxlx',
  bgdc_yjjbnttb: 'dlmc',
  lcsh_sltb: 'lin_zhong',
  lcsh_cdtb: 'dlbm',
  lcsh_sdtb: 'dlbm',
  lcsh_hmtb: 'tu_rang_lx',
  gtkjgh_czkfbj: 'ghfqdm',
  gtkjgh_stbhhx: 'hxlx',
  gtkjgh_gdbhmb: 'dlbm',
  gtkjgh_yjjbntbhtb: 'dlbm',
  szy_hl_fs: 'hldj',
  szy_hl_ks: 'hldj',
  szy_sk_fs: 'skdb',
  szy_sk_ks: 'skdb',
  szy_hp_fs: 'lymc',
  szy_hp_ks: 'lymc',
  szy_kt: 'lymc',
  csxhjctb_xxa: 'cc',
  csxhjctb_xxp: 'cc',
  csxhjctb_yljga: 'cc',
  csxhjctb_yljgp: 'cc',
  csxhjctb_fljga: 'cc',
  csxhjctb_fljgp: 'cc',
  csxhjctb_gyssa: 'cc',
  csxhjctb_gyssp: 'cc',
  csxhjctb_gyylda: 'cc',
  csxhjctb_jtfwcza: 'cc',
  csxhjctb_jtysyda: 'cc',
  csxhjctb_syfwya: 'cc',
  csxhjctb_syfwyp: 'cc',
  csxhjctb_czzza: 'cc',
  csxhjctb_jtysydp: 'type',
  csxhjctb_xzcsgxgzyda: 'type',
  csxhjctb_yjbna: 'type',
  csxhjctb_lvll: 'type',
  csxhjctb_lrdl: 'type',
  csxhjctb_lctl: 'type',
  csxhjctb_llkl: 'type',
  csxhjctb_llkp: 'type',
  csxhjctb_lrrl: 'type',
  csxhjctb_wycga: 'type',
  csxhjctb_wycgp: 'type',
  csxhjctb_bzssa: 'type',
  csxhjctb_hydl: 'ccn',
  csxhjctb_hyda: 'ccn'
};

export type ResourceStatus =
  /** 已经按属性配色 */
  | 'has-rule'
  /** 有建议的分类字段 */
  | 'candidate'
  /** 有备选字段，评分不够，要人判断 */
  | 'possible'
  /** 没有合适的字段，保持统一样式 */
  | 'uniform'
  /** 瓦片报错，也没有属性 */
  | 'no-tiles'
  /** 接口正常但没取到数据 */
  | 'no-data';

export const STATUS_LABELS: Readonly<Record<ResourceStatus, string>> = {
  'has-rule': '已有分类规则',
  candidate: '有建议的分类字段',
  possible: '只有备选字段，待判断',
  uniform: '没有合适的字段，保持统一样式',
  'no-tiles': '瓦片报错，暂时判断不了',
  'no-data': '没有取到数据'
};

export interface ResourceSummary {
  readonly resource: ResourceInfo;
  readonly status: ResourceStatus;
  readonly currentField: string | null;
  /** 建议的分类字段：已有规则时是规则用的字段 */
  readonly primary: FieldAssessment | null;
  /** 除被否决以外的字段，从高分到低分 */
  readonly candidates: readonly FieldAssessment[];
  /** 全部字段，包括被否决的和原因 */
  readonly assessed: readonly FieldAssessment[];
  readonly latest: TilesetProbe | null;
  readonly probes: readonly TilesetProbe[];
}

function hasData(probe: TilesetProbe): boolean {
  return probe.attributes.sampled > 0 || probe.tiles.some(tile => tile.features > 0);
}

/** 用来评估的统计：属性表的字段最全，再加上瓦片里才见到的取值；查不了属性的用瓦片 */
export function statsOf(probe: TilesetProbe): SampleStats {
  const tiles = probe.tiles.map(tile => tile.stats);
  return probe.attributes.sampled > 0 ? withUnseenValues(probe.attributes.stats, tiles) : mergeSamples(tiles);
}

function missingCount(probe: TilesetProbe, field: string): number {
  return missingZooms(probe.tiles, field).length;
}

// 建议的字段是评分最高的候选；同一对编码和名称，优先瓦片里保留得全的那个（不用重新切片），一样全时用编码
function bestField(assessed: readonly FieldAssessment[], probe: TilesetProbe): FieldAssessment | null {
  const best = assessed.find(item => item.verdict !== 'rejected');
  if (!best) {
    return null;
  }
  const label = assessed.find(item => item.field === best.labelField);
  if (label && label.verdict !== 'rejected' && missingCount(probe, label.field) < missingCount(probe, best.field)) {
    return label;
  }
  return best;
}

/** 汇总一个资源：用最新一年有数据的瓦片集评估 */
export function summarizeResource(resource: ResourceInfo, allProbes: readonly TilesetProbe[]): ResourceSummary {
  const probes = allProbes.filter(probe => probe.code === resource.code).toSorted((a, b) => a.year - b.year);
  const latest = probes.findLast(hasData) ?? null;
  const currentField = CURRENT_RULE_FIELDS[resource.code] ?? null;
  const base = { resource, currentField, probes, latest };
  if (!latest) {
    const failed = probes.some(probe => probe.tiles.some(tile => tile.errors.length > 0));
    return { ...base, status: failed ? 'no-tiles' : 'no-data', primary: null, candidates: [], assessed: [] };
  }
  const assessed = assessFields(statsOf(latest), latest.labels, resource.code);
  const candidates = assessed.filter(item => item.verdict !== 'rejected');
  const current = assessed.find(item => item.field === currentField) ?? null;
  const [top] = candidates;
  if (currentField) {
    return { ...base, status: 'has-rule', primary: current, candidates, assessed };
  }
  if (!top) {
    return { ...base, status: 'uniform', primary: null, candidates, assessed };
  }
  const primary = bestField(assessed, latest);
  return { ...base, status: top.verdict === 'recommended' ? 'candidate' : 'possible', primary, candidates, assessed };
}

/** 要查准确分布的字段，从重要到次要：现有规则的字段、建议的字段、其他候选 */
export function exactFieldsOf(probe: TilesetProbe): string[] {
  const assessed = assessFields(statsOf(probe), probe.labels, probe.code);
  const candidates = assessed.filter(item => item.verdict !== 'rejected').map(item => item.field);
  const first = [CURRENT_RULE_FIELDS[probe.code], bestField(assessed, probe)?.field];
  return [...new Set([...first.filter(field => field !== undefined), ...candidates])];
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function zoomCoverage(probe: TilesetProbe, field: string): string {
  return probe.tiles
    .map(({ zoom, stats }) => {
      const coverage = coverageOf(stats, field);
      return `z${zoom}:${coverage === null ? '无要素' : percent(coverage)}`;
    })
    .join(' ');
}

// 同一资源其他年份的差异：字段缺失、取值不同。分类规则按 code，不分年份，这些要人看一下
function yearDrift(summary: ResourceSummary, field: string): string {
  const { latest, probes, resource } = summary;
  const latestValues = new Set(Object.keys(latest ? (statsOf(latest).fields[field]?.values ?? {}) : {}));
  const notes = probes.filter(hasData).flatMap(probe => {
    if (probe === latest) {
      return [];
    }
    const stats = statsOf(probe).fields[field];
    if (!stats) {
      return [`${probe.year} 年没有这个字段`];
    }
    const extra = Object.keys(stats.values).filter(value => !latestValues.has(value));
    return extra.length > 0 ? [`${probe.year} 年多出 ${extra.slice(0, 5).join('、')}${extra.length > 5 ? ' 等' : ''}`] : [];
  });
  const probed = new Set(probes.map(probe => probe.year));
  const unprobed = resource.years.filter(year => !probed.has(year));
  if (unprobed.length > 0) {
    notes.push(`${unprobed.join('、')} 年未探查`);
  }
  return notes.join('；');
}

// 取值分布：有名称字段时写"值 名称"，有准确分布时用准确数字
function valuesText(item: FieldAssessment, summary: ResourceSummary, limit: number): string {
  const labels = summary.latest?.labels[item.field]?.labels ?? {};
  const exact = summary.latest?.exact?.[item.field];
  const counts = exact ? Object.entries(exact.counts).toSorted((a, b) => b[1] - a[1]) : item.values;
  const shown = counts.slice(0, limit).map(([value, count]) => {
    const label = labels[value];
    const times = !exact && count === 0 ? '抽样外，瓦片里有' : count;
    return `${label ? `${value} ${label}` : value}（${times}）`;
  });
  const hidden = counts.length > limit ? ` …共 ${counts.length} 个` : '';
  const other = exact && exact.other > 0 ? `；其余 ${exact.other} 条（空值或样本外的取值）` : '';
  return `${shown.join('、')}${hidden}${other}`;
}

const CANDIDATE_HEADER = [
  '目录',
  '资源',
  'code',
  '几何',
  '年份',
  '结论',
  '字段',
  '是否建议',
  '评分',
  '名称字段',
  '取值数',
  '填写率',
  '最大占比',
  '瓦片里带这个字段的比例',
  '取值（次数）',
  '说明',
  '其他年份的差异',
  '分布来源',
  '【确认】是否采用',
  '【确认】备注'
];

/** 候选表：每个资源的每个候选字段一行；没有候选的资源一行，字段留空 */
export function candidateRows(summaries: readonly ResourceSummary[]): string[][] {
  const rows = summaries.flatMap(summary => {
    const { resource, status, primary, candidates, latest } = summary;
    const common = [
      resource.category,
      resource.name,
      resource.code,
      resource.geoType,
      resource.years.join('、'),
      STATUS_LABELS[status]
    ];
    if (candidates.length === 0 || !latest) {
      return [[...common, '', '', '', '', '', '', '', '', '', '', '', '', '', '']];
    }
    const ordered = primary ? [primary, ...candidates.filter(item => item.field !== primary.field)] : candidates;
    // 评分最高的不是建议的字段时，说明原因：它在瓦片里保留得不全
    const [top] = candidates;
    const switched = primary && top && primary.field !== top.field && status !== 'has-rule' ? top.field : null;
    const notesOf = ({ field, reasons }: FieldAssessment) =>
      field === primary?.field && switched ? [...reasons, `瓦片里比 ${switched} 保留得全，不用重新切片`] : reasons;
    return ordered.map(item =>
      common.concat([
        item.field,
        item === primary ? '建议' : '备选',
        String(item.score),
        item.labelField ?? '',
        String(item.distinct),
        percent(item.fillRate),
        percent(item.topShare),
        zoomCoverage(latest, item.field),
        valuesText(item, summary, 15),
        notesOf(item).join('；'),
        yearDrift(summary, item.field),
        latest.exact?.[item.field] ? '准确' : `抽样 ${latest.attributes.sampled || '瓦片'}`,
        '',
        ''
      ])
    );
  });
  return [CANDIDATE_HEADER, ...rows];
}

const SLICING_HEADER = [
  '瓦片集',
  '瓦片内的图层名',
  '资源',
  '字段',
  '用途',
  '瓦片里带这个字段的比例',
  '属性表里有这个字段',
  '要处理',
  '说明'
];

function slicingNotes(probe: TilesetProbe, field: string): string[] {
  const notes: string[] = [];
  const missing = missingZooms(probe.tiles, field);
  if (missing.length > 0) {
    notes.push(`z${missing.join('、z')} 缺这个字段`);
  }
  const stats = mergeSamples(probe.tiles.map(tile => tile.stats)).fields[field];
  if (stats && Object.keys(stats.types).length > 1) {
    notes.push(`字符串和数字混用（${Object.keys(stats.types).join('、')}），要统一成字符串`);
  }
  if (stats && stats.names.length > 1) {
    notes.push(`字段名大小写不统一（${stats.names.join('、')}）`);
  }
  for (const tile of probe.tiles) {
    if (tile.clustered > 0) {
      notes.push(`z${tile.zoom} 有 ${percent(tile.clustered / tile.features)} 是聚合要素：只按相同分类聚合，否则颜色只代表其中一个要素`);
    }
    if (tile.errors[0]) {
      notes.push(`z${tile.zoom} 瓦片报错：${tile.errors[0]}`);
    }
  }
  return [...new Set(notes)];
}

/** 切片要求：每个瓦片集、每个要保留的字段一行（分类字段和它的名称字段）；不合适的资源不列 */
export function slicingRows(summaries: readonly ResourceSummary[]): string[][] {
  const rows = summaries.flatMap(summary => {
    const { resource, primary, status, probes } = summary;
    if (!primary || status === 'uniform' || status === 'possible') {
      return [];
    }
    const fields: (readonly [field: string, role: string])[] = [
      [primary.field, '分类字段，所有级别都要保留'],
      ...(primary.labelField ? [[primary.labelField, '显示名称，可以只在 14 级以上保留'] as const] : [])
    ];
    return probes.flatMap(probe =>
      fields.map(([field, role]) => {
        const notes = role.startsWith('分类') ? slicingNotes(probe, field) : [];
        const layers = probe.tiles.flatMap(tile => tile.sourceLayers);
        const inTable = probe.attributes.stats.fields[field] !== undefined;
        return [
          probe.tileset,
          [...new Set(layers)].join('、'),
          resource.name,
          field,
          role,
          zoomCoverage(probe, field),
          probe.attributes.sampled === 0 ? '未知' : inTable ? '有' : '没有，要确认数据',
          notes.length > 0 ? '是' : '否',
          notes.join('；')
        ];
      })
    );
  });
  return [SLICING_HEADER, ...rows];
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** CSV：带 BOM，Excel 能正确识别中文 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return `﻿${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** 概览（Markdown） */
export function formatSummary(result: ProbeResult, summaries: readonly ResourceSummary[]): string {
  const lines = ['# 资源分类探查概览', ''];
  const tilesets = result.probes.length;
  lines.push(`${summaries.length} 个资源、${tilesets} 个瓦片集；网络失败 ${result.failures.length} 个。`, '');
  lines.push('| 结论 | 资源数 | 资源 |', '|---|---|---|');
  for (const status of Object.keys(STATUS_LABELS) as ResourceStatus[]) {
    const matched = summaries.filter(summary => summary.status === status);
    if (matched.length > 0) {
      const names = matched.map(({ resource, primary }) =>
        primary ? `${resource.name}（${primary.field}）` : resource.name
      );
      lines.push(`| ${STATUS_LABELS[status]} | ${matched.length} | ${names.join('、')} |`);
    }
  }
  const errors = result.probes.flatMap(({ tileset, tiles, attributes }) => {
    const message = tiles.find(tile => tile.errors.length > 0)?.errors[0];
    const tileError = message ? [`- ${tileset} 瓦片：${message}`] : [];
    return attributes.error ? tileError.concat(`- ${tileset} 属性：${attributes.error}`) : tileError;
  });
  if (errors.length > 0) {
    lines.push('', '## 接口报错（要告诉后端）', '', ...errors);
  }
  if (result.failures.length > 0) {
    lines.push('', '## 网络失败（再运行一次会重试）', '');
    lines.push(...result.failures.map(({ tileset, message }) => `- ${tileset}：${message}`));
  }
  lines.push('', '## 怎样使用', '');
  lines.push('1. 打开 `candidates.csv`，在最后两列确认每个资源是否采用、用哪个字段');
  lines.push('2. 把 `slicing-requirements.csv` 里要处理的行交给切片的同事');
  lines.push('3. 切片调整后再运行一次（加 `--refresh`），确认字段都保留了');
  lines.push('', '分布来自抽样（不是随机抽样），只有加 `--exact` 的结果才是准确的。');
  return `${lines.join('\n')}\n`;
}
