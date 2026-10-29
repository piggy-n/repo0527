// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type EngineState, idleEngineState, type StepStatus } from '../engine/engine';
import type { StepId } from '../engine/steps';
import { currentGroup, doneCount, groupStatus, groupText, nextGroup, stepText, visibleGroups } from './run-view';

// 指定几步的状态，其余等待
function stateWith(statuses: Partial<Record<StepId, StepStatus>>, patch: Partial<EngineState> = {}): EngineState {
  const idle = idleEngineState();
  const steps = { ...idle.steps };
  for (const [id, status] of Object.entries(statuses) as [StepId, StepStatus][]) {
    steps[id] = { status, human: false };
  }
  return { ...idle, status: 'running', steps, ...patch };
}

describe('groupStatus', () => {
  it('数据准备汇总三路：有进行中就是进行中，全部复用才是复用，有待更新就是待更新', () => {
    expect(groupStatus('prep', stateWith({ pop: 'done', poi: 'running', land: 'done' }).steps)).toBe('running');
    expect(groupStatus('prep', stateWith({ pop: 'done', poi: 'reused', land: 'done' }).steps)).toBe('done');
    expect(groupStatus('prep', stateWith({ pop: 'reused', poi: 'reused', land: 'reused' }).steps)).toBe('reused');
    expect(groupStatus('prep', stateWith({ pop: 'stale', poi: 'reused', land: 'reused' }).steps)).toBe('stale');
  });
});

describe('行的出现与当前行', () => {
  it('开始过的行出现，下一行是虚影；完成后没有虚影', () => {
    const state = stateWith({ parse: 'done', pop: 'running', poi: 'running', land: 'done' });
    expect(visibleGroups(state)).toEqual(['parse', 'prep']);
    expect(nextGroup(state)).toBe('qc');
    expect(currentGroup(state)).toBe('prep');
    expect(doneCount(state)).toBe(1);
    expect(nextGroup({ ...state, status: 'done' })).toBeNull();
    expect(nextGroup(stateWith({}, { status: 'planning' }))).toBeNull();
  });

  it('干预后等待重算时，当前行是重算起点所在的行', () => {
    const state = stateWith({ parse: 'reused', pop: 'stale', poi: 'reused', land: 'reused', qc: 'stale' }, { restart: 'pop' });
    expect(currentGroup(state)).toBe('prep');
  });
});

describe('说明文字', () => {
  it('进行中写在做什么，暂停时写已暂停，完成后写摘要', () => {
    const state = stateWith({ parse: 'done', qc: 'running' });
    expect(stepText('qc', state, undefined)).toBe('核查数据完整性…');
    expect(stepText('qc', { ...state, paused: true }, undefined)).toBe('已暂停');
    expect(stepText('parse', state, '1 年 · 13 市 · 3 项')).toBe('1 年 · 13 市 · 3 项');
    expect(stepText('evaluate', stateWith({ evaluate: 'running' }), undefined)).toBe('对照目标值…');
  });

  it('数据准备一行汇总三路', () => {
    expect(groupText('prep', stateWith({ pop: 'running', poi: 'done', land: 'done' }), {})).toBe('3 路数据并行读取…');
    expect(groupText('prep', stateWith({ pop: 'done', poi: 'done', land: 'reused' }), {})).toBe('3 路数据已就绪');
    expect(groupText('prep', stateWith({ pop: 'stale', poi: 'reused', land: 'reused' }), {})).toBe('等待更新');
  });
});
