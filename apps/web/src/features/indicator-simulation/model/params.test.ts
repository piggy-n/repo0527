// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { changedParams, defaultParams, describeParam, inScenario, scenarioText, type SimulationParams } from './params';

const conditions = { years: [2026], cityCodes: ['320100'], indicatorIds: ['B-65', 'A-39', 'A-31'] };
const base = defaultParams();
const withPatch = (patch: Partial<SimulationParams>): SimulationParams => ({ ...base, ...patch });

describe('changedParams', () => {
  it('相同的参数没有改动；默认参数每次是同一个对象', () => {
    expect(changedParams(base, withPatch({}))).toEqual([]);
    expect(defaultParams()).toBe(base);
  });

  it('按推演中的先后列出改动的参数项', () => {
    const next = withPatch({ newFacilities: 20, popCaliber: 'registered', targets: { ...base.targets, 'B-65': 65 } });

    expect(changedParams(base, next)).toEqual(['popCaliber', 'newFacilities', 'targets']);
  });

  it('规划新增的作用范围按集合比较，改了范围也算规划新增改了', () => {
    const scoped = withPatch({ newFacilities: 20, scenarioIds: ['B-65', 'A-39'] });

    expect(changedParams(withPatch({ newFacilities: 20 }), scoped)).toEqual(['newFacilities']);
    expect(changedParams(scoped, withPatch({ newFacilities: 20, scenarioIds: ['A-39', 'B-65'] }))).toEqual([]);
  });

  it('缺失处理：手动填写的数字不同也算改动，键的先后不算', () => {
    const manual = withPatch({ missing: { kind: 'manual', values: { 320117: 55.5, 321002: 89.2 } } });

    expect(changedParams(base, manual)).toEqual(['missing']);
    expect(changedParams(manual, withPatch({ missing: { kind: 'manual', values: { 321002: 89.2, 320117: 55.5 } } }))).toEqual([]);
    expect(changedParams(manual, withPatch({ missing: { kind: 'manual', values: { 320117: 60, 321002: 89.2 } } }))).toEqual(['missing']);
  });
});

describe('参数的说明', () => {
  it('各项参数的取值说明', () => {
    const params = withPatch({ walkSpeed: 75, newFacilities: 20, scenarioIds: ['B-65', 'A-39'], targets: { ...base.targets, 'B-65': 65 } });

    expect(describeParam('popCaliber', params, conditions)).toBe('常住人口');
    expect(describeParam('missing', params, conditions)).toBe('按趋势插补');
    expect(describeParam('walkSpeed', params, conditions)).toBe('75 米/分钟');
    expect(describeParam('facilityScope', params, conditions)).toBe('规模以上设施');
    expect(describeParam('newFacilities', params, conditions)).toBe('20%（公园绿地覆盖率、人均公园绿地）');
    expect(describeParam('targets', params, conditions)).toBe('1 项已调整');
    expect(describeParam('targets', base, conditions)).toBe('3 项默认');
    expect(describeParam('newFacilities', base, conditions)).toBe('0%');
  });

  it('规划新增的作用范围：全部、一两项写简称、多了写"某某等 n 项"，不在条件里的不算', () => {
    expect(scenarioText(base, conditions)).toBe('全部指标');
    expect(scenarioText(withPatch({ scenarioIds: ['A-31'] }), conditions)).toBe('社区卫生覆盖率');
    expect(scenarioText(withPatch({ scenarioIds: ['B-65', 'A-39', 'A-31'] }), conditions)).toBe('公园绿地覆盖率等 3 项');
    expect(scenarioText(withPatch({ scenarioIds: ['B-61'] }), conditions)).toBe('无指标');
    expect(inScenario(base, 'B-61')).toBe(true);
    expect(inScenario(withPatch({ scenarioIds: ['B-65'] }), 'A-39')).toBe(false);
  });
});
