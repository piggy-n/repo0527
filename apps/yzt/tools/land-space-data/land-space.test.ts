// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildLandSpaceFile } from './land-space.ts';
import type { Cell, Workbook } from './xlsx.ts';

const DICTIONARY_HEADERS = ['编码', '一级分类', '二级分类', '指标名称', '指标类型', '单位'];
const VALUE_HEADERS = ['编码', '地区', '年份／期间', '数据类型', '分项', '数值', '单位'];
const CITIES = [{ code: '320100', name: '南京市' }];

// 只有文字单元格的工作簿：每张表第 1 行是表头，下面是数据行
function workbook(sheets: Readonly<Record<string, readonly (readonly string[])[]>>): Workbook {
  return {
    sheetNames: Object.keys(sheets),
    sheet(name) {
      const rows = sheets[name] ?? [];
      return new Map(rows.map((row, index) => [
        index + 1,
        new Map(row.map((value, column): [number, Cell] => [column + 1, { value, format: 'General' }]))
      ]));
    }
  };
}

function dictionary(...rows: (readonly string[])[]) {
  return workbook({ 指标字典: [DICTIONARY_HEADERS, ...rows], 指标数值: [VALUE_HEADERS] });
}

const DOMAIN = ['I01', '生活宜居便利性', '', '生活宜居便利性指数', '一级指数', '无量纲'];
const SUB = ['I02', '生活宜居便利性', '教育便利性', '教育设施便利性指数', '二级指数', '无量纲'];

describe('综合分析驾驶舱数据的层级', () => {
  it('二级下面是同一一级、同一二级分类的单一指标', () => {
    const book = dictionary(DOMAIN, SUB, ['M01', '生活宜居便利性', '教育便利性', '幼儿园步行5分钟覆盖率', '单一指标', '%']);
    const file = buildLandSpaceFile(book, '指标汇总.xlsx', CITIES);
    const [domain] = file.domains;
    expect(domain?.subIndices.map(sub => [sub.name, sub.indicators.map(indicator => indicator.id)])).toEqual([
      ['教育便利性', ['M01']]
    ]);
  });

  it('二级下面没有单一指标时报错，不生成页面选不了三级的数据', () => {
    expect(() => buildLandSpaceFile(dictionary(DOMAIN, SUB), '指标汇总.xlsx', CITIES)).toThrow(
      '二级「教育便利性」下没有单一指标'
    );
  });
});
