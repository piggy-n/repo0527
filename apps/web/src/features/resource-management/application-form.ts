import type { DataApplication, ResourceRecord } from './api';
import { DATA_FORMATS, DATA_LAYERS, type DataFormat, formatDateTime, PROVINCE_PATH } from './data-request';

// 资源列表"下载"打开的数据申请，字段和规则沿用旧页面 ResourceApplyDialog

export const APPLY_NAME_MAX_LENGTH = 100;
export const APPLY_PURPOSE_MAX_LENGTH = 80;

// 接收申请的处室：旧页面对管理员隐藏这一项但仍发送默认值；资源管理只有管理员能进
const RECEIVER_DEPARTMENT = 'jsdxzx';

// 学校的两层可以导出全部格式，其余图层只有 Excel、SHP、GDB
const SCHOOL_LAYERS = new Set(['csxhjctb_xxp_2022', 'csxhjctb_xxa_2022']);
const COMMON_FORMATS: readonly DataFormat[] = ['Excel', 'SHP', 'GDB'];

export interface ApplicationForm {
  applyName: string;
  layerCode: string;
  regionPath: string[];
  startTime: string;
  endTime: string;
  formats: DataFormat[];
  purpose: string;
}

/** 图层可以申请的数据格式 */
export function formatsForLayer(layerCode: string): readonly DataFormat[] {
  return SCHOOL_LAYERS.has(layerCode) ? DATA_FORMATS : COMMON_FORMATS;
}

/**
 * 资源对应的可申请图层：旧页面把"数据集代码_图层代码_年份"拼成小写去匹配。
 * 对不上时留空、由用户选择（2026-10-27 确认），不像旧页面那样悄悄换成学校点层
 */
export function matchDataLayer(row: ResourceRecord): string {
  const code = [row.datasetCode, row.layerCode, row.year].filter(Boolean).join('_').toLowerCase();
  return DATA_LAYERS.some(layer => layer.value === code) ? code : '';
}

/** 打开时的默认值：数据名称取资源名称，时间从现在到一个月后（旧代码的本意，2026-10-27 确认），格式不预选 */
export function createApplicationForm(row: ResourceRecord, now = new Date()): ApplicationForm {
  const end = new Date(now);
  end.setMonth(end.getMonth() + 1);
  return {
    applyName: row.name,
    layerCode: matchDataLayer(row),
    regionPath: [...PROVINCE_PATH],
    startTime: formatDateTime(now),
    endTime: formatDateTime(end),
    formats: [],
    purpose: ''
  };
}

/** 提交的正文：区划取路径的最后一级，格式转成小写逗号串，名称和用途去掉首尾空白 */
export function applicationRequest(form: ApplicationForm): DataApplication {
  return {
    applyName: form.applyName.trim(),
    receiverDeptCode: RECEIVER_DEPARTMENT,
    layerCode: form.layerCode,
    startDate: form.startTime,
    endDate: form.endTime,
    xzqdm: form.regionPath.at(-1) ?? '',
    dataFormats: form.formats.map(format => format.toLowerCase()).join(','),
    applyPurpose: form.purpose.trim()
  };
}
