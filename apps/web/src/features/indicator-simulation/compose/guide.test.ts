// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { defaultParams } from '../model/params';
import { areaScope, citiesScope } from '../model/scope';
import { NANJING_RINGS, testArea } from '../model/test-area';
import { loadTestAtlas } from '../model/test-atlas';
import { plainText } from '../run/narrative';
import { type Composition, withArea, withScopeKind } from './composition';
import {
  conflictsAfterEdit,
  paramConflicts,
  saidPopChanges,
  saidRecognition,
  saidRule,
  scopeConflict,
  yearsConflict
} from './conflicts';
import { blockerText, canRun, composeGuide, type GuideInput, knownConditions } from './guide';

const pending: Composition = {
  conditions: { years: [2025], scope: citiesScope([]), indicatorIds: ['A-31', 'A-39'] },
  params: defaultParams()
};
const complete: Composition = {
  ...pending,
  conditions: { ...pending.conditions, scope: citiesScope(['320100']) }
};
const quiet: GuideInput = { conflicts: [], said: [], intent: true, removedCities: [] };
const [ruleConflict] = paramConflicts('旧规程和新规程');

describe('执行校验', () => {
  it('条件齐全、没有要确认的冲突才能计算', () => {
    expect(canRun(complete.conditions, [])).toBe(true);
    expect(canRun(pending.conditions, [])).toBe(false);
    expect(canRun(complete.conditions, paramConflicts('旧规程和新规程'))).toBe(false);
  });

  it('写出还缺什么、要确认什么；同一项既缺又有冲突时算要确认', () => {
    expect(blockerText(complete.conditions, [])).toBe('');
    expect(blockerText(pending.conditions, [])).toBe('待补充：监测范围');
    expect(blockerText(pending.conditions, paramConflicts('旧规程和新规程'))).toBe('待补充：监测范围；待确认：计算规程');
    expect(blockerText(pending.conditions, [scopeConflict(['320100'], false)])).toBe('待确认：监测范围');
    const noYear = { ...complete.conditions, years: [] };
    expect(blockerText(noYear, [yearsConflict([2019], [2026, 2025, 2021])])).toBe('待确认：年份');
  });
});

describe('knownConditions', () => {
  it('写出已经知道的条件，年份从早到晚；没有范围时不写范围', () => {
    expect(knownConditions(pending)).toBe('2025 年 · 社区卫生服务设施步行15分钟覆盖率等 2 项指标');
    const later = { ...complete.conditions, years: [2026, 2024], indicatorIds: ['A-39'] };
    expect(knownConditions({ ...complete, conditions: later })).toBe('2024、2026 年 · 南京市 · 人均公园绿地面积');
  });
});

describe('composeGuide', () => {
  it('缺范围：开头写已识别的条件，问范围；用行政区划时先给城市', () => {
    const guide = composeGuide(pending, quiet);
    expect(guide.kind).toBe('scope');
    expect(guide.lead).toEqual({ tone: 'known', text: '已识别：2025 年 · 社区卫生服务设施步行15分钟覆盖率等 2 项指标。' });
    expect(plainText(guide.question)).toBe('还缺监测范围，可以回复城市名称，或选择：');
    expect(guide.scopeKind).toBe('cities');
    expect(guide.options).toEqual([]);
  });

  it('刚改了什么时开头写改了什么；说自定义范围但没有时先给上传和绘制', () => {
    const area = withScopeKind(pending, 'area');
    const guide = composeGuide(area, { ...quiet, said: ['已加上人均公园绿地', '计算已停止'] });
    expect(guide.lead).toEqual({ tone: 'said', text: '已加上人均公园绿地；计算已停止。' });
    expect(plainText(guide.question)).toBe('还缺自定义范围，可以上传、绘制，或改用行政区划：');
    expect(guide.scopeKind).toBe('area');
  });

  it('记着自定义范围、刚移除了市时，可以一键用回来', async () => {
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS, '江宁片区');
    const remembered = withScopeKind(withArea(pending, area), 'cities');
    expect(composeGuide(remembered, quiet).options).toEqual([{ label: '使用「江宁片区」', say: '用自定义范围' }]);
    const removed = composeGuide(pending, { ...quiet, removedCities: ['320100', '320500'] });
    expect(removed.options).toEqual([{ label: '恢复南京市、苏州市', say: '南京市、苏州市' }]);
    const many = composeGuide(pending, { ...quiet, removedCities: JIANGSU_CITIES.map(city => city.code) });
    expect(many.options[0]?.label).toBe('恢复南京市等 13 个市');
  });

  it('有冲突时先问冲突，其余的写还有几项', () => {
    const guide = composeGuide(pending, { ...quiet, conflicts: paramConflicts('旧规程和新规程') });
    expect(guide.kind).toBe('conflict');
    expect(plainText(guide.question)).toBe('同时提到了旧规程和新规程，要按哪一个计算？');
    expect(guide.options).toEqual(ruleConflict?.options);
    expect(guide.more).toBe(1);
    expect(composeGuide(pending, quiet).more).toBe(0);
  });

  it('别的条件缺时说可以直接说；都齐了时按有没有说过要计算写法不同', () => {
    const noIndicator = { ...complete, conditions: { ...complete.conditions, indicatorIds: [] } };
    expect(composeGuide(noIndicator, quiet).kind).toBe('missing');
    expect(plainText(composeGuide(noIndicator, quiet).question)).toBe('还缺监测指标，可以直接说，或在左侧选择。');
    expect(composeGuide(complete, quiet)).toMatchObject({ kind: 'ready', question: ['条件已齐全，确认后开始计算；也可以继续调整。'] });
    expect(composeGuide(complete, { ...quiet, intent: false }).question).toEqual(['条件已齐全，可以开始计算。']);
  });
});

describe('句子里的参数', () => {
  it('计算规程：说一种、都说、说换成哪一种', () => {
    expect(saidRule('按旧规程计算')).toBe('old');
    expect(saidRule('按新规程计算')).toBe('new');
    expect(saidRule('按旧规程和新规程计算')).toBe('both');
    expect(saidRule('把旧规程改成新规程')).toBe('new');
    expect(saidRule('把新规程换成旧规程')).toBe('old');
    expect(saidRule('计算覆盖率')).toBeNull();
  });

  it('覆盖认定：人口的百分之五十不算；说换成哪一种', () => {
    expect(saidRecognition('改成相交即算')).toBe('intersect');
    expect(saidRecognition('覆盖认定改回50%')).toBe('half');
    expect(saidRecognition('按相交即算和覆盖50%计算')).toBe('both');
    expect(saidRecognition('相交即算改回50%')).toBe('half');
    expect(saidRecognition('社区卫生覆盖率人口增加50%')).toBeNull();
  });

  it('人口变化：按 5% 取整、限在范围内，重复的算一个', () => {
    expect(saidPopChanges('人口增加12%')).toEqual([10]);
    expect(saidPopChanges('人口减少30%')).toEqual([-20]);
    expect(saidPopChanges('人口增加10%，人口增加10%')).toEqual([10]);
    expect(saidPopChanges('人口增加10%、人口减少5%')).toEqual([10, -5]);
  });

  it('矛盾的说法各给两个选项；不矛盾时没有冲突', () => {
    expect(paramConflicts('按旧规程和新规程计算').map(item => item.key)).toEqual(['rule']);
    expect(paramConflicts('按相交即算和覆盖50%计算').map(item => item.key)).toEqual(['recognition']);
    const [pop] = paramConflicts('人口增加10%、人口减少5%');
    expect(pop?.options.map(option => option.say)).toEqual(['常住人口增加 10%', '常住人口减少 5%']);
    expect(paramConflicts('把旧规程改成新规程，人口增加10%')).toEqual([]);
  });
});

describe('conflictsAfterEdit', () => {
  it('手动改条件：范围、年份有了算解决，参数换了取值才算解决', () => {
    const conflicts = [scopeConflict(['320100'], false), yearsConflict([2019], [2026, 2025]), ...paramConflicts('旧规程和新规程')];
    const noYear = { ...pending, conditions: { ...pending.conditions, years: [] } };
    expect(conflictsAfterEdit(conflicts, noYear, noYear).map(item => item.key)).toEqual(['scope', 'years', 'rule']);
    expect(conflictsAfterEdit(conflicts, noYear, complete).map(item => item.key)).toEqual(['rule']);
    const edited = { ...complete, params: { ...complete.params, rule: 'old' as const } };
    expect(conflictsAfterEdit(conflicts, noYear, edited)).toEqual([]);
  });

  it('自定义范围也算有范围', async () => {
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS);
    const withAreaScope = { ...pending, conditions: { ...pending.conditions, scope: areaScope(area) } };
    expect(conflictsAfterEdit([scopeConflict(['320100'], true)], pending, withAreaScope)).toEqual([]);
  });
});
