// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SimulationConditions } from '../model/params';
import { interpretView, viewSuggestions } from './view-commands';

const conditions: SimulationConditions = { years: [2024, 2025], cityCodes: ['320100', '320500'], indicatorIds: ['B-65', 'A-39'] };

describe('interpretView', () => {
  it('回看流程、回到整个范围、年度、范围里的市、条件里的指标、看结果', () => {
    const patches = ['回看计算流程', '回到计算范围', '看 2024 年', '看苏州', '看人均公园绿地', '看结果'].map(text => {
      const command = interpretView(text, conditions);
      return command && [command.show, command.patch];
    });

    expect(patches).toEqual([
      ['flow', {}],
      ['result', { cityCode: null }],
      ['result', { year: 2024 }],
      ['result', { cityCode: '320500' }],
      ['result', { indicatorId: 'A-39' }],
      ['result', {}]
    ]);
    expect(interpretView('看苏州市', conditions)?.reply).toBe('放大到苏州市，设施和服务范围放大后显示。');
  });

  it('改条件、改参数、控制计算的说法，条件外的市、年度、指标，都不算看结果；不再按达标着色（2026-10-30）', () => {
    const texts = [
      '加上苏州市',
      '只看人均公园绿地',
      '改成相交即算',
      '人口增加 10%',
      '按达标着色',
      '暂停',
      '调整条件',
      '看无锡市',
      '看 2026 年',
      '看社区卫生覆盖率',
      '今天天气怎么样'
    ];

    expect(texts.map(text => interpretView(text, conditions))).toEqual(texts.map(() => null));
  });

  it('只有一个市时说范围就是它，不放大', () => {
    const command = interpretView('看南京市', { ...conditions, cityCodes: ['320100'] });

    expect(command).toEqual({ patch: {}, show: 'result', reply: '当前计算范围仅含南京市。' });
  });
});

describe('viewSuggestions', () => {
  it('看另一个市、看另一项指标、回看计算流程；只有一个市时不给市', () => {
    const selection = { indicatorId: 'B-65', year: 2025, cityCode: '320100' } as const;

    expect(viewSuggestions(conditions, selection)).toEqual(['看苏州市', '看人均公园绿地', '回看计算流程']);
    expect(viewSuggestions({ ...conditions, cityCodes: ['320100'], indicatorIds: ['B-65'] }, selection)).toEqual([
      '回看计算流程'
    ]);
  });
});
