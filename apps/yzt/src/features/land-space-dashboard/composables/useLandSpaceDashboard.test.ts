// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DASHBOARD_CITIES } from '@/shared/dashboard/cities';
import { useLandSpaceDashboard } from './useLandSpaceDashboard';

const NANJING = '320100';
const WUXI = '320200';
const ROAD = '与二级公路之间距离';

function selection(model: ReturnType<typeof useLandSpaceDashboard>) {
  const { domainId, subIndexId, indicatorId, partId } = model.state.value;
  return [domainId, subIndexId, indicatorId, partId];
}

describe('一级、二级、三级和分项的连带选择', () => {
  it('默认是第一个一级、它的第一个二级和三级、「综合」，全部 13 个市、只有 2025', () => {
    const model = useLandSpaceDashboard();
    expect(selection(model)).toEqual(['livability', 'I02', 'M01', null]);
    expect(model.cities.value).toHaveLength(13);
    expect(model.state.value.years).toEqual([2025]);
    expect(model.state.value.activeYear).toBe(2025);
  });

  it('选一级自动选中第一个二级、第一个三级，分项回到「综合」；点当前一级不变', () => {
    const model = useLandSpaceDashboard();
    model.selectDomain('transport');
    model.selectSubIndex('I25');
    model.selectIndicator('M62');
    model.selectPart(ROAD);
    expect(selection(model)).toEqual(['transport', 'I25', 'M62', ROAD]);
    model.selectDomain('transport');
    expect(selection(model)).toEqual(['transport', 'I25', 'M62', ROAD]);
    model.selectDomain('public-resources');
    expect(selection(model)).toEqual(['public-resources', 'I10', 'M17', null]);
    model.selectDomain('unknown');
    expect(selection(model)).toEqual(['public-resources', 'I10', 'M17', null]);
  });

  it('选二级选中它的第一个三级；选三级回到「综合」；不属于当前上级的选择忽略', () => {
    const model = useLandSpaceDashboard();
    model.selectDomain('transport');
    model.selectSubIndex('I23');
    expect(selection(model)).toEqual(['transport', 'I23', 'M52', null]);
    // I02 属于生活宜居便利性，M62 属于网络便捷度
    model.selectSubIndex('I02');
    model.selectIndicator('M62');
    expect(selection(model)).toEqual(['transport', 'I23', 'M52', null]);
    model.selectSubIndex('I25');
    model.selectIndicator('M63');
    model.selectPart('与机场之间距离');
    model.selectIndicator('M62');
    expect(selection(model)).toEqual(['transport', 'I25', 'M62', null]);
    expect(model.parts.value.map(part => part.name)).toHaveLength(3);
    model.selectPart('与机场之间距离');
    expect(model.state.value.partId).toBeNull();
    model.selectPart(ROAD);
    model.selectPart(null);
    expect(model.state.value.partId).toBeNull();
  });
});

describe('三张卡的指标和比较', () => {
  it('一级、二级用分类名，三级带单位，分项时名称后接分项名、取分项的值', () => {
    const model = useLandSpaceDashboard();
    expect(model.metas.domain.value).toEqual({ id: 'I01', name: '生活宜居便利性', unit: '', precision: 2 });
    expect(model.metas.sub.value).toEqual({ id: 'I02', name: '教育便利性', unit: '', precision: 2 });
    expect(model.metas.indicator.value).toEqual({ id: 'M01', name: '幼儿园步行5分钟覆盖率', unit: '%', precision: 2 });
    model.selectDomain('transport');
    model.selectSubIndex('I25');
    model.selectIndicator('M62');
    expect(model.metas.indicator.value).toMatchObject({ id: 'M62', name: '交通干线便捷度', unit: 'km' });
    expect(model.comparisons.indicator.value[0]?.values[0]).toBe(2.53286666666667);
    model.selectPart(ROAD);
    expect(model.metas.indicator.value).toEqual({
      id: `M62:${ROAD}`,
      name: `交通干线便捷度 · ${ROAD}`,
      unit: 'km',
      precision: 2
    });
    expect(model.comparisons.indicator.value[0]?.values[0]).toBe(2.183);
  });

  it('均值是所选城市的算术平均，城市筛选只影响比较、不影响色阶', () => {
    const model = useLandSpaceDashboard();
    const classification = model.classification.value;
    expect(classification.sampleCount).toBe(13);
    model.setCities([WUXI, NANJING, 'unknown', NANJING]);
    expect(model.cities.value.map(city => city.code)).toEqual([NANJING, WUXI]);
    // 南京 0.7、无锡 0.76
    expect(model.comparisons.domain.value).toEqual([{ year: 2025, values: [0.7, 0.76], average: 0.73 }]);
    expect(model.mapValues.value[NANJING]).toBe(1.01);
    expect(model.mapValues.value['320300']).toBeNull();
    expect(model.classification.value).toBe(classification);
    model.toggleCity(NANJING);
    expect(model.cities.value.map(city => city.code)).toEqual([WUXI]);
    model.toggleCity(NANJING);
    expect(model.cities.value.map(city => city.code)).toEqual([NANJING, WUXI]);
  });

  it('没有指数值的二级给出说明，比较值全为空，三级照常', () => {
    const model = useLandSpaceDashboard();
    expect(model.notice.value).toBeUndefined();
    model.selectSubIndex('I05');
    expect(model.notice.value).toBe('原报告未列指数值');
    expect(model.comparisons.sub.value).toEqual([{ year: 2025, values: Array(13).fill(null), average: null }]);
    expect(Object.values(model.mapValues.value).every(value => value === null)).toBe(true);
    expect(model.classification.value.classCount).toBe(0);
    expect(model.comparisons.indicator.value[0]?.average).not.toBeNull();
    model.selectSubIndex('I07');
    expect(model.notice.value).toBeUndefined();
  });
});

describe('地图只跟二级', () => {
  it('切三级、分项时地图的值和色阶是同一个对象，切二级、城市时才重算', () => {
    const model = useLandSpaceDashboard();
    model.selectDomain('transport');
    model.selectSubIndex('I25');
    const values = model.mapValues.value;
    const classification = model.classification.value;
    const sub = model.comparisons.sub.value;
    model.selectIndicator('M63');
    model.selectPart('与港口之间距离');
    model.selectPart(null);
    expect(model.mapValues.value).toBe(values);
    expect(model.classification.value).toBe(classification);
    expect(model.comparisons.sub.value).toBe(sub);
    model.setCities(DASHBOARD_CITIES.slice(1).map(city => city.code));
    expect(model.mapValues.value).not.toBe(values);
    expect(model.classification.value).toBe(classification);
    model.selectSubIndex('I24');
    expect(model.classification.value).not.toBe(classification);
    expect(model.mapValues.value[NANJING]).toBeNull();
  });
});

describe('年份和偏好', () => {
  it('年份锁定 2025：清空、不在数据里的年份都忽略', () => {
    const model = useLandSpaceDashboard();
    const state = model.state.value;
    model.setYears([]);
    model.setYears([2024]);
    model.setActiveYear(2024);
    expect(model.state.value).toBe(state);
    model.setYears([2025, 2026]);
    model.setActiveYear(2025);
    expect(model.state.value.years).toEqual([2025]);
    expect(model.state.value.activeYear).toBe(2025);
  });

  it('默认一级柱、二级雷达、三级柱；偏好按卡位保存，切换指标后保留', () => {
    const model = useLandSpaceDashboard();
    const { domain, sub, indicator } = model.preferences.value;
    expect([domain.type, sub.type, indicator.type]).toEqual(['bar', 'radar', 'bar']);
    model.setPreference('domain', { type: 'line' });
    model.setPreference('sub', { showAverage: false, legend: { 2025: false } });
    model.setPreference('indicator', { type: 'line' });
    model.selectDomain('building');
    model.selectIndicator('M70');
    expect(model.preferences.value).toEqual({
      domain: { type: 'line', showAverage: true, legend: {} },
      sub: { type: 'radar', showAverage: false, legend: { 2025: false } },
      indicator: { type: 'line', showAverage: true, legend: {} }
    });
  });
});
