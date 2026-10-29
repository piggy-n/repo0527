// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PARAM_KEYS } from '../model/params';
import { downstream, PARAM_STEP, restartStep, STEP_GROUPS, stepDefinition, STEPS } from './steps';

describe('STEPS', () => {
  it('按层排列，依赖都在更低的层', () => {
    STEPS.forEach((step, index) => {
      expect(step.level).toBeGreaterThanOrEqual(STEPS[index - 1]?.level ?? 0);
      for (const dep of step.deps) {
        expect(stepDefinition(dep).level).toBeLessThan(step.level);
      }
    });
  });

  it('界面的分组按顺序覆盖每个步骤一次，和步骤的 group 一致', () => {
    expect(STEP_GROUPS.flatMap(group => group.steps)).toEqual(STEPS.map(step => step.id));
    for (const group of STEP_GROUPS) {
      for (const id of group.steps) {
        expect(stepDefinition(id).group).toBe(group.id);
      }
    }
  });

  it('确认点在步骤的时长之内', () => {
    for (const step of STEPS) {
      expect(step.checkpointAt ?? 0).toBeLessThan(step.duration);
    }
  });
});

describe('downstream', () => {
  it('人口数据的下游不含并行的设施、用地数据', () => {
    expect([...downstream('pop')]).toEqual(['pop', 'qc', 'spatial', 'compute', 'evaluate', 'report']);
  });

  it('最后一步只有自己', () => {
    expect([...downstream('report')]).toEqual(['report']);
  });
});

describe('restartStep', () => {
  it('取改动所属步骤里最靠前的；没有改动为 null', () => {
    expect(restartStep(['targets', 'walkSpeed'])).toBe('spatial');
    expect(restartStep(['targets'])).toBe('evaluate');
    expect(restartStep([])).toBeNull();
  });

  it('每个参数项都属于一个步骤', () => {
    for (const key of PARAM_KEYS) {
      expect(STEPS.map(step => step.id)).toContain(PARAM_STEP[key]);
    }
  });
});
