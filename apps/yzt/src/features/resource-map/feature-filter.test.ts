// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GRASSLAND_LANDUSE } from './class-dictionaries';
import { OTHER_ITEM } from './classification';
import {
  conditionText,
  featurePasses,
  filterConditions,
  filterExpression,
  filterKey,
  filterText,
  isFiltering,
  keptKeys,
  NO_FILTER,
  normalizedFilter,
  sameFilter,
  withFieldKept
} from './feature-filter';
import { CLASS_FIELD, type FilterField, filterFieldsOf } from './filter-fields';

const SCHOOL = 'csxhjctb_xxa';

const fieldOf = (code: string, id: string): FilterField => {
  const field = filterFieldsOf(code).find(item => item.id === id);
  if (!field) {
    throw new Error(`${code} 没有字段 ${id}`);
  }
  return field;
};
const keysOf = (field: FilterField) => field.values.map(value => value.key);

describe('能过滤的字段（ADR 0173）', () => {
  it('分类字段来自配色规则，取值、名称同图例，最后是"其他"；学校面层另有登记的"类型"', () => {
    const fields = filterFieldsOf(SCHOOL);
    expect(fields.map(field => [field.id, field.label])).toStrictEqual([
      [CLASS_FIELD, '分类'],
      ['type', '类型']
    ]);
    expect(fields[0]?.values).toStrictEqual([
      { key: '08H211', label: '高等院校' },
      { key: '08H212', label: '中等职业学校' },
      { key: '08H213', label: '中小学' },
      { key: '08H214', label: '幼托机构' },
      { key: '08H215', label: '特殊教育学校' },
      { key: '08H216', label: '专门学校（工读学校）' },
      { key: OTHER_ITEM, label: '其他' }
    ]);
    const kinds = fieldOf(SCHOOL, 'type');
    expect(kinds.values).toHaveLength(26);
    expect(kinds.values.slice(0, 4).map(value => value.label)).toStrictEqual(['托儿所', '幼儿园', '幼儿园（含幼托）', '小学']);
    expect(kinds.values.at(-1)).toStrictEqual({ key: OTHER_ITEM, label: '未列出的取值' });
  });

  it('学校点层的类型只列探查到的，先后同全表；没有分类、没有登记的资源不能过滤', () => {
    expect(keysOf(fieldOf('csxhjctb_xxp', 'type'))).toStrictEqual([
      '托儿所',
      '幼儿园',
      '幼儿园（含幼托）',
      '小学',
      '初级中学',
      '高级中学',
      '完全中学',
      '9年一贯制学校',
      '12年一贯制学校',
      '其他特殊教育学校',
      '培智学校',
      OTHER_ITEM
    ]);
    expect(filterFieldsOf('bgdc_cjdcq')).toStrictEqual([]);
    expect(filterFieldsOf('没有这个资源')).toStrictEqual([]);
  });

  it('地类写编码、按一级类分组，历史地类一组，未匹配的地类单独一项；写了 only 的只列资源有的', () => {
    const landuse = fieldOf('bgdc_dltb', CLASS_FIELD);
    expect(landuse.label).toBe('地类');
    expect(landuse.values[0]).toMatchObject({ code: landuse.values[0]?.key });
    expect(landuse.values.find(value => value.key === '0101')).toStrictEqual({ key: '0101', label: '水田', code: '0101' });
    expect(landuse.values.find(value => value.key === 'legacy:后备耕地')).toStrictEqual({
      key: 'legacy:后备耕地',
      label: '后备耕地'
    });
    const groups = landuse.groups ?? [];
    expect(groups.map(group => group.name)).toContain('耕地');
    expect(groups.find(group => group.name === '耕地')?.keys).toStrictEqual(['0101', '0102', '0103']);
    expect(groups.at(-2)?.name).toBe('历史地类');
    expect(groups.at(-1)).toStrictEqual({ name: '未匹配的地类', keys: [OTHER_ITEM] });
    // 每个取值正好在一组里
    expect(groups.flatMap(group => group.keys).toSorted()).toStrictEqual(keysOf(landuse).toSorted());

    const grass = fieldOf('lcsh_cdtb', CLASS_FIELD);
    expect(keysOf(grass).every(key => key === OTHER_ITEM || GRASSLAND_LANDUSE.includes(key))).toBe(true);
    expect(keysOf(grass).length).toBeLessThan(keysOf(landuse).length);
  });
});

describe('过滤条件的整理', () => {
  const fields = filterFieldsOf(SCHOOL);

  it('去掉不认识的字段和取值，取值按登记的先后；全勾的字段去掉；一项都没勾的保留', () => {
    expect(
      normalizedFilter(fields, {
        type: ['小学', '没有这个取值', '托儿所'],
        [CLASS_FIELD]: keysOf(fieldOf(SCHOOL, CLASS_FIELD)),
        name: ['某某学校']
      })
    ).toStrictEqual({ type: ['托儿所', '小学'] });
    expect(normalizedFilter(fields, { [CLASS_FIELD]: [] })).toStrictEqual({ [CLASS_FIELD]: [] });
  });

  it('存下的取值一个都不认识了（登记表改了）：不再过滤这个字段，免得整层消失', () => {
    expect(normalizedFilter(fields, { type: ['以前的取值'] })).toBe(NO_FILTER);
  });

  it('没有条件时是 NO_FILTER，和原来一样时返回原来的对象', () => {
    const filter = { [CLASS_FIELD]: ['08H211'], type: ['小学'] };
    expect(normalizedFilter(fields, filter)).toBe(filter);
    expect(normalizedFilter(fields, {})).toBe(NO_FILTER);
    expect(normalizedFilter([], filter)).toBe(NO_FILTER);
    expect(isFiltering(NO_FILTER)).toBe(false);
    expect(isFiltering(filter)).toBe(true);
  });

  it('换一个字段勾着的取值：全勾等于不过滤这个字段；不能过滤的字段抛错', () => {
    const kinds = fieldOf(SCHOOL, 'type');
    const filter = withFieldKept(fields, NO_FILTER, 'type', ['小学', '小学', '普通高等学校本科院校']);
    expect(filter).toStrictEqual({ type: ['小学', '普通高等学校本科院校'] });
    expect(keptKeys(kinds, filter)).toStrictEqual(new Set(['小学', '普通高等学校本科院校']));
    expect(keptKeys(kinds, NO_FILTER).size).toBe(kinds.values.length);
    expect(withFieldKept(fields, filter, 'type', keysOf(kinds))).toBe(NO_FILTER);
    expect(() => withFieldKept(fields, filter, 'name', ['某某学校'])).toThrow('不能按 name 过滤');
  });

  it('比较条件不管字段和取值的先后', () => {
    const a = { type: ['小学', '托儿所'], [CLASS_FIELD]: ['08H211'] };
    const b = { [CLASS_FIELD]: ['08H211'], type: ['托儿所', '小学'] };
    expect(sameFilter(a, b)).toBe(true);
    expect(filterKey(a)).toBe(filterKey(b));
    expect(sameFilter(a, { type: ['小学'] })).toBe(false);
  });
});

describe('过滤表达式：地图和属性求值用同一个', () => {
  it('分类字段：勾着的类别通过，没勾的、列表以外的（其他）不通过；勾了"其他"时列表以外的也通过', () => {
    const filter = { [CLASS_FIELD]: ['08H211', '08H213'] };
    expect(featurePasses(SCHOOL, filter, { cc: '08H211' })).toBe(true);
    expect(featurePasses(SCHOOL, filter, { cc: '08H214' })).toBe(false);
    expect(featurePasses(SCHOOL, filter, { cc: '新的代码' })).toBe(false);
    expect(featurePasses(SCHOOL, { [CLASS_FIELD]: ['08H211', OTHER_ITEM] }, { cc: '新的代码' })).toBe(true);
  });

  it('登记的字段按属性的取值；没有这个属性、列表以外的取值算"未列出的取值"', () => {
    const filter = { type: ['小学', '普通高等学校本科院校'] };
    expect(featurePasses(SCHOOL, filter, { cc: '08H213', type: '小学' })).toBe(true);
    expect(featurePasses(SCHOOL, filter, { cc: '08H213', type: '初级中学' })).toBe(false);
    expect(featurePasses(SCHOOL, filter, { cc: '08H213' })).toBe(false);
    const withOther = { type: ['小学', OTHER_ITEM] };
    expect(featurePasses(SCHOOL, withOther, { type: '新的类型' })).toBe(true);
    expect(featurePasses(SCHOOL, withOther, {})).toBe(true);
    expect(featurePasses(SCHOOL, withOther, { type: '幼儿园' })).toBe(false);
  });

  it('几个字段都有条件时同时满足', () => {
    const filter = { [CLASS_FIELD]: ['08H213'], type: ['小学', '普通高等学校本科院校'] };
    expect(featurePasses(SCHOOL, filter, { cc: '08H213', type: '小学' })).toBe(true);
    expect(featurePasses(SCHOOL, filter, { cc: '08H211', type: '普通高等学校本科院校' })).toBe(false);
    expect(filterExpression(SCHOOL, filter)?.[0]).toBe('all');
  });

  it('一项都没勾：都不通过；没有条件：没有表达式，都通过', () => {
    expect(featurePasses(SCHOOL, { type: [] }, { type: '小学' })).toBe(false);
    expect(featurePasses(SCHOOL, { [CLASS_FIELD]: [] }, { cc: '08H211' })).toBe(false);
    expect(filterExpression(SCHOOL, NO_FILTER)).toBeNull();
    expect(featurePasses(SCHOOL, NO_FILTER, {})).toBe(true);
  });

  it('地类按编码匹配，编码没命中时按名称查历史地类（同配色）', () => {
    const filter = { [CLASS_FIELD]: ['0101', 'legacy:后备耕地'] };
    expect(featurePasses('bgdc_dltb', filter, { dlbm: '0101', dlmc: '水田' })).toBe(true);
    expect(featurePasses('bgdc_dltb', filter, { dlbm: '0102', dlmc: '水浇地' })).toBe(false);
    expect(featurePasses('bgdc_dltb', filter, { dlbm: '9999', dlmc: '后备耕地' })).toBe(true);
    expect(featurePasses('bgdc_dltb', filter, { dlbm: '9999', dlmc: '没有的地类' })).toBe(false);
  });

  it('没有分类、没有登记这个字段时抛错（拥有者整理过的条件不会走到这里）', () => {
    expect(() => filterExpression('bgdc_cjdcq', { [CLASS_FIELD]: ['x'] })).toThrow('没有分类');
    expect(() => filterExpression(SCHOOL, { name: ['x'] })).toThrow('没有登记字段 name');
  });
});

describe('条件的文字', () => {
  it('字段的叫法加勾着的取值；多于 4 项写前三个和项数；一项都没选时写明', () => {
    expect(filterText(SCHOOL, { type: ['小学', '普通高等学校本科院校'] })).toBe('类型：小学、普通高等学校本科院校');
    expect(filterText(SCHOOL, { [CLASS_FIELD]: ['08H211'], type: ['小学'] })).toBe('分类：高等院校；类型：小学');
    expect(filterText(SCHOOL, { type: ['托儿所', '幼儿园', '小学', '初级中学', '高级中学'] })).toBe(
      '类型：托儿所、幼儿园、小学等 5 项'
    );
    const [condition] = filterConditions(SCHOOL, { type: [] });
    expect(condition && conditionText(condition)).toBe('类型：一项都没选');
    expect(filterText(SCHOOL, NO_FILTER)).toBe('');
  });
});
