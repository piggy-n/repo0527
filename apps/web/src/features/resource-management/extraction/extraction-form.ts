import { DATA_LAYERS, type DataFormat } from '@/shared/data-request/catalog';
import { formatDateTime } from '@/shared/data-request/date-time';
import { PROVINCE_PATH } from '../data-request';

// 自助取数第二步右侧的条件，选项和默认值沿用旧页面 QushuNodeForm

/** 热门词都能搜到节点：前两个进水资源关系图，其余是旧页面的热门词 */
export const HOT_KEYWORDS = ['河流', '湖泊', '耕地', '林地', '草地', '湿地', '居住用地', '旱地'];

/** 提交时记下的节点：旧版知识图谱和水资源关系图的节点都有编号和名称 */
export interface ExtractionNode {
  id: string;
  name: string;
}

export const DATA_NAMES = ['地类图斑', '耕地后备资源调查评价', '城镇村等用地', '永久基本农田'];

export const PURPOSE_MAX_LENGTH = 80;

const ONE_DAY = 24 * 60 * 60 * 1000;

export interface ExtractionForm {
  dataName: string;
  layerCode: string;
  regionPath: string[];
  startTime: string;
  endTime: string;
  formats: DataFormat[];
  purpose: string;
}

/** 每次打开的默认条件：地类图斑、学校点层、全省、现在到明天此时、Excel */
export function createExtractionForm(now = new Date()): ExtractionForm {
  return {
    dataName: DATA_NAMES[0],
    layerCode: DATA_LAYERS[0].value,
    regionPath: [...PROVINCE_PATH],
    startTime: formatDateTime(now),
    endTime: formatDateTime(new Date(now.getTime() + ONE_DAY)),
    formats: ['Excel'],
    purpose: ''
  };
}

/** 旧页面提交的字段；没有选节点时节点为空，和旧页面一样不强制 */
export interface ExtractionRequest {
  nodeId: string;
  nodeName: string;
  dataName: string;
  layerCode: string;
  xzqdm: string;
  startTime: string;
  endTime: string;
  formats: DataFormat[];
  purpose: string;
}

/** 提交时的快照：区划取所选路径的最后一级，用途去掉首尾空白 */
export function extractionRequest(form: ExtractionForm, node: ExtractionNode | null): ExtractionRequest {
  return {
    nodeId: node?.id ?? '',
    nodeName: node?.name ?? '',
    dataName: form.dataName,
    layerCode: form.layerCode,
    xzqdm: form.regionPath.at(-1) ?? '',
    startTime: form.startTime,
    endTime: form.endTime,
    formats: [...form.formats],
    purpose: form.purpose.trim()
  };
}
