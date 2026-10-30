// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ConditionField } from './layer-fields';
import { layerOf, QUERY_TOPICS } from './topics';

type OptionField = Extract<ConditionField, { type: 'single' | 'multiple' }>;

const topics = Object.values(QUERY_TOPICS);
const optionFields = topics
  .flatMap(topic => topic.layers.flatMap(layer => layer.fields))
  .filter((field): field is OptionField => field.type === 'single' || field.type === 'multiple');

// 初始值统一成数组
function initialCodes({ initial }: OptionField): readonly string[] {
  if (initial === undefined) {
    return [];
  }
  return typeof initial === 'string' ? [initial] : initial;
}

// 自检的写法：找出不符合的条目，断言为空，失败时直接看到是哪几个
describe('专题配置', () => {
  it('每个图层的条件字段不重复（旧配置的医疗机构把两个字段都写成了 IFTC）', () => {
    const duplicated = topics
      .flatMap(topic => topic.layers)
      .filter(layer => new Set(layer.fields.map(({ field }) => field)).size !== layer.fields.length)
      .map(({ label }) => label);
    expect(duplicated).toStrictEqual([]);
  });

  it('下拉选项的编码在同一个字段里不重复，地类名称的选项编码就是名称', () => {
    const duplicated = optionFields
      .filter(({ options }) => new Set(options.map(({ code }) => code)).size !== options.length)
      .map(({ label }) => label);
    const mismatched = optionFields
      .filter(({ field }) => field === 'DLMC')
      .flatMap(({ options }) => options.filter(({ code, name }) => code !== name))
      .map(({ code }) => code);
    expect(duplicated).toStrictEqual([]);
    expect(mismatched).toStrictEqual([]);
  });

  it('字段的初始值都在选项里', () => {
    const outside = optionFields.flatMap(field => {
      const codes = new Set(field.options.map(({ code }) => code));
      return initialCodes(field)
        .filter(code => !codes.has(code))
        .map(code => `${field.label}：${code}`);
    });
    expect(outside).toStrictEqual([]);
  });

  it('自然语言的规则指向专题里的图层和字段，示例都能命中一条规则', () => {
    const broken = topics.flatMap(topic =>
      (topic.natural?.rules ?? [])
        .filter(rule => {
          const layer = layerOf(topic, rule.table);
          return !layer || (rule.condition && !layer.fields.some(({ field }) => field === rule.condition?.field));
        })
        .map(rule => `${topic.id}：${rule.table}`)
    );
    const unmatched = topics.flatMap(({ natural }) =>
      (natural?.examples ?? []).filter(example => !natural?.rules.some(rule => rule.examples.includes(example)))
    );
    expect(broken).toStrictEqual([]);
    expect(unmatched).toStrictEqual([]);
  });

  it('森林草原湿地荒漠、水资源是建设中的专题：没有图层，也没有自然语言', () => {
    expect(QUERY_TOPICS['forest-grass-wetland-desert']).toMatchObject({ layers: [], natural: null });
    expect(QUERY_TOPICS['water-resource']).toMatchObject({ layers: [], natural: null });
  });
});
