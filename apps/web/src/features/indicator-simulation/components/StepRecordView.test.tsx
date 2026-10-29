import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { StepId } from '../engine/steps';
import { em, rich, type StepRecord } from '../run/narrative';
import { StepRecordView } from './StepRecordView';

// 条件解析时长 1800 毫秒：一句在 0.5 处出现，每 26 毫秒打一个字
const record: StepRecord = {
  blocks: [
    {
      label: null,
      tools: [{ step: 'parse', label: '任务理解', doneAt: 0.6 }],
      lines: [{ step: 'parse', at: 0.5, text: rich`共 ${em('12345')} 项` }]
    }
  ],
  metrics: [{ step: 'parse', at: 0.5, label: '指标', value: 100, format: value => `${Math.round(value)} 项` }],
  basis: [rich`依据`],
  params: [],
  summaries: {}
};

function mountAt(progress: number, still = false) {
  return mount(StepRecordView, {
    props: { record, progress: (_step: StepId) => progress, started: () => progress > 0, still }
  });
}

describe('StepRecordView', () => {
  it('没开始时写等待；进度没到时这一句不出现', () => {
    expect(mountAt(0).text()).toBe('等待开始');
    const before = mountAt(0.4);
    expect(before.findAll('p')).toHaveLength(0);
    expect(before.find('[class*="_done_"]').exists()).toBe(false);
  });

  it('按经过的时间打字，强调的部分也按字数；数字从 0 滚上去', () => {
    // 过了 0.5 之后 0.05 × 1800 = 90 毫秒：打出 3 个字
    const typing = mountAt(0.55);
    expect(typing.get('p').text()).toBe('共 1');
    expect(typing.get('p').classes().join(' ')).toMatch(/typing/);
    expect(typing.get('b').text()).not.toBe('100 项');

    const done = mountAt(1);
    expect(done.get('p').text()).toBe('共 12345 项');
    expect(done.get('p').classes().join(' ')).not.toMatch(/typing/);
    expect(done.get('b').text()).toBe('100 项');
    expect(done.find('[class*="_done_"]').exists()).toBe(true);
  });

  it('减少动画时直接显示完整的文字和数字', () => {
    const still = mountAt(0.55, true);
    expect(still.get('p').text()).toBe('共 12345 项');
    expect(still.get('b').text()).toBe('100 项');
  });
});
