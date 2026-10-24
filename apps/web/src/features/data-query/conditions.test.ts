// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { advancedConditions, buildConditions, matchNatural } from './conditions';
import { QUERY_LAYERS } from './config';
import { queryLayerGroup } from './map-style';
import { recordText, resultColumns } from './result-fields';

const SCHOOL = QUERY_LAYERS.city[0];

describe('数据查询条件', () => {
  it('保留数值 0、转义单引号，多个条件按选定关系组合', () => {
    expect(buildConditions(SCHOOL, [
      { code: 'QUOTA', operator: '>=', value: 0 },
      { code: 'NAME', operator: 'NOT', value: "O'Brien" }
    ], 'AND')).toBe("(QUOTA >= '0') AND (NAME NOT LIKE '%O''Brien%')");
    expect(buildConditions(SCHOOL, [
      { code: 'TYPE', operator: '=', value: ['小学', '高级中学'] },
      { code: 'NAME', operator: 'LIKE', value: '' }
    ], 'OR')).toBe("(TYPE IN ('小学', '高级中学'))");
  });

  it('非法字段、枚举、数值和操作符不生成请求', () => {
    for (const condition of [
      { code: 'UNKNOWN', operator: '=', value: 'x' },
      { code: 'TYPE', operator: '=', value: '不存在的学校类型' },
      { code: 'QUOTA', operator: '>', value: '不是数字' },
      { code: 'QUOTA', operator: 'DROP', value: '1' }
    ]) {
      expect(() => buildConditions(SCHOOL, [condition], 'AND')).toThrow(/字段|选项|填写|比较/);
    }
  });

  it('高级条件允许字符串中的关键字，拒绝语句和不完整字符串', () => {
    expect(advancedConditions(" NAME = 'SELECT;--' ")).toBe("NAME = 'SELECT;--'");
    expect(advancedConditions("NAME = 'O''Brien'")).toBe("NAME = 'O''Brien'");
    for (const value of ['', 'SELECT * FROM school', 'QUOTA > 0; DROP TABLE school', "NAME = 'x", '1=1 --']) {
      expect(() => advancedConditions(value)).toThrow(/请填写/);
    }
  });

  it('自然语言具体示例不会被全省宽泛规则覆盖，未知描述明确拒绝', () => {
    expect(matchNatural('city', '查询南京市学校点层中类型为小学、高级中学的数据')).toMatchObject({
      region: '320100', layerCode: SCHOOL.code, conditions: "TYPE IN ('小学', '高级中学')"
    });
    expect(() => matchNatural('city', '查询南京市所有医院')).toThrow('当前仅支持');
  });

  it('配置字段唯一，城镇村源图层保留旧服务名称', () => {
    for (const layer of Object.values(QUERY_LAYERS).flat()) {
      expect(new Set(layer.fields.map(field => field.code)).size).toBe(layer.fields.length);
    }
    expect(QUERY_LAYERS.land[0].sourceLayer).toBe('czcdyd');
    const group = queryLayerGroup(SCHOOL, {
      id: 'one', layer: SCHOOL, conditions: "NAME LIKE '%小学&中学%'", mode: 'advanced',
      scope: { kind: 'region', code: '320102' }, signature: ''
    }, 'http://localhost/backend');
    const source = group.sources['query-layer-source'];
    expect(source.type).toBe('vector');
    const params = new URL(source.type === 'vector' ? source.tiles![0] : 'http://invalid/').searchParams;
    expect(params.get('conditions')).toBe("NAME LIKE '%小学&中学%'");
    expect(params.get('xzqdm')).toBe('320102');
    expect(params.get('z')).toBe('{z}');
  });

  it('属性只作为文本展示，几何不进入表格，字段不区分后端返回的大小写', () => {
    expect(resultColumns(SCHOOL, [{ name: '<script>文本</script>', geom: '几何', sjnf: 2022 }]))
      .toEqual([{ code: 'name', label: '学校名称' }, { code: 'sjnf', label: '年份' }]);
    expect([0, false, null, { a: 1 }].map(recordText)).toEqual(['0', 'false', '', '{"a":1}']);
  });
});
