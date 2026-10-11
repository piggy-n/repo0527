// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classExpression, classItems, type ColorRule, OTHER_ITEM, symbolClasses } from './classification';
import { LANDUSE_FALLBACK_COLOR } from './landuse';
import { RESOURCE_PALETTE } from './palette';
import { colorOf, normalizeColor as color } from './test-expression';

const HYDL: ColorRule = {
  kind: 'values',
  property: 'ccn',
  colors: [
    ['河流', '#1E88E5'],
    ['水渠', '#4FC3F7']
  ],
  fallback: '#2F80ED'
};

const ORDERED: ColorRule = { kind: 'ordered', property: 'czclx', values: ['201', '202'], fallback: '#999999' };

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

describe('classItems', () => {
  it('按取值配色：各取值和"其他"，键是取值本身；按顺序取色的用配色板', () => {
    expect(classItems(HYDL)).toStrictEqual([
      { key: '河流', label: '河流', color: '#1E88E5' },
      { key: '水渠', label: '水渠', color: '#4FC3F7' },
      { key: OTHER_ITEM, label: '其他', color: '#2F80ED' }
    ]);
    expect(classItems(ORDERED).map(item => item.color)).toStrictEqual([
      RESOURCE_PALETTE[0],
      RESOURCE_PALETTE[1],
      '#999999'
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
