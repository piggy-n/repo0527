// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import type { Composition } from '../compose/composition';
import { defaultParams } from '../model/params';
import { commandSuggestions, interpretCommand, type RunCommand } from './commands';

const current: Composition = {
  conditions: { years: [2025], cityCodes: ['320100', '320500'], indicatorIds: ['A-31', 'A-39'] },
  params: { ...defaultParams(), recognition: 'intersect' }
};

const changeOf = (command: RunCommand) => {
  if (command.kind !== 'change') {
    throw new Error(`应是改动，实际是 ${command.kind}`);
  }
  return command;
};

describe('interpretCommand', () => {
  it('暂停、继续、停止', () => {
    expect(interpretCommand('暂停一下', current)).toEqual({ kind: 'pause' });
    expect(interpretCommand('继续', current)).toEqual({ kind: 'resume' });
    expect(interpretCommand('停止计算', current)).toEqual({ kind: 'stop' });
    expect(interpretCommand('调整条件', current)).toEqual({ kind: 'stop' });
  });

  it('改参数：只改参数时不算改条件，写出改成什么、影响哪些指标', () => {
    const rule = changeOf(interpretCommand('按旧规程计算', current));
    expect(rule.composition).toEqual({ ...current, params: { ...current.params, rule: 'old' } });
    expect(rule.conditionsChanged).toBe(false);
    expect(rule.said).toEqual(['计算规程改为「旧规程」（自定义口径），影响社区卫生覆盖率']);

    const half = changeOf(interpretCommand('覆盖认定改回 50%', current));
    expect(half.composition.params.recognition).toBe('half');
    expect(half.said[0]).toContain('（标准口径）');
    expect(changeOf(interpretCommand('常住人口减少 12%', current)).composition.params.popChange).toBe(-10);
    expect(changeOf(interpretCommand('恢复标准口径', current)).composition.params).toEqual(defaultParams());
  });

  it('不设置目标值：说到目标值时不改条件，说明原因（2026-10-30）', () => {
    const none = { kind: 'none', notes: ['计算结果只给出各项指标的值，不设置目标值'] };
    expect(interpretCommand('人均公园绿地目标改成 13', current)).toEqual(none);
    expect(interpretCommand('公园绿地覆盖率目标 75', current)).toEqual(none);
  });

  it('加上、去掉、只看城市；全省', () => {
    const added = changeOf(interpretCommand('加上无锡市', current));
    expect(added.composition.conditions.cityCodes).toEqual(['320100', '320200', '320500']);
    expect(added.conditionsChanged).toBe(true);
    expect(added.said).toEqual(['范围改为南京市等 3 个市']);
    expect(changeOf(interpretCommand('去掉苏州', current)).composition.conditions.cityCodes).toEqual(['320100']);
    expect(changeOf(interpretCommand('只看苏州市', current)).composition.conditions.cityCodes).toEqual(['320500']);
    expect(changeOf(interpretCommand('加上全省', current)).composition.conditions.cityCodes).toHaveLength(JIANGSU_CITIES.length);
  });

  it('加上、去掉指标；改年度', () => {
    const added = changeOf(interpretCommand('再加上小学覆盖率', current));
    expect(added.composition.conditions.indicatorIds).toEqual(['A-31', 'A-39', 'A-32']);
    expect(added.said).toEqual(['加上小学覆盖率']);
    expect(changeOf(interpretCommand('去掉人均公园绿地', current)).said).toEqual(['去掉人均公园绿地']);
    const years = changeOf(interpretCommand('改成 2026 年', current));
    expect(years.composition.conditions.years).toEqual([2026]);
    expect(changeOf(interpretCommand('加上 2024 年', current)).composition.conditions.years).toEqual([2025, 2024]);
  });

  it('用不上的参数、清空条件、听不懂的话不改；有改动时暂停不算', () => {
    const solo: Composition = { ...current, conditions: { ...current.conditions, indicatorIds: ['A-39'] } };
    expect(interpretCommand('按旧规程计算', solo)).toEqual({ kind: 'none', notes: ['所选指标不适用计算规程'] });
    expect(interpretCommand('去掉南京市和苏州市', current)).toEqual({ kind: 'none', notes: ['年份、范围和指标均需至少保留一项'] });
    expect(interpretCommand('今天天气怎么样', current)).toEqual({ kind: 'none', notes: [] });
    expect(interpretCommand('暂停，改成旧规程', current).kind).toBe('change');
    // 一句里同时有用得上和用不上的：改用得上的，说明用不上的
    const mixed = changeOf(interpretCommand('按旧规程、人口增加 10% 计算', { ...current, conditions: { ...current.conditions, indicatorIds: ['A-31'] } }));
    expect(mixed.composition.params).toMatchObject({ rule: 'old', popChange: 0 });
    expect(mixed.notes).toEqual(['所选指标不适用常住人口变化']);
  });
});

describe('commandSuggestions', () => {
  it('按条件、参数和状态给几条：暂停或继续、参数的切换、加一个市、去掉最后一项指标、停止或调整条件', () => {
    expect(commandSuggestions(current, 'running')).toEqual([
      '暂停',
      '覆盖认定改回 50%',
      '按旧规程计算',
      '常住人口增加 10%',
      '加上无锡市',
      '去掉人均公园绿地',
      '停止计算'
    ]);
    expect(commandSuggestions(current, 'paused')[0]).toBe('继续');
    const done = commandSuggestions({ ...current, conditions: { ...current.conditions, indicatorIds: ['B-65'] } }, 'done');
    expect(done).toEqual(['覆盖认定改回 50%', '加上无锡市', '加上人均公园绿地', '调整条件']);
  });
});
