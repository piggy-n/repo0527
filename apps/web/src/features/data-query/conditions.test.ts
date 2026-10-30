// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  attributeSql,
  type Condition,
  conditionsText,
  insertToken,
  matchNaturalRule,
  newCondition,
  parseAdvancedSql,
  quoteValue
} from './conditions';
import { type ConditionField, NUMBER_OPERATORS, TEXT_OPERATORS } from './layer-fields';
import { QUERY_TOPICS } from './topics';

const TYPE: ConditionField = {
  label: '类型',
  field: 'TYPE',
  type: 'multiple',
  options: [],
  initial: ['小学', '高级中学'],
  shown: true
};
const NAME: ConditionField = { label: '名称', field: 'NAME', type: 'input', operators: TEXT_OPERATORS };
const AREA: ConditionField = { label: '面积', field: 'CZCMJ', type: 'input', operators: NUMBER_OPERATORS };
const GRADE: ConditionField = { label: '等级', field: 'GRADE', type: 'single', options: [] };
const DATE: ConditionField = { label: '更新时间', field: 'GXSJ', type: 'datetime' };

const condition = (field: ConditionField, patch: Partial<Condition> = {}): Condition => ({
  ...newCondition(field, 1),
  ...patch
});

describe('newCondition', () => {
  it('多选取字段的初始值，输入框默认第一个运算符，连接默认 AND', () => {
    expect(newCondition(TYPE, 3)).toStrictEqual({
      key: 3,
      field: TYPE,
      value: ['小学', '高级中学'],
      operator: null,
      link: 'AND'
    });
    expect(newCondition(NAME, 4)).toMatchObject({ value: '', operator: 'LIKE' });
    expect(newCondition(GRADE, 5)).toMatchObject({ value: '', operator: null });
    expect(newCondition(DATE, 6)).toMatchObject({ value: '', operator: null });
  });
});

describe('conditionsText', () => {
  it('多选拼成 IN，单选、日期拼成等于，值里的单引号写两次', () => {
    expect(
      conditionsText([
        condition(TYPE),
        condition(GRADE, { value: "一'级" }),
        condition(DATE, { value: '2023-09-07', link: 'OR' })
      ])
    ).toBe("TYPE IN ('小学','高级中学') AND GRADE = '一''级' AND GXSJ = '2023-09-07'");
  });

  it('LIKE、NOT 按包含、不包含拼（ADR 0104），数值比较保留运算符', () => {
    expect(conditionsText([condition(NAME, { value: '小学' })])).toBe("NAME LIKE '%小学%'");
    expect(conditionsText([condition(NAME, { value: '小学', operator: 'NOT' })])).toBe("NAME NOT LIKE '%小学%'");
    expect(conditionsText([condition(AREA, { value: '100', operator: '>=' })])).toBe("CZCMJ >= '100'");
  });

  it('连接写在前一个条件上；没填的条件跳过，连接按剩下的条件拼', () => {
    const conditions = [
      condition(NAME, { value: '中学', link: 'OR' }),
      condition(GRADE, { value: '' }),
      condition(TYPE, { value: [] }),
      condition(AREA, { value: '10', operator: '>' })
    ];
    expect(conditionsText(conditions)).toBe("NAME LIKE '%中学%' OR CZCMJ > '10'");
    expect(conditionsText([condition(GRADE)])).toBe('');
  });
});

describe('attributeSql', () => {
  it('行政区划和条件用 AND 连接；没选区划时只写条件', () => {
    expect(attributeSql('csxhjctb_xxa_2022', '320100', [condition(TYPE)])).toBe(
      "SELECT * FROM csxhjctb_xxa_2022 WHERE xzqdm = '320100' AND TYPE IN ('小学','高级中学')"
    );
    expect(attributeSql('t', null, [condition(GRADE, { value: '二级' })])).toBe("SELECT * FROM t WHERE GRADE = '二级'");
  });
});

describe('高级查询的 SQL', () => {
  it('插入时 SQL 为空先写 SELECT * FROM 表 WHERE，之后接在末尾', () => {
    const first = insertToken('', 'bgdc_dltb_2022', 'DLBM');
    expect(first).toBe('SELECT * FROM bgdc_dltb_2022 WHERE DLBM ');
    expect(insertToken(insertToken(first, 'bgdc_dltb_2022', '='), 'bgdc_dltb_2022', quoteValue('0101'))).toBe(
      "SELECT * FROM bgdc_dltb_2022 WHERE DLBM = '0101' "
    );
  });

  it('拆出表名、行政区划和条件；区划在中间时去掉它和多余的连接', () => {
    expect(
      parseAdvancedSql("SELECT * FROM bgdc_czcdyd_2022 WHERE CZCLX = '201' AND xzqdm = '320100' AND CZCMJ > '10';", null, '320000')
    ).toStrictEqual({ layerCode: 'bgdc_czcdyd_2022', xzqdm: '320100', conditions: "CZCLX = '201' AND CZCMJ > '10'" });
    expect(parseAdvancedSql("SELECT * FROM t WHERE xzqdm = '320102'", null, '320000')).toStrictEqual({
      layerCode: 't',
      xzqdm: '320102',
      conditions: ''
    });
  });

  it('只写条件时用选中的图层和后备区划；没有图层时 layerCode 为 null', () => {
    expect(parseAdvancedSql("WHERE NAME LIKE '%小学%' AND", 'csxhjctb_xxa_2022', '320000')).toStrictEqual({
      layerCode: 'csxhjctb_xxa_2022',
      xzqdm: '320000',
      conditions: "NAME LIKE '%小学%'"
    });
    expect(parseAdvancedSql('', null, '320000').layerCode).toBeNull();
  });

  it('从地址里复制来的 SQL 先解码', () => {
    const encoded = encodeURIComponent("SELECT * FROM t WHERE TYPE = '小学'");
    expect(parseAdvancedSql(encoded, null, '320000')).toMatchObject({ layerCode: 't', conditions: "TYPE = '小学'" });
  });
});

describe('matchNaturalRule', () => {
  const rules = QUERY_TOPICS['land-change'].natural?.rules ?? [];

  it('示例原样（忽略空格）命中对应的规则，优先于关键词', () => {
    expect(matchNaturalRule('南京市城镇村等用地类型为 201、201A 的数据', rules)?.region).toBe('320100');
    expect(matchNaturalRule('查询江苏省城镇村等用地类型为202、202A的数据', rules)?.condition?.value).toStrictEqual([
      '202',
      '202A'
    ]);
  });

  it('不是示例时找包含全部关键词的规则；都没有时为 undefined', () => {
    expect(matchNaturalRule('帮我看看城镇村等用地里 201、201A、202 这几类', rules)?.condition?.value).toStrictEqual([
      '201',
      '201A',
      '202'
    ]);
    expect(matchNaturalRule('查询江苏省南京市耕地分布', rules)).toBeUndefined();
  });
});
