// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  SIMULATION_INDICATORS,
  simulationIndicator,
  standardWalkMinutes,
  WALK_METERS,
  walkOptions
} from './indicators';
import {
  changedParams,
  defaultParams,
  describeParam,
  indicatorName,
  indicatorShort,
  isScenario,
  isStandard,
  keepWalkMinutes,
  paramApplies,
  paramsOf,
  reachTextOf,
  scenarioKeys,
  serviceMeters,
  signedPercent,
  snapWalkMinutes,
  walkMinutesOf,
  withWalkMinutes,
  type SimulationParams
} from './params';

const base = defaultParams();
const withPatch = (patch: Partial<SimulationParams>): SimulationParams => ({ ...base, ...patch });

describe('changedParams', () => {
  it('相同的参数没有改动；标准口径每次是同一个对象', () => {
    expect(changedParams(base, withPatch({}))).toEqual([]);
    expect(defaultParams()).toBe(base);
  });

  it('按计算中的先后列出改动的参数项', () => {
    const next = withPatch({ recognition: 'intersect', popChange: 10, rule: 'old' });

    expect(changedParams(base, next)).toEqual(['popChange', 'rule', 'recognition']);
  });
});

describe('参数作用于哪些指标', () => {
  it('计算规程只对 A-31、A-35，覆盖认定只对住宅用地覆盖率，人口只对人均类', () => {
    expect(['A-31', 'A-35', 'B-65'].map(id => paramApplies('rule', id))).toEqual([true, true, false]);
    expect(['B-65', 'B-14', 'A-15', 'A-39'].map(id => paramApplies('recognition', id))).toEqual([true, true, false, false]);
    expect(['A-39', 'B-61', 'B-65'].map(id => paramApplies('popChange', id))).toEqual([true, true, false]);
  });

  it('所选指标用得上的参数项，按计算中的先后；城区面积覆盖率没有可调的参数', () => {
    expect(paramsOf(['B-65', 'A-39', 'A-31'])).toEqual(['popChange', 'walk', 'rule', 'recognition']);
    expect(paramsOf(['B-65'])).toEqual(['walk', 'recognition']);
    expect(paramsOf(['A-15'])).toEqual([]);
    expect(paramsOf([])).toEqual([]);
  });
});

describe('自定义口径', () => {
  it('参数偏离标准口径、而且对这项指标起作用才是自定义口径', () => {
    const old = withPatch({ rule: 'old' });

    expect(isStandard('rule', old)).toBe(false);
    expect(scenarioKeys(old, 'A-31')).toEqual(['rule']);
    expect(isScenario(old, 'A-31')).toBe(true);
    expect(isScenario(old, 'B-65')).toBe(false);
    expect(scenarioKeys(withPatch({ rule: 'old', recognition: 'intersect' }), 'A-31')).toEqual(['rule', 'recognition']);
  });

  it('服务范围：旧规程下站点按步行 5 分钟（300 米），其余按标准距离', () => {
    const old = withPatch({ rule: 'old' });

    expect([serviceMeters('A-31', base), serviceMeters('A-31', old)]).toEqual([1000, 300]);
    expect(serviceMeters('B-65', old)).toBe(300);
    expect(serviceMeters('A-15', old)).toBe(3000);
    expect(serviceMeters('A-39', old)).toBeNull();
  });
});

describe('参数的说明', () => {
  it('各项参数的取值说明', () => {
    const params = withPatch({ rule: 'old', recognition: 'intersect', popChange: -5 });

    expect(describeParam('rule', params)).toBe('旧规程');
    expect(describeParam('recognition', params)).toBe('相交即算');
    expect(describeParam('popChange', params)).toBe('−5%');
    expect(describeParam('rule', base)).toBe('新规程');
    expect(describeParam('recognition', base)).toBe('覆盖 ≥ 50%');
  });

  it('带正负号的百分比', () => {
    expect([10, -5, 0].map(signedPercent)).toEqual(['+10%', '−5%', '0%']);
  });
});

describe('步行时长（ADR 0125）', () => {
  const custom = withWalkMinutes(defaultParams(), 'A-31', 10);

  it('距离查表：5、10、15 分钟是 Excel 的三档，更长的按 1000 米 ÷ 15 分钟外推，取整到 10 米', () => {
    expect(WALK_METERS).toEqual({ 5: 300, 10: 500, 15: 1000, 20: 1330, 25: 1670, 30: 2000 });
  });

  it('可选的时长：5 分钟一档，不超过标准时长的 3 倍和 30 分钟；不是步行类的没有', () => {
    expect(walkOptions(simulationIndicator('A08-2'))).toEqual([5, 10, 15]);
    expect(walkOptions(simulationIndicator('A-32'))).toEqual([5, 10, 15, 20, 25, 30]);
    expect(walkOptions(simulationIndicator('A-31'))).toEqual([5, 10, 15, 20, 25, 30]);
    expect(walkOptions(simulationIndicator('A-15'))).toEqual([]);
    expect(walkOptions(simulationIndicator('A-39'))).toEqual([]);
  });

  it('步行类 10 项：名称里都写着标准时长，改了之后名称和简称都写改后的', () => {
    const walking = SIMULATION_INDICATORS.filter(item => standardWalkMinutes(item) !== null);
    expect(walking).toHaveLength(10);
    for (const { id, name, short } of walking) {
      const standard = standardWalkMinutes(simulationIndicator(id));
      expect(name).toContain(`步行${standard}分钟`);
      expect(short.endsWith('覆盖率')).toBe(true);
      const params = withWalkMinutes(defaultParams(), id, standard === 10 ? 15 : 10);
      expect(indicatorName(id, params)).not.toBe(name);
      expect(indicatorShort(id, params)).not.toBe(short);
    }
  });

  it('改一项：名称、简称、服务范围的说明、距离都跟着变，编码和别的指标不变', () => {
    expect(indicatorName('A-31', custom)).toBe('社区卫生服务设施步行10分钟覆盖率');
    expect(indicatorShort('A-31', custom)).toBe('社区卫生10分钟覆盖率');
    expect(reachTextOf('A-31', custom)).toBe('步行 10 分钟（500 米）');
    expect(serviceMeters('A-31', custom)).toBe(500);
    expect(walkMinutesOf(custom, 'A-31')).toBe(10);
    expect(indicatorName('A-33', custom)).toBe(simulationIndicator('A-33').name);
    expect(serviceMeters('A-33', custom)).toBe(1000);
    expect(walkMinutesOf(custom, 'A-33')).toBe(15);
    expect(walkMinutesOf(custom, 'A-15')).toBeNull();
    expect(indicatorName('A-31', defaultParams())).toBe(simulationIndicator('A-31').name);
    expect(reachTextOf('A-31', defaultParams())).toBe('步行 15 分钟（1000 米）');
  });

  it('旧规程的服务距离是站点的 5 分钟，不跟随设定的时长', () => {
    expect(serviceMeters('A-31', { ...custom, rule: 'old' })).toBe(300);
    expect(indicatorName('A-31', { ...custom, rule: 'old' })).toBe('社区卫生服务设施步行10分钟覆盖率');
  });

  it('标准时长不记；值没变时返回原来的对象；改回标准后是标准口径；不是可选的时长抛错', () => {
    expect(withWalkMinutes(defaultParams(), 'A-31', 15)).toBe(defaultParams());
    expect(withWalkMinutes(custom, 'A-31', 10)).toBe(custom);
    const back = withWalkMinutes(custom, 'A-31', 15);
    expect(back.walkMinutes).toEqual({});
    expect(isStandard('walk', back)).toBe(true);
    expect(withWalkMinutes(custom, 'A-31', null).walkMinutes).toEqual({});
    expect(() => withWalkMinutes(defaultParams(), 'A-31', 12)).toThrow('没有步行 12 分钟');
    expect(() => withWalkMinutes(defaultParams(), 'A08-2', 20)).toThrow('没有步行 20 分钟');
    expect(() => withWalkMinutes(defaultParams(), 'A-15', 10)).toThrow('没有步行 10 分钟');
  });

  it('一项指标是不是自定义口径只看它自己的时长', () => {
    expect(isStandard('walk', custom)).toBe(false);
    expect(scenarioKeys(custom, 'A-31')).toEqual(['walk']);
    expect(isScenario(custom, 'A-31')).toBe(true);
    expect(isScenario(custom, 'A-33')).toBe(false);
    expect(paramApplies('walk', 'A-31')).toBe(true);
    expect(paramApplies('walk', 'A-15')).toBe(false);
    expect(paramApplies('walk', 'A-39')).toBe(false);
  });

  it('比较和说明：内容相同就没有变化；写出指标和时长，多项写个数', () => {
    const both = withWalkMinutes(custom, 'A-33', 20);
    const reordered = withWalkMinutes(withWalkMinutes(defaultParams(), 'A-33', 20), 'A-31', 10);
    expect(changedParams(both, reordered)).toEqual([]);
    expect(changedParams(defaultParams(), custom)).toEqual(['walk']);
    expect(describeParam('walk', defaultParams())).toBe('标准');
    expect(describeParam('walk', custom)).toBe('社区卫生 10 分钟');
    expect(describeParam('walk', both)).toBe('2 项已调整');
  });

  it('说到的时长取最近的一档：一样近时取短的，超过上限时是上限', () => {
    expect(snapWalkMinutes('A-31', 12)).toBe(10);
    expect(snapWalkMinutes('A-31', 13)).toBe(15);
    expect(snapWalkMinutes('A-31', 7.5)).toBe(5);
    expect(snapWalkMinutes('A-31', 1)).toBe(5);
    expect(snapWalkMinutes('A-31', 40)).toBe(30);
    expect(snapWalkMinutes('A08-2', 40)).toBe(15);
    expect(() => snapWalkMinutes('A-39', 10)).toThrow('不是步行类');
  });

  it('只留下所选指标的时长', () => {
    const both = withWalkMinutes(custom, 'A-33', 20);
    expect(keepWalkMinutes(both, ['A-33']).walkMinutes).toEqual({ 'A-33': 20 });
    expect(keepWalkMinutes(both, ['A-31', 'A-33'])).toBe(both);
    expect(keepWalkMinutes(both, []).walkMinutes).toEqual({});
  });
});
