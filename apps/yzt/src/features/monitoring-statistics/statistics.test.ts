// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  baseYearFor,
  CALCULABLE,
  createTaskPayload,
  defaultBaseYears,
  defaultYear,
  firstWithResult,
  hasProcessing,
  isBaseYearValid,
  levelLabel,
  mergeOverview,
  overviewMatrix,
  tableLevelKey,
  taskStatusOf
} from './statistics';

describe('报表配置', () => {
  it('默认年份是上一年，两个本底年份默认是监测年份的上一年，要早于监测年份', () => {
    expect(defaultYear(new Date(2026, 9, 28))).toBe('2025');
    expect(defaultBaseYears('2025')).toEqual({ change: '2024', water: '2024' });
    expect(['2024', '2025', '2026'].map(baseYear => isBaseYearValid('2025', baseYear))).toEqual([true, false, false]);
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

  it('六种报表都能计算：汇总统计只有省、市两级，水路网报表是省、市、区县三级', () => {
    expect(CALCULABLE.map(tableLevelKey)).toEqual([
      'baseTable:province',
      'baseTable:city',
      'baseTable:district',
      'baseTable:county',
      'summaryTable:province',
      'summaryTable:city',
      'baseChangeTable:province',
      'baseChangeTable:city',
      'baseChangeTable:district',
      'baseChangeTable:county',
      'baseWaterTable:province',
      'baseWaterTable:city',
      'baseWaterTable:district',
      'changeWaterTable:province',
      'changeWaterTable:city',
      'changeWaterTable:district',
      'entityChangeTable:province',
      'entityChangeTable:city',
      'entityChangeTable:district',
      'entityChangeTable:county'
    ]);
  });

  it('变化类报表各用自己的本底年份：基本变化、实体变化用变更本底，水路网变化用水路本底', () => {
    const baseYears = { change: '2023', water: '2024' };
    const tables = ['baseTable', 'baseChangeTable', 'entityChangeTable', 'baseWaterTable', 'changeWaterTable'] as const;
    expect(tables.map(table => baseYearFor(table, baseYears))).toEqual([null, '2023', '2023', null, '2024']);
  });

  it('水路网报表的区级叫"区县级"，其他报表照旧', () => {
    expect(levelLabel('district', 'baseWaterTable')).toBe('区县级');
    expect(levelLabel('district', 'changeWaterTable')).toBe('区县级');
    expect(levelLabel('district', 'baseChangeTable')).toBe('区级');
    expect(levelLabel('county')).toBe('县级');
  });
});

describe('总览矩阵', () => {
  const statuses = new Map<string, string | null>([
    ['baseTable:province', '处理失败'],
    ['baseTable:city', '未处理'],
    ['baseTable:district', null],
    ['summaryTable:city', '正在处理'],
    ['baseWaterTable:district', '处理成功']
  ]);

  it('汇总统计没有区、县级，水路网的区县级占两列，没有任务按未处理显示', () => {
    const rows = overviewMatrix(statuses);
    expect(rows.map(row => row.table)).toEqual([
      'baseTable',
      'summaryTable',
      'baseChangeTable',
      'baseWaterTable',
      'changeWaterTable',
      'entityChangeTable'
    ]);
    expect(rows[0]?.cells).toEqual([
      { kind: 'failed', level: 'province', text: '处理失败', merged: false },
      { kind: 'notStarted', level: 'city', text: '未处理', merged: false },
      { kind: 'notStarted', level: 'district', text: '未处理', merged: false },
      { kind: 'notStarted', level: 'county', text: '未处理', merged: false }
    ]);
    expect(rows[1]?.cells.map(cell => cell.kind)).toEqual(['notStarted', 'processing', 'unsupported', 'unsupported']);
    expect(rows[3]?.cells).toEqual([
      { kind: 'notStarted', level: 'province', text: '未处理', merged: false },
      { kind: 'notStarted', level: 'city', text: '未处理', merged: false },
      { kind: 'completed', level: 'district', text: '处理成功', merged: true }
    ]);
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

  it('两个本底年份不同时，变化类报表取自己本底年份的那一份，其余报表取第一份', () => {
    const of2023 = new Map([
      ['baseTable:province', '处理成功'],
      ['baseChangeTable:province', '处理失败'],
      ['changeWaterTable:province', '处理失败']
    ]);
    const of2024 = new Map([
      ['baseTable:province', '未处理'],
      ['baseChangeTable:province', '正在处理'],
      ['changeWaterTable:province', '处理成功']
    ]);
    const merged = mergeOverview(
      new Map([
        ['2023', of2023],
        ['2024', of2024]
      ]),
      { change: '2023', water: '2024' }
    );
    expect([
      merged.get('baseTable:province'),
      merged.get('baseChangeTable:province'),
      merged.get('changeWaterTable:province'),
      merged.get('entityChangeTable:county')
    ]).toEqual(['处理成功', '处理失败', '处理成功', null]);
  });
});

describe('创建任务的请求体', () => {
  it('每个勾选了等级的报表一项；变化类报表带各自的本底年份，水路网的区县级按 isDistrict 传', () => {
    expect(
      createTaskPayload('2025', { change: '2023', water: '2024' }, [
        { table: 'baseTable', level: 'province' },
        { table: 'baseTable', level: 'county' },
        { table: 'summaryTable', level: 'city' },
        { table: 'baseChangeTable', level: 'city' },
        { table: 'baseWaterTable', level: 'district' },
        { table: 'changeWaterTable', level: 'district' },
        { table: 'entityChangeTable', level: 'county' }
      ])
    ).toEqual({
      year: '2025',
      baseTableParam: { year: '2025', isProvince: true, isCity: false, isDistrict: false, isCounty: true },
      summaryTableParam: { year: '2025', isProvince: false, isCity: true, isDistrict: false, isCounty: false },
      baseChangeTableParam: {
        year: '2025',
        bdYear: '2023',
        isProvince: false,
        isCity: true,
        isDistrict: false,
        isCounty: false
      },
      baseWaterTableParam: { year: '2025', isProvince: false, isCity: false, isDistrict: true, isCounty: false },
      changeWaterTableParam: {
        year: '2025',
        bdYear: '2024',
        isProvince: false,
        isCity: false,
        isDistrict: true,
        isCounty: false
      },
      entityChangeTableParam: {
        year: '2025',
        bdYear: '2023',
        isProvince: false,
        isCity: false,
        isDistrict: false,
        isCounty: true
      }
    });
  });
});
