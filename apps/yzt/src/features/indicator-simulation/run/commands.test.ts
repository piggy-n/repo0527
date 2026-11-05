// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { type Composition, rememberedScopes, withArea } from '../compose/composition';
import { defaultParams, isStandard } from '../model/params';
import { areaScope, citiesScope, scopeCityCodes } from '../model/scope';
import { NINGZHEN_RINGS, testArea } from '../model/test-area';
import { loadTestAtlas } from '../model/test-atlas';
import { commandSuggestions, interpretCommand, isFullInstruction, isStartWord, type RunCommand, scopeAction } from './commands';

const current: Composition = {
  conditions: { years: [2025], scope: citiesScope(['320100', '320500']), indicatorIds: ['A-31', 'A-39'] },
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
    expect(rule.composition).toMatchObject({ ...current, params: { ...current.params, rule: 'old' } });
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
    expect(added.composition.conditions.scope).toEqual(citiesScope(['320100', '320200', '320500']));
    expect(added.conditionsChanged).toBe(true);
    expect(added.said).toEqual(['范围改为南京市等 3 个市']);
    expect(changeOf(interpretCommand('去掉苏州', current)).composition.conditions.scope).toEqual(citiesScope(['320100']));
    expect(changeOf(interpretCommand('只看苏州市', current)).composition.conditions.scope).toEqual(citiesScope(['320500']));
    const all = changeOf(interpretCommand('加上全省', current)).composition.conditions.scope;
    expect(scopeCityCodes(all)).toHaveLength(JIANGSU_CITIES.length);
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
    expect(interpretCommand('去掉社区卫生和人均公园绿地', current)).toEqual({ kind: 'none', notes: ['年份和指标均需至少保留一项'] });
    expect(interpretCommand('去掉 2025 年', current)).toEqual({ kind: 'none', notes: ['年份和指标均需至少保留一项'] });
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
      '社区卫生改为步行 10 分钟',
      '加上无锡市',
      '去掉人均公园绿地',
      '绘制范围',
      '移除范围',
      '停止计算'
    ]);
    expect(commandSuggestions(current, 'paused')[0]).toBe('继续');
    const done = commandSuggestions({ ...current, conditions: { ...current.conditions, indicatorIds: ['B-65'] } }, 'done');
    expect(done).toEqual(['覆盖认定改回 50%', '公园绿地改为步行 10 分钟', '加上无锡市', '加上人均公园绿地', '绘制范围', '移除范围', '调整条件']);
  });
});

describe('步行时长的说法（ADR 0125）', () => {
  const walking: Composition = {
    ...current,
    conditions: { ...current.conditions, indicatorIds: ['A-31', 'A-33', 'A-39'] }
  };

  it('"改成"不是"只看"：只改时长，所选的指标不变，不算改了条件', () => {
    for (const words of ['社区卫生改成步行 10 分钟', '社区卫生步行时长改为 10 分钟', '社区卫生改为步行 10 分钟']) {
      const change = changeOf(interpretCommand(words, walking));
      expect(change.composition.conditions.indicatorIds).toEqual(['A-31', 'A-33', 'A-39']);
      expect(change.composition.params.walkMinutes).toEqual({ 'A-31': 10 });
      expect(change.conditionsChanged).toBe(false);
      expect(change.said).toEqual(['步行时长改为「社区卫生 10 分钟」（自定义口径），影响社区卫生覆盖率']);
    }
  });

  it('没说指标时改所选的全部步行类指标；改回标准；恢复标准口径时也恢复', () => {
    const change = changeOf(interpretCommand('步行时长改成 10 分钟', walking));
    expect(change.composition.params.walkMinutes).toEqual({ 'A-31': 10, 'A-33': 10 });
    expect(change.composition.conditions.indicatorIds).toEqual(['A-31', 'A-33', 'A-39']);
    for (const words of ['步行时长改回标准', '恢复标准口径']) {
      const back = changeOf(interpretCommand(words, change.composition));
      expect(back.composition.params.walkMinutes).toEqual({});
      expect(isStandard('walk', back.composition.params)).toBe(true);
    }
  });

  it('不在档位上的取最接近的一档并说明；所选指标都不是步行类时不改并说明', () => {
    const change = changeOf(interpretCommand('社区卫生改成步行 12 分钟', walking));
    expect(change.composition.params.walkMinutes).toEqual({ 'A-31': 10 });
    expect(change.notes.join()).toContain('已取最接近的一档');
    const none = interpretCommand('步行时长改成 10 分钟', {
      ...current,
      conditions: { ...current.conditions, indicatorIds: ['A-39'] }
    });
    expect(none).toEqual({ kind: 'none', notes: ['所选指标不适用步行时长'] });
  });

  it('"加上"时指标也加上；去掉指标时清掉它的时长', () => {
    const added = changeOf(interpretCommand('加上社区小学步行 20 分钟', walking));
    expect(added.composition.conditions.indicatorIds).toEqual(['A-31', 'A-33', 'A-39', 'A-32']);
    expect(added.composition.params.walkMinutes).toEqual({ 'A-32': 20 });
    const custom = changeOf(interpretCommand('社区卫生改成步行 10 分钟', walking)).composition;
    const removed = changeOf(interpretCommand('去掉社区卫生', custom));
    expect(removed.composition.conditions.indicatorIds).toEqual(['A-33', 'A-39']);
    expect(removed.composition.params.walkMinutes).toEqual({});
  });

  it('快捷说法：都是标准时长时建议改第一项，改过时建议改回；说这句话能生效', () => {
    const suggestion = commandSuggestions(walking, 'done').find(words => words.includes('步行'));
    expect(suggestion).toBe('社区卫生改为步行 10 分钟');
    const change = changeOf(interpretCommand(suggestion ?? '', walking));
    expect(change.composition.params.walkMinutes).toEqual({ 'A-31': 10 });
    expect(commandSuggestions(change.composition, 'done')).toContain('步行时长改回标准');
  });
});

describe('自定义范围的说法（ADR 0121）', () => {
  it('自定义范围下说城市：改为行政区划，"加上"以范围涉及的市为基础，并说明范围还在', async () => {
    const area = await testArea(await loadTestAtlas(), NINGZHEN_RINGS, '宁镇交界');
    const custom = withArea(current, area);
    const only = changeOf(interpretCommand('只看苏州市', custom));
    expect(only.composition.conditions.scope).toEqual(citiesScope(['320500']));
    expect(only.conditionsChanged).toBe(true);
    expect(only.said[0]).toBe('范围改为苏州市（自定义范围「宁镇交界」仍保留，说"改回自定义范围"可以切回）');
    expect(rememberedScopes(only.composition).area).toBe(area);
    const added = changeOf(interpretCommand('加上无锡市', custom));
    expect(added.composition.conditions.scope).toEqual(citiesScope(['320100', '320200', '321100']));
  });

  it('说"改回自定义范围"切回记下的范围；还没有范围时说明，不改', async () => {
    const area = await testArea(await loadTestAtlas(), NINGZHEN_RINGS, '宁镇交界');
    const back = changeOf(interpretCommand('改回自定义范围', { ...current, scopes: { cityCodes: [], area } }));
    expect(back.composition.conditions.scope).toEqual(areaScope(area));
    expect(back.said).toEqual(['范围改为自定义范围「宁镇交界」']);
    expect(interpretCommand('按上传的范围计算', current)).toEqual({
      kind: 'none',
      notes: ['还没有自定义范围，可以点"上传范围"或说"绘制范围"']
    });
  });

  it('快捷说法：自定义范围下不建议加城市；行政区划下记着自定义范围时建议切回', async () => {
    const area = await testArea(await loadTestAtlas(), NINGZHEN_RINGS);
    expect(commandSuggestions(withArea(current, area), 'running')).not.toContain('加上无锡市');
    const kept = commandSuggestions({ ...current, scopes: { cityCodes: [], area } }, 'running');
    expect(kept).toContain('改回自定义范围');
    expect(kept).not.toContain('加上无锡市');
  });
});

describe('新增、替换、移除监测范围（ADR 0129）', () => {
  const pending: Composition = { ...current, conditions: { ...current.conditions, scope: citiesScope([]) } };

  it('移除范围：说"移除范围"或去掉最后的市，结果里范围是空的；其余条件不变', () => {
    for (const words of ['移除范围', '去掉监测范围', '不要范围了', '清空范围']) {
      const removed = changeOf(interpretCommand(words, current));
      expect(removed.composition.conditions.scope).toEqual(citiesScope([]));
      expect(removed.composition.conditions.indicatorIds).toEqual(current.conditions.indicatorIds);
      expect(removed.said).toEqual(['已移除南京市、苏州市']);
    }
    expect(changeOf(interpretCommand('去掉南京市和苏州市', current)).composition.conditions.scope).toEqual(citiesScope([]));
  });

  it('移除自定义范围：范围不再记着；用着行政区划时说明没有可移除的', async () => {
    const area = await testArea(await loadTestAtlas(), NINGZHEN_RINGS, '宁镇交界');
    const removed = changeOf(interpretCommand('移除自定义范围', withArea(current, area)));
    expect(removed.composition.conditions.scope).toEqual(areaScope(null));
    expect(rememberedScopes(removed.composition).area).toBeNull();
    expect(removed.said).toEqual(['已移除自定义范围「宁镇交界」']);
    expect(interpretCommand('移除自定义范围', current)).toEqual({ kind: 'none', notes: ['当前用的是行政区划，没有自定义范围可移除'] });
  });

  it('等范围时：回复城市就是补上，其余条件不变；可以接着改年份、指标、参数', () => {
    const filled = changeOf(interpretCommand('南京市、苏州市', pending));
    expect(filled.composition.conditions.scope).toEqual(citiesScope(['320100', '320500']));
    expect(filled.composition.conditions.indicatorIds).toEqual(current.conditions.indicatorIds);
    expect(changeOf(interpretCommand('全省', pending)).composition.conditions.scope).toEqual(citiesScope(JIANGSU_CITIES.map(city => city.code)));
    const years = changeOf(interpretCommand('改成 2024 年', pending));
    expect(years.composition.conditions).toMatchObject({ years: [2024], scope: citiesScope([]) });
    const added = changeOf(interpretCommand('再加上公交车站', pending));
    expect(added.composition.conditions.indicatorIds).toEqual(['A-31', 'A-39', 'A08-2']);
    expect(changeOf(interpretCommand('按旧规程计算', pending)).composition.params.rule).toBe('old');
  });

  it('等范围时说自定义范围但还没有：切到自定义范围等上传；已有范围时不丢', async () => {
    const asked = changeOf(interpretCommand('用自定义范围', pending));
    expect(asked.composition.conditions.scope).toEqual(areaScope(null));
    expect(asked.said).toEqual(['监测范围改用自定义范围']);
    expect(interpretCommand('用自定义范围', current).kind).toBe('none');
    const area = await testArea(await loadTestAtlas(), NINGZHEN_RINGS);
    expect(changeOf(interpretCommand('用自定义范围', { ...pending, scopes: { cityCodes: [], area } })).composition.conditions.scope).toEqual(areaScope(area));
  });

  it('年份全空（待确认）时回复可选的年份；说不可选的年份时说明，不改', () => {
    const noYear: Composition = { ...current, conditions: { ...current.conditions, years: [] } };
    expect(changeOf(interpretCommand('改成 2025 年', noYear)).composition.conditions.years).toEqual([2025]);
    expect(interpretCommand('改成 2019 年', current)).toEqual({ kind: 'none', notes: ['没有 2019 年的数据，可选 2021～2026 年'] });
  });

  it('一句话里互相矛盾：不改，问用哪一个；用不上的参数不问', () => {
    const asked = interpretCommand('按旧规程和新规程计算', current);
    expect(asked.kind).toBe('conflict');
    expect(asked.kind === 'conflict' && asked.conflicts.map(item => item.key)).toEqual(['rule']);
    expect(interpretCommand('用自定义范围和南京市', current).kind).toBe('conflict');
    const solo: Composition = { ...current, conditions: { ...current.conditions, indicatorIds: ['A-39'] } };
    expect(interpretCommand('按旧规程和新规程计算', solo).kind).toBe('none');
    // 说换成哪一个不是矛盾
    expect(changeOf(interpretCommand('把旧规程改成新规程', { ...current, params: { ...current.params, rule: 'old' } })).composition.params.rule).toBe('new');
    expect(changeOf(interpretCommand('把自定义范围换成无锡市', current)).composition.conditions.scope).toEqual(citiesScope(['320200']));
  });
});

describe('说法的分类', () => {
  it('完整指令：说了指标，又说了年份、范围或"计算"，没有动词', () => {
    expect(isFullInstruction('计算 2025 年社区卫生服务设施覆盖率')).toBe(true);
    expect(isFullInstruction('计算社区卫生服务设施覆盖率')).toBe(true);
    expect(isFullInstruction('2025 年南京市社区卫生覆盖率')).toBe(true);
    expect(isFullInstruction('按常住人口增加 10%，计算 2025 年人均公园绿地面积')).toBe(true);
    expect(isFullInstruction('计算自定义范围「只看南京」 2025 年社区卫生服务设施覆盖率')).toBe(true);
    expect(isFullInstruction('再加上人均公园绿地')).toBe(false);
    expect(isFullInstruction('去掉人均公园绿地')).toBe(false);
    expect(isFullInstruction('社区小学步行 20 分钟')).toBe(false);
    expect(isFullInstruction('南京市')).toBe(false);
    expect(isFullInstruction('人均公园绿地面积')).toBe(false);
  });

  it('开始计算、上传和绘制范围的说法', () => {
    expect(['开始计算', '开始', '计算吧'].every(isStartWord)).toBe(true);
    expect(isStartWord('开始计算社区卫生')).toBe(false);
    expect(scopeAction('上传范围')).toBe('upload');
    expect(scopeAction('重新上传范围')).toBe('upload');
    expect(scopeAction('绘制范围')).toBe('draw');
    expect(scopeAction('画一个范围')).toBe('draw');
    expect(scopeAction('上传的范围')).toBeNull();
    expect(scopeAction('移除范围')).toBeNull();
  });
});
