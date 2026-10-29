// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  changedParams,
  defaultParams,
  describeParam,
  isScenario,
  isStandard,
  paramApplies,
  paramsOf,
  scenarioKeys,
  serviceMeters,
  signedPercent,
  type SimulationParams,
  withParam
} from './params';

const conditions = { years: [2026], cityCodes: ['320100'], indicatorIds: ['B-65', 'A-39', 'A-31'] };
const base = defaultParams();
const withPatch = (patch: Partial<SimulationParams>): SimulationParams => ({ ...base, ...patch });

describe('changedParams', () => {
  it('相同的参数没有改动；标准口径每次是同一个对象', () => {
    expect(changedParams(base, withPatch({}))).toEqual([]);
    expect(defaultParams()).toBe(base);
  });

  it('按推演中的先后列出改动的参数项', () => {
    const next = withPatch({ recognition: 'intersect', popChange: 10, rule: 'old', targets: { ...base.targets, 'B-65': 65 } });

    expect(changedParams(base, next)).toEqual(['popChange', 'rule', 'recognition', 'targets']);
  });

  it('目标值按键比较，键的先后不算', () => {
    const reversed = withPatch({ targets: Object.fromEntries(Object.entries(base.targets).toReversed()) });

    expect(changedParams(base, reversed)).toEqual([]);
  });

  it('把一项参数换成另一组的取值', () => {
    const next = withPatch({ rule: 'old', popChange: 10 });

    expect(withParam(base, 'rule', next)).toEqual(withPatch({ rule: 'old' }));
  });
});

describe('参数作用于哪些指标', () => {
  it('计算规程只对 A-31、A-35，覆盖认定只对住宅用地覆盖率，人口只对人均类，目标值对全部', () => {
    expect(['A-31', 'A-35', 'B-65'].map(id => paramApplies('rule', id))).toEqual([true, true, false]);
    expect(['B-65', 'B-14', 'A-15', 'A-39'].map(id => paramApplies('recognition', id))).toEqual([true, true, false, false]);
    expect(['A-39', 'B-61', 'B-65'].map(id => paramApplies('popChange', id))).toEqual([true, true, false]);
    expect(['A-15', 'A-39'].map(id => paramApplies('targets', id))).toEqual([true, true]);
  });

  it('所选指标用得上的参数项，按推演中的先后', () => {
    expect(paramsOf(['B-65', 'A-39', 'A-31'])).toEqual(['popChange', 'rule', 'recognition', 'targets']);
    expect(paramsOf(['B-65'])).toEqual(['recognition', 'targets']);
    expect(paramsOf(['A-15'])).toEqual(['targets']);
    expect(paramsOf([])).toEqual([]);
  });
});

describe('模拟情景', () => {
  it('参数偏离标准口径、而且对这项指标起作用才是模拟情景；目标值不算', () => {
    const old = withPatch({ rule: 'old' });

    expect(isStandard('rule', old)).toBe(false);
    expect(scenarioKeys(old, 'A-31')).toEqual(['rule']);
    expect(isScenario(old, 'A-31')).toBe(true);
    expect(isScenario(old, 'B-65')).toBe(false);
    expect(isScenario(withPatch({ targets: { ...base.targets, 'A-31': 60 } }), 'A-31')).toBe(false);
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
    const params = withPatch({ rule: 'old', recognition: 'intersect', popChange: -5, targets: { ...base.targets, 'B-65': 65 } });

    expect(describeParam('rule', params, conditions)).toBe('旧规程');
    expect(describeParam('recognition', params, conditions)).toBe('相交即算');
    expect(describeParam('popChange', params, conditions)).toBe('−5%');
    expect(describeParam('targets', params, conditions)).toBe('1 项已调整');
    expect(describeParam('rule', base, conditions)).toBe('新规程');
    expect(describeParam('recognition', base, conditions)).toBe('覆盖 ≥ 50%');
    expect(describeParam('targets', base, conditions)).toBe('3 项默认');
  });

  it('带正负号的百分比', () => {
    expect([10, -5, 0].map(signedPercent)).toEqual(['+10%', '−5%', '0%']);
  });
});
