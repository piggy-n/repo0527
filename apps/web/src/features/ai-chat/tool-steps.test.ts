// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  finishStep,
  outputSucceeded,
  settleSteps,
  startStep,
  stepDescription,
  stepErrorJson,
  stepsSummary,
  stepTitle,
  type ToolStep
} from './tool-steps';

const step = (overrides: Partial<ToolStep> = {}): ToolStep => ({
  name: 'spatial_breakdown',
  input: {},
  status: 'succeeded',
  output: '',
  ...overrides
});

const failedJson = (output: string): unknown => JSON.parse(stepErrorJson(step({ status: 'failed', output })));

describe('outputSucceeded', () => {
  it('按输出文本里的 success 判断，截断的 JSON 也能认出；找不到时算成功', () => {
    expect(outputSucceeded('content=\'{"success": false, "error": "表不存在"')).toBe(false);
    expect(outputSucceeded("content='{'success': True")).toBe(true);
    expect(outputSucceeded('content=\'{"success": true, "groups": [{"val')).toBe(true);
    expect(outputSucceeded('完成')).toBe(true);
  });
});

describe('stepTitle', () => {
  it('已知的工具用业务名称，未知的转成单词，空名称有默认说法', () => {
    expect(stepTitle('spatial_breakdown')).toBe('执行空间分类统计');
    expect(stepTitle('multi_year_compare')).toBe('Multi Year Compare');
    expect(stepTitle('')).toBe('执行查询步骤');
  });
});

describe('stepDescription', () => {
  it('只摘前两个有值的关键字段，过长的截断', () => {
    const input = {
      admin_name: '',
      table_name: 'DLTB_2022',
      group_field: 'DLBM',
      where_clause: '"DLBM" LIKE \'01%\' OR "DLBM" LIKE \'02%\' OR "DLBM" LIKE \'03%\''
    };

    expect(stepDescription(step({ input }))).toBe('数据表：DLTB_2022；统计字段：DLBM');
    expect(stepDescription(step({ input: { where_clause: input.where_clause } }))).toBe(
      '筛选条件："DLBM" LIKE \'01%\' OR "DLBM" LIKE...'
    );
  });

  it('没有关键字段时按状态给出说明', () => {
    expect(stepDescription(step({ status: 'running' }))).toBe('正在调用相关空间查询能力。');
    expect(stepDescription(step())).toBe('已完成数据获取与结果处理。');
  });
});

describe('stepErrorJson', () => {
  it('content 包着的 JSON 还原成对象，解析不了时保留原文', () => {
    const parsed = failedJson('content=\'{"success": false}\'');
    const raw = failedJson('content=\'{"success": fal');

    expect(parsed).toEqual({ name: 'spatial_breakdown', success: false, input: {}, output: { success: false } });
    expect(raw).toMatchObject({ output: 'content=\'{"success": fal' });
  });
});

describe('步骤的状态', () => {
  it('结束同名的第一个进行中的步骤；没开始过的补在最后', () => {
    let steps = startStep([], 'search_admin', { admin_name: '南京市' });
    steps = startStep(steps, 'search_admin', {});

    steps = finishStep(steps, 'search_admin', 'content=\'{"success": false}\'');
    steps = finishStep(steps, 'export_excel', '', true);

    expect(steps.map(({ name, status }) => [name, status])).toEqual([
      ['search_admin', 'failed'],
      ['search_admin', 'running'],
      ['export_excel', 'succeeded']
    ]);
    expect(steps[0]?.input).toEqual({ admin_name: '南京市' });
  });

  it('事件里明确给出的成败优先于输出', () => {
    const steps = finishStep(startStep([], 'query_layer', {}), 'query_layer', '"success": true', false);

    expect(steps[0]?.status).toBe('failed');
  });

  it('摘要：进行中显示已完成几步，结束后显示总数；结束时进行中的按完成处理', () => {
    const steps = [step(), step({ status: 'running' })];

    expect(stepsSummary([step({ status: 'running' })])).toBe('正在查询...');
    expect(stepsSummary(steps)).toBe('正在查询，已执行1个步骤');
    expect(stepsSummary(settleSteps(steps))).toBe('查询完成，共执行2个步骤');
  });
});
