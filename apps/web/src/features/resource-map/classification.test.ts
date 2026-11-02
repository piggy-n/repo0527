// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classExpression, classItems, type ColorRule, legacyItem, OTHER_ITEM, symbolClasses } from './classification';
import { LANDUSE_FALLBACK_COLOR } from './landuse';
import { colorOf, normalizeColor as color } from './test-expression';

const HYDL: ColorRule = {
  kind: 'values',
  property: 'ccn',
  entries: [
    { value: '河流', label: '河流', color: '#1E88E5' },
    { value: '水渠', label: '水渠', color: '#4FC3F7' }
  ],
  fallback: '#2F80ED'
};

// 取值是编码，名称另写
const CODES: ColorRule = {
  kind: 'values',
  property: 'cc',
  entries: [
    { value: '08H211', label: '高等院校', color: '#111111' },
    { value: '08H213', label: '中小学', color: '#222222' }
  ],
  fallback: '#999999'
};

const blackForCanal = (item: { key: string }) => (item.key === '水渠' ? '#000000' : '#FFFFFF');

// 每个取值一个不同的颜色，求值后反查是哪个取值
function routeOf(rule: ColorRule) {
  const keys = classItems(rule).map(item => item.key);
  const expression = classExpression(rule, item => `rgb(${keys.indexOf(item.key)}, 0, 0)`);
  return (properties: Record<string, string>) => {
    const index = keys.findIndex((_, position) => color(`rgb(${position}, 0, 0)`) === colorOf(expression, properties));
    return keys[index];
  };
}

describe('地类规则只列实际有的类别（ADR 0124）', () => {
  const SOME: ColorRule = { kind: 'landuse-code', only: ['0404', '0101', legacyItem('后备耕地')] };

  it('取值只有列出的和"未匹配的地类"，按编码表的顺序，不按列出的顺序', () => {
    expect(classItems(SOME).map(item => item.key)).toStrictEqual(['0101', '0404', 'legacy:后备耕地', OTHER_ITEM]);
  });

  it('地图和图例一致：列出的按编码、历史地类按名称匹配，没列出的都归入"未匹配的地类"', () => {
    const route = routeOf(SOME);

    expect(route({ dlbm: '0404', dlmc: '其他草地' })).toBe('0404');
    expect(route({ dlbm: '1208', dlmc: '后备耕地' })).toBe('legacy:后备耕地');
    expect(route({ dlbm: '0301', dlmc: '乔木林地' })).toBe(OTHER_ITEM);
    expect(route({ dlbm: '999', dlmc: '城市用地' })).toBe(OTHER_ITEM);
  });

  it('只列编码、没有历史地类时，表达式仍能解析', () => {
    const rule: ColorRule = { kind: 'landuse-code', only: ['0404'] };

    expect(routeOf(rule)({ dlbm: '0404' })).toBe('0404');
    expect(routeOf(rule)({ dlbm: '1208', dlmc: '后备耕地' })).toBe(OTHER_ITEM);
  });

  it('不写 only 时仍是全表：地类图斑不受影响', () => {
    expect(classItems({ kind: 'landuse-code' })).toHaveLength(76);
  });
});

describe('classItems', () => {
  it('按取值配色：各取值和"其他"，键是取值本身，名称用于显示', () => {
    expect(classItems(HYDL)).toStrictEqual([
      { key: '河流', label: '河流', color: '#1E88E5' },
      { key: '水渠', label: '水渠', color: '#4FC3F7' },
      { key: OTHER_ITEM, label: '其他', color: '#2F80ED' }
    ]);
    expect(classItems(CODES)).toStrictEqual([
      { key: '08H211', label: '高等院校', color: '#111111' },
      { key: '08H213', label: '中小学', color: '#222222' },
      { key: OTHER_ITEM, label: '其他', color: '#999999' }
    ]);
  });

  it('地类：69 个地类（键是编码）、6 个历史地类（键是 legacy:名称）、"未匹配的地类"，键不重复；按编码、按名称的取值相同', () => {
    const items = classItems({ kind: 'landuse-code' });

    expect(items).toHaveLength(76);
    expect(new Set(items.map(item => item.key)).size).toBe(76);
    expect(items.find(item => item.key === '0101')?.label).toBe('水田');
    expect(items.find(item => item.label === '城市用地')?.key).toBe('legacy:城市用地');
    expect(items.at(-1)).toStrictEqual({ key: OTHER_ITEM, label: '未匹配的地类', color: LANDUSE_FALLBACK_COLOR });
    expect(classItems({ kind: 'landuse-name' })).toBe(items);
  });
});

describe('classExpression', () => {
  it('按编码配色时按取值匹配，不按名称匹配', () => {
    const route = routeOf(CODES);

    expect(route({ cc: '08H213' })).toBe('08H213');
    expect(route({ cc: '中小学' })).toBe(OTHER_ITEM);
  });

  it('按取值配色：按属性匹配，其他值和缺少属性用兜底', () => {
    const route = routeOf(HYDL);
    const features: Record<string, string>[] = [{ ccn: '河流' }, { ccn: '水渠' }, { ccn: '湖泊' }, {}];

    expect(features.map(route)).toStrictEqual([
      '河流',
      '水渠',
      OTHER_ITEM,
      OTHER_ITEM
    ]);
  });

  it('地类图斑：先按编码，没命中再按名称查历史地类，都没命中用兜底', () => {
    const route = routeOf({ kind: 'landuse-code' });

    expect(route({ dlbm: '0101', dlmc: '城市用地' })).toBe('0101');
    expect(route({ dlbm: '201', dlmc: '城市用地' })).toBe('legacy:城市用地');
    expect(route({ dlbm: '9999', dlmc: '水田' })).toBe(OTHER_ITEM);
  });

  it('城镇村：按名称匹配地类和历史地类，没有名称时由编码换成名称', () => {
    const route = routeOf({ kind: 'landuse-name' });

    expect(route({ dlmc: '旱地' })).toBe('0103');
    expect(route({ dlbm: '0702' })).toBe('0702');
    expect(route({ dlbm: '203A' })).toBe('legacy:村庄用地');
    expect(route({})).toBe(OTHER_ITEM);
  });

  it('symbolClasses 交出同样的取值和匹配结构', () => {
    const classes = symbolClasses(HYDL);

    expect(classes.items).toStrictEqual(classItems(HYDL));
    expect(classes.combine(blackForCanal)).toStrictEqual(classExpression(HYDL, blackForCanal));
  });
});
