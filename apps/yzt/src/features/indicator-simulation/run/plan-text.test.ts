// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { planText } from './run-view';

describe('planText', () => {
  it('按引擎的处理方式写说明；重算时按左侧的行数说复用了几个环节', () => {
    const plan = { changes: [], baseIndex: null } as const;
    expect(planText({ ...plan, outcome: 'unchanged', restart: null })).toBe('参数未变化');
    expect(planText({ ...plan, outcome: 'saved', restart: 'spatial' })).toBe('「空间分析」尚未执行，保存后执行到这一步时生效');
    expect(planText({ ...plan, outcome: 'rerun', restart: 'spatial' })).toBe('将从「空间分析」重算，前面 3 个环节复用已有结果');
    expect(planText({ ...plan, outcome: 'rerun', restart: null })).toBe('参数与上一轮相同，直接生成新版本');
  });
});
