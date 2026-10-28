// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  CALCULABLE,
  createTaskPayload,
  defaultYear,
  firstWithResult,
  hasProcessing,
  overviewMatrix,
  tableLevelKey,
  taskStatusOf
} from './statistics';

describe('报表配置', () => {
  it('默认年份是上一年', () => {
    expect(defaultYear(new Date(2026, 9, 28))).toBe('2025');
  });

  it('按后端的状态文字判断，没有状态和认不出的算未处理', () => {
    expect(taskStatusOf('处理成功')).toBe('completed');
    expect(taskStatusOf('处理完成')).toBe('completed');
    expect(taskStatusOf('正在处理')).toBe('processing');
    expect(taskStatusOf('正在处理中')).toBe('processing');
    expect(taskStatusOf('处理失败')).toBe('failed');
    expect(taskStatusOf('未处理')).toBe('notStarted');
    expect(taskStatusOf(null)).toBe('notStarted');
  });

  it('可以计算的是基本统计四级和汇总统计省、市两级', () => {
    expect(CALCULABLE.map(tableLevelKey)).toEqual([
      'baseTable:province',
      'baseTable:city',
      'baseTable:district',
      'baseTable:county',
      'summaryTable:province',
      'summaryTable:city'
    ]);
  });
});

describe('总览矩阵', () => {
  const statuses = new Map<string, string | null>([
    ['baseTable:province', '处理失败'],
    ['baseTable:city', '未处理'],
    ['baseTable:district', null],
    ['summaryTable:city', '正在处理']
  ]);

  it('暂未开放的报表整行禁用，汇总统计没有区、县级，没有任务按未处理显示', () => {
    const rows = overviewMatrix(statuses);
    expect(rows.map(row => row.table)).toEqual([
      'baseTable',
      'summaryTable',
      'changeTable',
      'waterBaseTable',
      'waterChangeTable',
      'entityChangeTable'
    ]);
    expect(rows[0]?.cells).toEqual([
      { kind: 'failed', level: 'province', text: '处理失败' },
      { kind: 'notStarted', level: 'city', text: '未处理' },
      { kind: 'notStarted', level: 'district', text: '未处理' },
      { kind: 'notStarted', level: 'county', text: '未处理' }
    ]);
    expect(rows[1]?.cells.map(cell => cell.kind)).toEqual(['notStarted', 'processing', 'unsupported', 'unsupported']);
    expect(rows[2]).toMatchObject({ disabled: true, cells: [{ kind: 'disabled' }, {}, {}, {}] });
  });

  it('有处理中的组合要跟进；初次进入落到第一个有结果的组合', () => {
    const rows = overviewMatrix(statuses);
    expect(hasProcessing(rows)).toBe(true);
    expect(firstWithResult(rows)).toEqual({ table: 'baseTable', level: 'province' });

    const quiet = overviewMatrix(new Map([['summaryTable:city', '处理成功']]));
    expect(hasProcessing(quiet)).toBe(false);
    expect(firstWithResult(quiet)).toEqual({ table: 'summaryTable', level: 'city' });
    expect(firstWithResult(overviewMatrix(null))).toBeNull();
  });
});

describe('创建任务的请求体', () => {
  it('每个勾选了等级的报表一项，字段名沿用旧接口', () => {
    expect(
      createTaskPayload('2025', [
        { table: 'baseTable', level: 'province' },
        { table: 'baseTable', level: 'county' },
        { table: 'summaryTable', level: 'city' }
      ])
    ).toEqual({
      year: '2025',
      baseTableParam: { year: '2025', isProvince: true, isCity: false, isDistrict: false, isCounty: true },
      summaryTableParam: { year: '2025', isProvince: false, isCity: true, isDistrict: false, isCounty: false }
    });
  });
});
