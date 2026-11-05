// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  dedupeIndicators,
  filterIndicatorTree,
  indicatorGroupCodes,
  type IndicatorLeaf,
  indicatorLeaves,
  type IndicatorTreeNode
} from './indicator-tree';

const leaf = (code: string, name = code): IndicatorLeaf => ({
  kind: 'leaf',
  code,
  dataId: null,
  name,
  disabled: false,
  status: null,
  result: null,
  reason: null
});

const group = (code: string, children: IndicatorTreeNode[]): IndicatorTreeNode => ({
  kind: 'group',
  code,
  name: `分类${code}`,
  children
});

describe('指标树', () => {
  it('同一个指标挂在几个分类下只留第一次出现的，去重后空了的分类（包括重复出现的分类）不显示', () => {
    const tree = [
      group('A', [leaf('A-32'), leaf('B-19')]),
      group('B', [leaf('B-19'), leaf('B-14')]),
      group('A', [leaf('A-32'), leaf('B-19')]),
      group('C', [group('C01', [leaf('B-14')])])
    ];
    expect(dedupeIndicators(tree)).toEqual([group('A', [leaf('A-32'), leaf('B-19')]), group('B', [leaf('B-14')])]);
  });

  it('指标和分类按树的顺序展开', () => {
    const tree = [group('A', [leaf('A-1'), group('A01', [leaf('A01-1')])]), group('B', [leaf('B-1')])];
    expect(indicatorLeaves(tree).map(item => item.code)).toEqual(['A-1', 'A01-1', 'B-1']);
    expect(indicatorGroupCodes(tree)).toEqual(['A', 'A01', 'B']);
  });

  it('搜索保留名称包含关键字的指标和它们的分类，关键字前后的空白不算；空关键字原样返回', () => {
    const tree = [
      group('A', [leaf('A-1', '社区小学步行10分钟覆盖率'), group('A01', [leaf('A01-1', '社区中学覆盖率')])]),
      group('B', [leaf('B-1', '高等学校数量')])
    ];
    expect(filterIndicatorTree(tree, ' 社区 ')).toEqual([
      group('A', [leaf('A-1', '社区小学步行10分钟覆盖率'), group('A01', [leaf('A01-1', '社区中学覆盖率')])])
    ]);
    expect(filterIndicatorTree(tree, '中学')).toEqual([group('A', [group('A01', [leaf('A01-1', '社区中学覆盖率')])])]);
    expect(filterIndicatorTree(tree, '不存在')).toEqual([]);
    expect(filterIndicatorTree(tree, '  ')).toBe(tree);
  });
});
