// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { dataFormatLabel, dataLayerLabel } from './catalog';

describe('dataLayerLabel', () => {
  it('清单里的代码换成名称，没有的原样显示', () => {
    expect(dataLayerLabel('bgdc_dltb_2022')).toBe('地类图斑');
    expect(dataLayerLabel('unknown_layer')).toBe('unknown_layer');
  });
});

describe('dataFormatLabel', () => {
  it('小写的格式换成清单里的写法；统计任务的 .zip 显示为 ZIP', () => {
    expect(['excel', 'shp', 'gdb', 'echarts', 'word'].map(dataFormatLabel)).toEqual(['Excel', 'SHP', 'GDB', 'Echarts', 'Word']);
    expect(dataFormatLabel('.zip')).toBe('ZIP');
  });
});
