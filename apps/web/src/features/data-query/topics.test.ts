// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { layerOf, QUERY_TOPICS } from './topics';

const topics = Object.values(QUERY_TOPICS);

describe('专题配置', () => {
  it('每个图层的条件字段不重复（旧配置的医疗机构把两个字段都写成了 IFTC）', () => {
    for (const layer of topics.flatMap(topic => topic.layers)) {
      const fields = layer.fields.map(({ field }) => field);
      expect(new Set(fields).size, layer.label).toBe(fields.length);
    }
  });

  it('下拉选项的编码在同一个字段里不重复，地类名称的选项编码就是名称', () => {
    for (const field of topics.flatMap(topic => topic.layers.flatMap(layer => layer.fields))) {
      if (field.type === 'single' || field.type === 'multiple') {
        const codes = field.options.map(({ code }) => code);
        expect(new Set(codes).size, field.label).toBe(codes.length);
        if (field.field === 'DLMC') {
          expect(field.options.every(({ code, name }) => code === name)).toBe(true);
        }
      }
    }
  });

  it('字段的初始值都在选项里', () => {
    for (const field of topics.flatMap(topic => topic.layers.flatMap(layer => layer.fields))) {
      if ((field.type === 'single' || field.type === 'multiple') && field.initial !== undefined) {
        const codes = new Set(field.options.map(({ code }) => code));
        const initial = typeof field.initial === 'string' ? [field.initial] : field.initial;
        expect(initial.every(code => codes.has(code)), field.label).toBe(true);
      }
    }
  });

  it('自然语言的规则指向专题里的图层和字段，示例都能命中一条规则', () => {
    for (const topic of topics) {
      for (const rule of topic.natural?.rules ?? []) {
        const layer = layerOf(topic, rule.table);
        expect(layer, rule.table).toBeDefined();
        if (rule.condition) {
          expect(layer?.fields.some(({ field }) => field === rule.condition?.field)).toBe(true);
        }
      }
      const examples = topic.natural?.examples ?? [];
      expect(examples.every(example => topic.natural?.rules.some(rule => rule.examples.includes(example)))).toBe(true);
    }
  });

  it('森林草原湿地荒漠、水资源是建设中的专题：没有图层，也没有自然语言', () => {
    expect(QUERY_TOPICS['forest-grass-wetland-desert']).toMatchObject({ layers: [], natural: null });
    expect(QUERY_TOPICS['water-resource']).toMatchObject({ layers: [], natural: null });
  });
});
