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
    expect(paramsOf(['B-65', 'A-39', 'A-31'])).toEqual(['popChange', 'rule', 'recognition']);
    expect(paramsOf(['B-65'])).toEqual(['recognition']);
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
