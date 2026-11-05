import type { DataFormat } from '@/shared/data-request/catalog';
import { formatDateTime } from '@/shared/data-request/date-time';
import { PROVINCE_PATH } from '../data-request';

// 自助取数第二步右侧的条件：数据名称和数据需求跟着选中的节点（2026-10-30），其余选项和默认值沿用旧页面 QushuNodeForm

/** 热门词都能搜到节点：前两个进水资源关系图，其余是旧页面的热门词；宽屏下排成一行，去掉了旧页面的"旱地" */
export const HOT_KEYWORDS = ['河流', '湖泊', '耕地', '林地', '草地', '湿地', '居住用地'];

/** 选中的节点：旧版知识图谱和水资源关系图的节点都有编号和名称 */
export interface ExtractionNode {
  id: string;
  name: string;
  /** 数据表的几何类型；分类、旧版知识图谱的节点和没写几何类型的表没有 */
  geometry?: '点' | '线' | '面';
}

/**
 * 选中节点后自动填写的数据名称和数据需求：名称就是节点名称，需求按名称和几何类型写成"XX面图层"；
 * 名称已经以几何类型结尾（如"水域线"）时不再重复，不知道几何类型时是"XX图层"
 */
export function extractionTarget(node: ExtractionNode): { dataName: string; requirement: string } {
  const geometry = node.geometry && !node.name.endsWith(node.geometry) ? node.geometry : '';
  return { dataName: node.name, requirement: `${node.name}${geometry}图层` };
}

export const PURPOSE_MAX_LENGTH = 80;

const ONE_DAY = 24 * 60 * 60 * 1000;

export interface ExtractionForm {
  dataName: string;
  requirement: string;
  regionPath: string[];
  startTime: string;
  endTime: string;
  formats: DataFormat[];
  purpose: string;
}

/** 每次打开的默认条件：数据名称和需求等选了节点再填、全省、现在到明天此时、Excel */
export function createExtractionForm(now = new Date()): ExtractionForm {
  return {
    dataName: '',
    requirement: '',
    regionPath: [...PROVINCE_PATH],
    startTime: formatDateTime(now),
    endTime: formatDateTime(new Date(now.getTime() + ONE_DAY)),
    formats: ['Excel'],
    purpose: ''
  };
}

/** 提交的字段；没有选节点时节点为空，和旧页面一样不强制，数据名称和需求由弹窗的必填校验保证 */
export interface ExtractionRequest {
  nodeId: string;
  nodeName: string;
  dataName: string;
  requirement: string;
  xzqdm: string;
  startTime: string;
  endTime: string;
  formats: DataFormat[];
  purpose: string;
}

/** 提交时的快照：区划取所选路径的最后一级，名称、需求和用途去掉首尾空白 */
export function extractionRequest(form: ExtractionForm, node: ExtractionNode | null): ExtractionRequest {
  return {
    nodeId: node?.id ?? '',
    nodeName: node?.name ?? '',
    dataName: form.dataName.trim(),
    requirement: form.requirement.trim(),
    xzqdm: form.regionPath.at(-1) ?? '',
    startTime: form.startTime,
    endTime: form.endTime,
    formats: [...form.formats],
    purpose: form.purpose.trim()
  };
}
