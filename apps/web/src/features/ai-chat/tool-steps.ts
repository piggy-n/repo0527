/** 回答过程中调用的工具（查询步骤） */
export interface ToolStep {
  /** 后端的工具名，如 spatial_breakdown */
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly status: 'running' | 'succeeded' | 'failed';
  /** 工具的原始输出，失败时展示 */
  readonly output: string;
}

// 后端工具名对应的步骤名称，不直接展示调试字段（沿用旧项目）
const TOOL_TITLES: Readonly<Record<string, string>> = {
  query_admin_boundary: '查询行政区边界',
  search_admin: '检索行政区划',
  fetch_admin_geojson: '获取行政区空间范围',
  spatial_breakdown: '执行空间分类统计',
  spatial_query: '执行空间查询',
  query_layer: '查询图层数据',
  query_attr: '查询属性数据',
  query_attribute: '查询属性数据',
  query_database: '查询业务数据库',
  generate_chart: '生成统计图表',
  export_excel: '生成 Excel 文件'
};

// 输入里值得展示的字段，最多两项
const INPUT_FIELDS: readonly (readonly [key: string, label: string])[] = [
  ['admin_name', '范围'],
  ['region_name', '范围'],
  ['layer_name', '图层'],
  ['table_name', '数据表'],
  ['layerCode', '图层编码'],
  ['group_field', '统计字段'],
  ['where_clause', '筛选条件'],
  ['conditions', '筛选条件']
];

const INPUT_VALUE_LENGTH = 32;

/**
 * 工具输出是否成功：输出是 LangChain 消息的字符串（如 content='{"success": true, …'），内容可能被截断、不是合法 JSON，
 * 所以沿用旧项目按文本找 success 标记；找不到时算成功
 */
export function outputSucceeded(output: string): boolean {
  const match = /["']?success["']?\s*:\s*(true|false)/i.exec(output);
  return match?.[1]?.toLowerCase() !== 'false';
}

/** 步骤名称：已知的工具用业务名称，未知的把下划线名称转成单词 */
export function stepTitle(name: string): string {
  const known = TOOL_TITLES[name];
  if (known) {
    return known;
  }
  const words = name
    .split(/[_\s-]+/)
    .filter(word => word !== '')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length > 0 ? words.join(' ') : '执行查询步骤';
}

const STATUS_TEXT: Readonly<Record<ToolStep['status'], string>> = {
  running: '进行中',
  succeeded: '已完成',
  failed: '执行失败'
};

export function stepStatusText(step: ToolStep): string {
  return STATUS_TEXT[step.status];
}

function inputText(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > INPUT_VALUE_LENGTH ? `${text.slice(0, INPUT_VALUE_LENGTH)}...` : text;
}

/** 步骤说明：只摘输入里的关键字段，不展示完整入参 */
export function stepDescription(step: ToolStep): string {
  const summary = INPUT_FIELDS.filter(([key]) => {
    const value = step.input[key];
    return value !== undefined && value !== null && value !== '';
  })
    .slice(0, 2)
    .map(([key, label]) => `${label}：${inputText(step.input[key])}`);
  if (summary.length > 0) {
    return summary.join('；');
  }
  return step.status === 'running' ? '正在调用相关空间查询能力。' : '已完成数据获取与结果处理。';
}

// content='...' 包着的 JSON 尽量还原成对象，便于排查；解析不了时保留原文
function parseOutput(output: string): unknown {
  const content = /^content=(['"])([\s\S]*)\1$/.exec(output.trim());
  try {
    return JSON.parse(content?.[2] ?? output);
  } catch {
    return output;
  }
}

/** 失败步骤展示的 JSON：工具名、输入和输出，用于排查查询条件或后端的问题 */
export function stepErrorJson(step: ToolStep): string {
  const output = step.output === '' ? null : parseOutput(step.output);
  return JSON.stringify({ name: step.name, success: false, input: step.input, output }, null, 2);
}

/** 步骤摘要：进行中显示已完成几步，全部结束后显示总数 */
export function stepsSummary(steps: readonly ToolStep[]): string {
  const finished = steps.filter(step => step.status !== 'running').length;
  if (finished < steps.length) {
    return finished > 0 ? `正在查询，已执行${finished}个步骤` : '正在查询...';
  }
  return `查询完成，共执行${steps.length}个步骤`;
}

export function stepsRunning(steps: readonly ToolStep[]): boolean {
  return steps.some(step => step.status === 'running');
}

/** 开始一个步骤，追加在最后 */
export function startStep(
  steps: readonly ToolStep[],
  name: string,
  input: Readonly<Record<string, unknown>>
): ToolStep[] {
  return [...steps, { name, input, status: 'running', output: '' }];
}

/** 结束同名的第一个进行中的步骤；没有开始过的（只收到结束）补在最后 */
export function finishStep(
  steps: readonly ToolStep[],
  name: string,
  output: string,
  success?: boolean
): ToolStep[] {
  const status = (success ?? outputSucceeded(output)) ? 'succeeded' : 'failed';
  const index = steps.findIndex(step => step.name === name && step.status === 'running');
  if (index < 0) {
    return [...steps, { name, input: {}, status, output }];
  }
  return steps.map((step, i) => (i === index ? { ...step, status, output } : step));
}

/** 回答结束时仍在进行中的步骤按完成处理（沿用旧项目） */
export function settleSteps(steps: readonly ToolStep[]): ToolStep[] {
  return steps.map(step => (step.status === 'running' ? { ...step, status: 'succeeded' } : step));
}
